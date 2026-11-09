import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { autoRetry } from '@grammyjs/auto-retry';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { Bot, GrammyError, HttpError, session } from 'grammy';
import { env } from '../config/env';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { splitMessage } from '../domain/text';
import { ParticipantsService } from '../services/participants.service';
import { SettingsService } from '../services/settings.service';
import type { Ctx } from './context';
import { isPrivate } from './context';
import { CommandsFlow } from './flows/commands.flow';
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

    // Кнопки главной клавиатуры и ввод в активном флоу.
    this.bot.on('message:text', (ctx) => this.onText(ctx));

    // Всё прочее — отчёт принимается только видеокружком.
    this.bot.on(
      ['message:photo', 'message:video', 'message:document', 'message:voice', 'message:audio', 'message:sticker'],
      (ctx) => this.sayVideoOnly(ctx),
    );

    this.bot.catch((err) => {
      const e = err.error;
      if (e instanceof GrammyError) this.log.error(`Telegram: ${e.description}`);
      else if (e instanceof HttpError) this.log.error(`Сеть: ${e.message}`);
      else this.log.error(`Необработанная ошибка: ${String(e)}`);
    });
  }

  /** Подкладывает участницу и язык, чтобы обработчики не ходили в базу сами. */
  private async loadParticipant(ctx: Ctx, next: () => Promise<void>): Promise<void> {
    if (ctx.from && !ctx.from.is_bot) {
      ctx.participant = await this.participants.ensure({
        tgUserId: String(ctx.from.id),
        chatId: String(ctx.chat?.id ?? ctx.from.id),
        firstName: ctx.from.first_name ?? '',
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

    // Кнопки главной клавиатуры.
    const { menu } = await this.settings.getSettings();
    // Четыре кнопки ведут в /otchet, /ball, /zona и /help — больше в меню ничего нет.
    const index = menu.indexOf(text);
    if (index >= 0) {
      switch (index) {
        case 0:
          return this.commands.onOtchet(ctx);
        case 1:
          return this.commands.onBall(ctx);
        case 2:
          return this.registration.askLocation(ctx);
        case 3:
          return this.commands.onHelp(ctx);
      }
    }

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
