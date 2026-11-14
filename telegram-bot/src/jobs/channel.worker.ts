import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { GrammyError, InputFile } from 'grammy';
import { BotService } from '../bot/bot.service';
import { channelKeyboard } from '../bot/keyboards';
import { env } from '../config/env';
import { CAPTION_LIMIT } from '../domain/channel';
import { marathonDayNumber } from '../domain/windows';
import { ChannelsService, type PendingPost } from '../services/channels.service';
import { NotifyService } from '../services/notify.service';
import { SettingsService } from '../services/settings.service';
import { BossService, QUEUE } from './boss.service';

/** Новенькую не трогаем десять минут: кнопку она получит в приветствии. */
const INVITE_GRACE_MS = 10 * 60_000;

/**
 * Канал марафона, раз в минуту:
 * — присылает кнопку «вступить» тем, кто записался до того, как канал подключили;
 * — убирает из канала исключённых из марафона;
 * — публикует принятые видеоотчёты с подписью.
 *
 * Кружок нельзя переслать в канал с подписью: у видеокружков подписей не
 * бывает, а сменить тип файла по file_id Telegram не даёт. Поэтому бот скачивает
 * кружок и выкладывает его обычным видео — так выглядят посты, которые клиент
 * делала вручную. Не вышло скачать (файл больше 20 МБ) — кружок и подпись
 * ответом на него.
 */
@Injectable()
export class ChannelWorker implements OnModuleInit {
  private readonly log = new Logger(ChannelWorker.name);

  /** Пауза между постами в один канал: Telegram пускает около 20 сообщений в минуту. */
  gapMs = 3_100;
  /** Длина одного прохода — расписание срабатывает раз в минуту. */
  budgetMs = 50_000;

  private readonly lastPost = new Map<string, number>();
  private running = false;

  /** Скачивание файла с серверов Telegram. Подменяется в тестах. */
  download = async (filePath: string): Promise<Buffer> => {
    const res = await fetch(`https://api.telegram.org/file/bot${env().BOT_TOKEN}/${filePath}`);
    if (!res.ok) throw new Error(`скачивание: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };

  constructor(
    private readonly boss: BossService,
    private readonly bot: BotService,
    private readonly channels: ChannelsService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    const boss = await this.boss.start();
    await boss.work(QUEUE.channelSync, () => this.tick());
    await boss.schedule(QUEUE.channelSync, '* * * * *');
  }

  /** Один проход. Публичный — тесты зовут его напрямую. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const deadline = Date.now() + this.budgetMs;
    try {
      await this.step('приглашения', () => this.sendInvites());
      await this.step('исключённые', () => this.removeLeft());
      await this.step('отчёты', () => this.postReports(deadline));
    } finally {
      this.running = false;
    }
  }

  /** Сбой одной части не должен останавливать остальные. */
  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log.error(`Канал, ${name}: ${describe(err)}`);
    }
  }

  /* ───────── приглашения ───────── */

  private async sendInvites(): Promise<void> {
    const rows = await this.channels.pendingInvites(200, new Date(Date.now() - INVITE_GRACE_MS));
    for (const row of rows) {
      const r = await this.notify.recipientOf(row.enrollmentId);
      if (!r || !row.inviteLink) continue;

      const out = await this.notify.send(r, await this.settings.t('channel_invite', r.lang, { марафон: r.marathonName }), {
        replyMarkup: channelKeyboard(await this.settings.t('btn_channel_join', r.lang), row.inviteLink),
      });
      // Заблокировала бота — писать больше незачем; сбой — попробуем в следующий раз.
      if (out.status !== 'failed') await this.channels.markInvited(row.enrollmentId);
    }
  }

  /* ───────── исключённые ───────── */

  private async removeLeft(): Promise<void> {
    const api = this.bot.bot.api;
    for (const row of await this.channels.pendingRemovals(50)) {
      try {
        // Без only_if_banned разбан выводит из канала, но не закрывает вход:
        // вернётся в марафон — вступит снова по кнопке.
        await api.unbanChatMember(row.chatId!, Number(row.tgUserId));
        await this.channels.markRemoved(row.enrollmentId);
      } catch (err) {
        this.log.warn(`Убрать из канала ${row.enrollmentId}: ${describe(err)}`);
        // Её уже нет в канале или она не найдена — повторять бессмысленно.
        if (err instanceof GrammyError && err.error_code === 400) await this.channels.markRemoved(row.enrollmentId);
      }
    }
  }

  /* ───────── отчёты ───────── */

  private async postReports(deadline: number): Promise<void> {
    const batch = await this.channels.pendingPosts(30);
    // Канал, где бот потерял права, пропускаем до конца прохода: панель покажет, что чинить.
    const stuck = new Set<string>();

    for (const p of batch) {
      if (Date.now() >= deadline) return;
      if (stuck.has(p.chatId)) continue;

      // Исключённую из марафона в канал не выкладываем.
      if (p.enrollmentStatus === 'left') {
        await this.channels.markSkipped(p.reportId);
        continue;
      }

      await this.pace(p.chatId);
      if ((await this.postOne(p)) === 'chat') stuck.add(p.chatId);
    }
  }

  private async pace(chatId: string): Promise<void> {
    const wait = (this.lastPost.get(chatId) ?? 0) + this.gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastPost.set(chatId, Date.now());
  }

  /** Публикует один отчёт. `chat` — беда с каналом, а не с этим отчётом. */
  async postOne(p: PendingPost): Promise<'ok' | 'failed' | 'chat'> {
    const api = this.bot.bot.api;
    const caption = await this.caption(p);

    try {
      let messageId: number;
      try {
        const file = await api.getFile(p.fileId);
        if (!file.file_path) throw new Error('Telegram не отдал путь к файлу');
        const data = await this.download(file.file_path);
        const msg = await api.sendVideo(p.chatId, new InputFile(data, 'report.mp4'), {
          caption,
          duration: p.durationSec ?? undefined,
          supports_streaming: true,
        });
        messageId = msg.message_id;
      } catch (err) {
        if (isChatProblem(err)) throw err;
        this.log.warn(`Отчёт ${p.reportId} видео не вышло (${describe(err)}) — шлю кружком`);
        const note = await api.sendVideoNote(p.chatId, p.fileId);
        await api.sendMessage(p.chatId, caption, { reply_parameters: { message_id: note.message_id } });
        messageId = note.message_id;
      }

      await this.channels.markPosted(p.reportId, p.chatId, messageId);
      return 'ok';
    } catch (err) {
      this.log.warn(`Отчёт ${p.reportId} в канал ${p.chatId}: ${describe(err)}`);
      // Права отобрали или канал удалили — отчёт тут ни при чём, попытку не считаем.
      if (isChatProblem(err)) return 'chat';
      await this.channels.markFailed(p.reportId, p.attempts + 1);
      return 'failed';
    }
  }

  /** Подпись на языке марафона: канал у всех участниц один. */
  async caption(p: PendingPost): Promise<string> {
    const text = await this.settings.t('channel_report_caption', p.lang, {
      тема: await this.channels.topicLabel(p.topicKind, p.topicId, p.lang),
      имя: [p.firstName, p.lastName].map((x) => x.trim()).filter(Boolean).join(' ') || '—',
      город: p.placeLabel?.trim() || '—',
      день: marathonDayNumber(p.startDate, p.dayKey),
    });
    return text.slice(0, CAPTION_LIMIT);
  }
}

/** Ошибка канала целиком: бота убрали, отобрали права, канал удалён. */
function isChatProblem(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  if (err.error_code === 403) return true;
  return err.error_code === 400 && /chat not found|not enough rights|have no rights|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|need administrator rights/i.test(err.description);
}

function describe(err: unknown): string {
  if (err instanceof GrammyError) return `${err.error_code}: ${err.description}`;
  return err instanceof Error ? err.message : String(err);
}
