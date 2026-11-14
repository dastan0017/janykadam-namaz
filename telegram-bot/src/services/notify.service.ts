import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { GrammyError } from 'grammy';
import { BotService } from '../bot/bot.service';
import { submitForKeyboard } from '../bot/keyboards';
import { env } from '../config/env';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { enrollments, participants, remindersLog } from '../db/schema';
import type { Lang } from '../domain/text';
import { ParticipantsService } from './participants.service';
import { SettingsService } from './settings.service';

/**
 * Глобальный предел отправки на всё — и напоминания, и рассылки: у Telegram он
 * общий на бота, а не на чат. Значение берётся из `MAX_MSG_PER_SECOND` (25).
 */
function maxPerSecond(): number {
  return env().MAX_MSG_PER_SECOND;
}

/** Исход одной отправки. `error` заполняется только у `failed`. */
export interface SendOutcome {
  status: 'sent' | 'blocked' | 'failed';
  error?: string;
}

interface Recipient {
  participantId: string;
  chatId: string;
  lang: Lang;
  enrollmentId: string;
  marathonName: string;
}

/**
 * Отправка участницам.
 *
 * Держит общий ограничитель скорости и приписывает метку марафона, если
 * участница ведёт больше одного: в одном чате иначе не различить, откуда напоминание.
 */
@Injectable()
export class NotifyService {
  private readonly log = new Logger(NotifyService.name);
  private queue: Promise<void> = Promise.resolve();
  private windowStart = Date.now();
  private sentInWindow = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly bot: BotService,
    private readonly participants: ParticipantsService,
    private readonly settings: SettingsService,
  ) {}

  /** Пропускает не больше `MAX_MSG_PER_SECOND` вызовов в секунду. */
  private async throttle(): Promise<void> {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.sentInWindow = 0;
    }
    if (this.sentInWindow >= maxPerSecond()) {
      const wait = 1000 - (now - this.windowStart);
      await new Promise((r) => setTimeout(r, Math.max(1, wait)));
      this.windowStart = Date.now();
      this.sentInWindow = 0;
    }
    this.sentInWindow++;
  }

  /**
   * Отправляет текст участнице. Все вызовы выстраиваются в одну очередь, чтобы
   * ограничитель был общим.
   *
   * Исход различается: `blocked` — участница заблокировала бота (403), и писать
   * ей больше не нужно; `failed` — отправка не удалась по другой причине, и это
   * не её решение. Для рассылки разница видна в панели, поэтому возвращаем не
   * «да/нет», а три состояния.
   */
  async send(r: Recipient, text: string, opts: { withSwitchButton?: boolean } = {}): Promise<SendOutcome> {
    const run = async (): Promise<SendOutcome> => {
      await this.throttle();

      const several = (await this.participants.countActiveEnrollments(r.participantId)) > 1;
      const body = several
        ? `${await this.settings.t('two_marathons_prefix', r.lang, { марафон: r.marathonName })}${text}`
        : text;

      const extra =
        several && opts.withSwitchButton
          ? {
              reply_markup: submitForKeyboard(
                r.enrollmentId,
                await this.settings.t('btn_submit_for', r.lang, { марафон: r.marathonName }),
              ),
            }
          : {};

      try {
        await this.bot.send(r.chatId, body, extra);
        return { status: 'sent' };
      } catch (err) {
        // 403 — бот заблокирован; помечаем и больше не пытаемся.
        if (err instanceof GrammyError && err.error_code === 403) {
          await this.participants.setBlocked(r.participantId, true);
          return { status: 'blocked' };
        }
        const error = err instanceof GrammyError ? `${err.error_code}: ${err.description}` : String(err);
        this.log.warn(`Не удалось отправить ${r.participantId}: ${error}`);
        return { status: 'failed', error };
      }
    };

    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Данные для отправки по id записи. */
  async recipientOf(enrollmentId: string): Promise<(Recipient & { blocked: boolean; status: string }) | null> {
    const [row] = await this.db
      .select({
        participantId: participants.id,
        chatId: participants.chatId,
        lang: participants.lang,
        blocked: participants.blocked,
        tahajjud: participants.tahajjudReminders,
        tz: participants.tz,
        lat: participants.lat,
        lng: participants.lng,
        enrollmentId: enrollments.id,
        status: enrollments.status,
        marathonId: enrollments.marathonId,
      })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);

    if (!row) return null;
    const marathon = await this.participants.marathonById(row.marathonId);
    if (!marathon) return null;

    return {
      participantId: row.participantId,
      chatId: row.chatId,
      lang: row.lang,
      enrollmentId: row.enrollmentId,
      marathonName: marathon.name,
      blocked: row.blocked,
      status: row.status,
    };
  }

  /** Сколько напоминаний уже ушло этой участнице за день — для дневного лимита. */
  /**
   * Сколько напоминаний о темах ушло за день. Утреннее, вечернее и отметка
   * об оценке дня лежат в том же журнале, но в лимит не входят: раньше они
   * съедали его, и до тем напоминаний доходило меньше, чем стоял лимит.
   */
  async sentToday(enrollmentId: string, dayKey: string): Promise<number> {
    const rows = await this.db
      .select({ id: remindersLog.id })
      .from(remindersLog)
      .where(
        and(
          eq(remindersLog.enrollmentId, enrollmentId),
          eq(remindersLog.dayKey, dayKey),
          eq(remindersLog.kind, 'topic'),
        ),
      );
    return rows.length;
  }

  /**
   * Записывает факт отправки. Уникальный индекс не даст повторить напоминание
   * после перезапуска: если строка уже есть, отправлять не нужно.
   */
  async markSent(enrollmentId: string, kind: string, topicId: string | null, dayKey: string): Promise<boolean> {
    const rows = await this.db
      .insert(remindersLog)
      .values({ enrollmentId, kind, topicId, dayKey })
      .onConflictDoNothing()
      .returning({ id: remindersLog.id });
    return rows.length > 0;
  }

  /** Все активные записи участниц, которым что-то шлём массово. */
  async activeRecipients(marathonId: string, participantIds?: string[]): Promise<Recipient[]> {
    const rows = await this.db
      .select({
        participantId: participants.id,
        chatId: participants.chatId,
        lang: participants.lang,
        enrollmentId: enrollments.id,
      })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(
        and(
          eq(enrollments.marathonId, marathonId),
          inArray(enrollments.status, ['active', 'paused']),
          eq(participants.blocked, false),
          ...(participantIds?.length ? [inArray(participants.id, participantIds)] : []),
        ),
      );

    const marathon = await this.participants.marathonById(marathonId);
    return rows.map((r) => ({ ...r, marathonName: marathon?.name ?? '' }));
  }
}
