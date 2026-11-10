import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { autoRetry } from '@grammyjs/auto-retry';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Bot, BotError, GrammyError, HttpError, session } from 'grammy';
import { env } from '../config/env';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { matchLegacyMenu } from '../domain/menu';
import { splitMessage } from '../domain/text';
import { ParticipantsService } from '../services/participants.service';
import { SettingsService } from '../services/settings.service';
import type { Update } from 'grammy/types';
import type { Ctx } from './context';
import { isPrivate } from './context';
import { CommandsFlow } from './flows/commands.flow';
import { ProfileFlow } from './flows/profile.flow';
import { RegistrationFlow } from './flows/registration.flow';
import { ReportFlow } from './flows/report.flow';
import { initialSession, PgSessionStorage, type SessionData } from './session';

/** «Только видеокружок» — не чаще раза в десять минут на чат. */
const VIDEO_ONLY_COOLDOWN_MS = 10 * 60_000;

@Injectable()
export class BotService implements OnModuleDestroy {
  private readonly log = new Logger(BotService.name);
  readonly bot: Bot<Ctx>;
  private runner?: RunnerHandle;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly participants: ParticipantsService,
    private readonly registration: RegistrationFlow,
    private readonly report: ReportFlow,
    private readonly commands: CommandsFlow,
    private readonly profile: ProfileFlow,
  ) {
    this.bot = new Bot<Ctx>(env().BOT_TOKEN);
    this.configure();
  }

  private configure(): void {
    // Соблюдает retry_after при 429 — общий ограничитель на рассылки и напоминания.
    this.bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

    this.bot.use(
      session<SessionData, Ctx>({
        initial: initialSession,
        storage: new PgSessionStorage(this.db),
      }),
    );

    // В группах бот не работает.
    this.bot.on('my_chat_member', (ctx) => this.onChatMember(ctx));
    this.bot.use(async (ctx, next) => {
      if (ctx.chat && !isPrivate(ctx)) {
        if (ctx.chat.type !== 'private') await ctx.leaveChat().catch(() => {});
        return;
      }
      await next();
    });

    this.bot.use(async (ctx, next) => this.loadParticipant(ctx, next));

    this.registration.register(this.bot);
    this.report.register(this.bot);
    this.commands.register(this.bot);
    this.profile.register(this.bot);

    // Кнопки главной клавиатуры и ввод в активном флоу.
    this.bot.on('message:text', (ctx) => this.onText(ctx));

    // Всё прочее — отчёт принимается только видеокружком.
    this.bot.on(
      ['message:photo', 'message:video', 'message:document', 'message:voice', 'message:audio', 'message:sticker'],
      (ctx) => this.sayVideoOnly(ctx),
    );

    this.bot.catch((err) => this.onError(err));
  }

  /**
   * Приём апдейта из вебхука.
   *
   * Обработчик `bot.catch` grammY ставит только поллинг, а `handleUpdate`
   * пробрасывает ошибку наружу — и до правки она долетала до Nest, который
   * печатал в лог весь объект ошибки вместе с токеном бота, а участница не
   * получала ничего. Поэтому вебхук ходит сюда, а не в `handleUpdate` напрямую.
   */
  async handleUpdate(update: Update): Promise<void> {
    try {
      await this.bot.handleUpdate(update);
    } catch (err) {
      await this.onError(err);
    }
  }

  /** Общая обработка ошибок для поллинга и вебхука. */
  private async onError(err: unknown): Promise<void> {
    const e = err instanceof BotError ? err.error : err;
    const ctx = err instanceof BotError ? (err.ctx as Ctx) : undefined;

    // В лог — только описание: объект ошибки grammY несёт в себе токен бота.
    if (e instanceof GrammyError) this.log.error(`Telegram: ${e.description} (${e.method})`);
    else if (e instanceof HttpError) this.log.error(`Сеть: ${e.message}`);
    else if (e instanceof Error) this.log.error(`Необработанная ошибка: ${e.message}`, e.stack);
    else this.log.error(`Необработанная ошибка: ${String(e)}`);

    // Молчание участница читает как «бот сломался насовсем».
    if (!ctx?.chat || ctx.chat.type !== 'private' || typeof ctx.t !== 'function') return;
    try {
      await ctx.reply(await ctx.t('something_went_wrong'));
    } catch {
      // Не вышло извиниться — в логе уже всё есть.
    }
  }

  /** Подкладывает участницу и язык, чтобы обработчики не ходили в базу сами. */
  private async loadParticipant(ctx: Ctx, next: () => Promise<void>): Promise<void> {
    if (ctx.from && !ctx.from.is_bot) {
      ctx.participant = await this.participants.ensure({
        tgUserId: String(ctx.from.id),
        chatId: String(ctx.chat?.id ?? ctx.from.id),
        firstName: ctx.from.first_name ?? '',
        lastName: ctx.from.last_name ?? '',
        username: ctx.from.username,
      });
      ctx.lang = ctx.participant.lang;
    } else {
      ctx.lang = 'kg';
    }

    ctx.t = (key, values) => this.settings.t(key, ctx.lang, values);
    await next();
  }

  private async onChatMember(ctx: Ctx): Promise<void> {
    const status = ctx.myChatMember?.new_chat_member.status;
    if (!ctx.from) return;

    const participant = await this.participants.byTgUserId(String(ctx.from.id));
    if (!participant) return;

    if (status === 'kicked') await this.participants.setBlocked(participant.id, true);
    else if (status === 'member') await this.participants.setBlocked(participant.id, false);
  }

  private async onText(ctx: Ctx): Promise<void> {
    const text = ctx.message?.text?.trim();
    if (!text || !ctx.participant) return;

    // Ответ на вопрос отчёта.
    if (await this.report.onTextAnswer(ctx, text)) return;

    // Выбор города или ввод названия.
    if (ctx.session.step === 'choose_location' || ctx.session.step === 'location_search') {
      if (await this.registration.onLocationText(ctx, text)) return;
    }

    // Кнопки главной клавиатуры: надписи лежат в bot_texts, поэтому нажатие
    // узнаём по тексту, а не по месту кнопки в ряду. Старую клавиатуру тоже
    // узнаём — и подменяем её новой, иначе кнопка молчала бы до перерегистрации.
    const current = await this.settings.menuAction(text);
    const legacy = current ? null : matchLegacyMenu(text);
    if (legacy) await this.registration.showMainKeyboard(ctx);

    switch (current ?? legacy) {
      case 'report':
        return this.commands.onOtchet(ctx);
      case 'reports':
        return this.commands.onBall(ctx);
      case 'goals':
        return this.profile.onGoals(ctx);
      case 'about':
        return this.profile.onAbout(ctx);
      case 'zone':
        return this.registration.askLocation(ctx);
      case 'help':
        return this.commands.onHelp(ctx);
    }

    // Цель марафона — такой же ожидаемый ответ, как ответ на вопрос темы.
    // Разбирается после меню: нажатую кнопку нельзя записать в цель.
    if (await this.registration.onGoalText(ctx, text)) return;

    await this.sayVideoOnly(ctx);
  }

  private async sayVideoOnly(ctx: Ctx): Promise<void> {
    const last = ctx.session.videoOnlyAt ?? 0;
    if (Date.now() - last < VIDEO_ONLY_COOLDOWN_MS) return;
    ctx.session.videoOnlyAt = Date.now();
    await ctx.reply(await ctx.t('video_only'));
  }

  /** Отправка с нарезкой по 4096; клавиатура вешается на последнюю часть. */
  async send(chatId: string | number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
    const parts = splitMessage(text);
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      await this.bot.api.sendMessage(chatId, parts[i], isLast ? extra : undefined);
    }
  }

  async startPolling(): Promise<void> {
    // Проверяем токен до запуска раннера: иначе ошибка всплывёт асинхронно и уронит процесс.
    await this.bot.init();
    await this.applyBotProfile();
    this.runner = run(this.bot);
    this.log.log(`Бот запущен в режиме long polling: @${this.bot.botInfo.username}`);
  }

  async setupWebhook(): Promise<void> {
    const { PUBLIC_URL, WEBHOOK_SECRET } = env();
    await this.applyBotProfile();
    await this.bot.api.setWebhook(`${PUBLIC_URL}/telegram/webhook`, {
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: false,
    });
    await this.bot.init();
    this.log.log(`Вебхук установлен: ${PUBLIC_URL}/telegram/webhook`);
  }

  /** Команды и описания из настроек — они общие для всех марафонов. */
  private async applyBotProfile(): Promise<void> {
    const s = await this.settings.getSettings();
    if (s.commands.length === 0) return;
    try {
      await this.bot.api.setMyCommands(s.commands, { language_code: 'ru' });
      await this.bot.api.setMyCommands(s.commands);
      if (s.description) await this.bot.api.setMyDescription(s.description);
      if (s.shortDescription) await this.bot.api.setMyShortDescription(s.shortDescription);
    } catch (err) {
      this.log.warn(`Не удалось применить профиль бота: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner?.stop();
  }
}
