import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { GrammyError, type Api } from 'grammy';
import type { ChatMember } from 'grammy/types';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { botChannels, enrollments, marathons, participants, reports, topics } from '../db/schema';
import {
  linkMatchesChat, parseChannelLink, rightsOf, rightsReady, type BotRights,
} from '../domain/channel';
import { NAMAZ_BY_ID, type NamazId } from '../domain/namaz';
import type { Lang } from '../domain/text';
import { SettingsService } from './settings.service';

/** То, что панель знает о канале марафона. */
export interface ChannelSummary {
  /** Ссылка, которую вставил админ. */
  link: string | null;
  chatId: string | null;
  title: string | null;
  /** Ссылка с заявкой — её получают участницы. */
  inviteLink: string | null;
  rights: BotRights;
  /** Закрытый канал: без публичного имени чужие его не найдут. */
  isPrivate: boolean;
  protectedContent: boolean;
  /** Бот публикует отчёты и впускает участниц. */
  ready: boolean;
}

/** Решение по заявке на вступление. `act: false` — заявка не наша, её разберут админы. */
export type JoinDecision =
  | { act: false }
  | { act: true; approve: boolean; enrollmentId?: string; lang: Lang };

/** Отчёт, который ждёт публикации в канале. */
export interface PendingPost {
  reportId: string;
  chatId: string;
  fileId: string;
  durationSec: number | null;
  topicKind: 'namaz' | 'custom';
  topicId: string;
  dayKey: string;
  attempts: number;
  enrollmentStatus: string;
  firstName: string;
  lastName: string;
  placeLabel: string | null;
  lang: Lang;
  startDate: string;
}

/** Ошибка, которую панель показывает админу как есть. */
export class ChannelError extends Error {}

const NO_RIGHTS: BotRights = { admin: false, post: false, invite: false, restrict: false };
const ADMIN_STATUSES = ['administrator', 'creator'];

/**
 * Канал отчётов марафона.
 *
 * Telegram-вызовы делают те, у кого есть клиент API: обработчик апдейта, воркер
 * или контроллер панели передают его параметром. Иначе сервис тянул бы за
 * собой бота, а бот — сервис, и модули замкнулись бы в кольцо.
 */
@Injectable()
export class ChannelsService {
  private readonly log = new Logger(ChannelsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /* ───────── сводка для панели и проверки запуска ───────── */

  async summaries(marathonIds?: string[]): Promise<Map<string, ChannelSummary>> {
    if (marathonIds && marathonIds.length === 0) return new Map();
    const rows = await this.db
      .select({ m: marathons, bc: botChannels })
      .from(marathons)
      .leftJoin(botChannels, eq(botChannels.chatId, marathons.channelChatId))
      .where(marathonIds ? inArray(marathons.id, marathonIds) : undefined);

    return new Map(rows.map(({ m, bc }) => [m.id, toSummary(m, bc)]));
  }

  async summary(marathonId: string): Promise<ChannelSummary> {
    return (await this.summaries([marathonId])).get(marathonId) ?? toSummary(null, null);
  }

  /** Каналы, где бот админ, но которые ни к одному марафону не привязаны. */
  async freeChannels() {
    const taken = this.db
      .select({ id: marathons.channelChatId })
      .from(marathons)
      .where(isNotNull(marathons.channelChatId));
    return this.db
      .select()
      .from(botChannels)
      .where(and(inArray(botChannels.status, ADMIN_STATUSES), notInArray(botChannels.chatId, taken)))
      .orderBy(asc(botChannels.title));
  }

  /** Сколько участниц получили кнопку и сколько уже в канале. */
  async counts(marathonId: string): Promise<{ total: number; invited: number; joined: number }> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        invited: sql<number>`count(${enrollments.channelInvitedAt})::int`,
        joined: sql<number>`count(${enrollments.channelJoinedAt})::int`,
      })
      .from(enrollments)
      .where(and(eq(enrollments.marathonId, marathonId), ne(enrollments.status, 'left')));
    return row ?? { total: 0, invited: 0, joined: 0 };
  }

  /* ───────── бота добавили в канал или поменяли ему права ───────── */

  async onBotMembership(
    api: Api,
    chat: { id: number; title?: string; username?: string },
    member: ChatMember,
    addedBy?: number,
  ): Promise<void> {
    const chatId = String(chat.id);
    const rights = rightsOf(member);
    await this.saveChannel(api, chatId, { title: chat.title ?? '', username: chat.username ?? null, status: member.status, rights, addedBy });

    if (!rights.admin) {
      this.log.warn(`Бота убрали из канала ${chatId} (${member.status})`);
      return;
    }

    const [linked] = await this.db.select().from(marathons).where(eq(marathons.channelChatId, chatId)).limit(1);
    if (linked) {
      await this.db.update(marathons).set({ channelTitle: chat.title ?? linked.channelTitle }).where(eq(marathons.id, linked.id));
      await this.ensureInviteLink(api, linked.id);
      return;
    }
    await this.autoLinkByChat(api, chatId);
  }

  /**
   * Записывает канал: основную ссылку и «запрет копирования» видно только
   * через getChat, а ссылку — лишь при праве приглашать.
   */
  private async saveChannel(
    api: Api,
    chatId: string,
    input: { title: string; username: string | null; status: string; rights: BotRights; addedBy?: number },
  ): Promise<void> {
    let { title, username } = input;
    let inviteLink: string | null = null;
    let protectedContent = false;

    if (input.rights.admin) {
      try {
        const full = await api.getChat(chatId);
        title = ('title' in full && full.title) || title;
        username = ('username' in full && full.username) || null;
        inviteLink = full.invite_link ?? null;
        protectedContent = !!full.has_protected_content;
      } catch (err) {
        this.log.warn(`getChat ${chatId}: ${describe(err)}`);
      }
    }

    const values = {
      title,
      username,
      status: input.status,
      canPost: input.rights.post,
      canInvite: input.rights.invite,
      canRestrict: input.rights.restrict,
      protectedContent,
      updatedAt: new Date(),
    };
    await this.db
      .insert(botChannels)
      .values({ chatId, ...values, inviteLink, addedBy: input.addedBy ? String(input.addedBy) : null })
      .onConflictDoUpdate({
        target: botChannels.chatId,
        // Без права приглашать Telegram не отдаёт ссылку — прежнюю не затираем.
        set: { ...values, inviteLink: sql`coalesce(${inviteLink}, ${botChannels.inviteLink})` },
      });
  }

  /** Бот только что стал админом: ищем марафон, чья ссылка ведёт в этот канал. */
  private async autoLinkByChat(api: Api, chatId: string): Promise<void> {
    const [bc] = await this.db.select().from(botChannels).where(eq(botChannels.chatId, chatId)).limit(1);
    if (!bc) return;

    const waiting = await this.db
      .select()
      .from(marathons)
      .where(and(isNull(marathons.channelChatId), isNotNull(marathons.channelLink)));
    const hits = waiting.filter((m) => linkMatchesChat(parseChannelLink(m.channelLink ?? ''), bc));

    // Одна и та же ссылка у двух марафонов — пусть выберет админ в панели.
    if (hits.length === 1) await this.connect(api, hits[0].id, chatId);
  }

  /** Админ вставил ссылку, а бот уже в канале: привязываем сразу. */
  async autoLinkMarathon(api: Api, marathonId: string): Promise<boolean> {
    const [m] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);
    if (!m || m.channelChatId || !m.channelLink) return false;

    const link = parseChannelLink(m.channelLink);
    const hits = (await this.freeChannels()).filter((c) => linkMatchesChat(link, c));
    if (hits.length !== 1) return false;

    await this.connect(api, marathonId, hits[0].chatId);
    return true;
  }

  /** Привязывает канал к марафону и пишет туда первое сообщение. */
  async connect(api: Api, marathonId: string, chatId: string): Promise<void> {
    const [bc] = await this.db.select().from(botChannels).where(eq(botChannels.chatId, chatId)).limit(1);
    if (!bc || !ADMIN_STATUSES.includes(bc.status)) {
      throw new ChannelError('Бот не админ в этом канале — сначала добавьте его');
    }

    const [other] = await this.db
      .select()
      .from(marathons)
      .where(and(eq(marathons.channelChatId, chatId), ne(marathons.id, marathonId)))
      .limit(1);
    if (other) throw new ChannelError(`Этот канал уже привязан к марафону «${other.name}»`);

    const [m] = await this.db
      .update(marathons)
      .set({ channelChatId: chatId, channelTitle: bc.title, channelInviteLink: null })
      .where(eq(marathons.id, marathonId))
      .returning();
    if (!m) throw new ChannelError('Марафон не найден');

    this.log.log(`Канал «${bc.title}» привязан к марафону ${m.code}`);
    await this.ensureInviteLink(api, marathonId);

    // Первое сообщение в канале — админ сразу видит, что бот работает.
    if (bc.canPost) {
      try {
        await api.sendMessage(chatId, await this.settings.t('channel_connected_post', m.defaultLang, { марафон: m.name }));
      } catch (err) {
        this.log.warn(`Приветствие в канал ${chatId}: ${describe(err)}`);
      }
    }
  }

  /** Отвязывает канал. Участницам потом придёт новая кнопка — уже в новый канал. */
  async disconnect(api: Api, marathonId: string): Promise<void> {
    const [m] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);
    if (!m) throw new ChannelError('Марафон не найден');

    if (m.channelChatId && m.channelInviteLink) {
      await api.revokeChatInviteLink(m.channelChatId, m.channelInviteLink).catch(() => undefined);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(marathons)
        .set({ channelChatId: null, channelTitle: null, channelInviteLink: null })
        .where(eq(marathons.id, marathonId));
      await tx
        .update(enrollments)
        .set({ channelInvitedAt: null, channelJoinedAt: null })
        .where(eq(enrollments.marathonId, marathonId));
      const ids = tx.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.marathonId, marathonId));
      await tx
        .update(reports)
        .set({ channelState: 'skipped' })
        .where(and(eq(reports.channelState, 'pending'), inArray(reports.enrollmentId, ids)));
    });
  }

  /** Ссылка с заявкой: по ней участница стучится в канал, а бот открывает. */
  async ensureInviteLink(api: Api, marathonId: string): Promise<void> {
    const [row] = await this.db
      .select({ m: marathons, bc: botChannels })
      .from(marathons)
      .innerJoin(botChannels, eq(botChannels.chatId, marathons.channelChatId))
      .where(eq(marathons.id, marathonId))
      .limit(1);
    if (!row || row.m.channelInviteLink || !row.bc.canInvite) return;

    try {
      const link = await api.createChatInviteLink(row.bc.chatId, {
        // Имя ссылки видят админы канала: по нему ясно, откуда заявки.
        name: `Janykadam · ${row.m.code}`.slice(0, 32),
        creates_join_request: true,
      });
      await this.db.update(marathons).set({ channelInviteLink: link.invite_link }).where(eq(marathons.id, marathonId));
    } catch (err) {
      this.log.warn(`Ссылка-приглашение для ${row.m.code}: ${describe(err)}`);
    }
  }

  /** Живая проверка из панели: права и «запрет копирования» меняются без апдейтов. */
  async refresh(api: Api, botId: number, marathonId: string): Promise<void> {
    const [m] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);
    if (!m?.channelChatId) return;

    const chatId = m.channelChatId;
    try {
      const member = await api.getChatMember(chatId, botId);
      const rights = rightsOf(member);
      const [bc] = await this.db.select().from(botChannels).where(eq(botChannels.chatId, chatId)).limit(1);
      await this.saveChannel(api, chatId, {
        title: bc?.title ?? m.channelTitle ?? '',
        username: bc?.username ?? null,
        status: member.status,
        rights,
      });
      const [fresh] = await this.db.select().from(botChannels).where(eq(botChannels.chatId, chatId)).limit(1);
      if (fresh?.title) await this.db.update(marathons).set({ channelTitle: fresh.title }).where(eq(marathons.id, marathonId));
      if (rightsReady(rights)) await this.ensureInviteLink(api, marathonId);
    } catch (err) {
      // Канал удалили или бота выгнали: Telegram отвечает 400/403.
      if (err instanceof GrammyError && (err.error_code === 400 || err.error_code === 403)) {
        await this.db
          .update(botChannels)
          .set({ status: 'left', canPost: false, canInvite: false, canRestrict: false, updatedAt: new Date() })
          .where(eq(botChannels.chatId, chatId));
        return;
      }
      throw err;
    }
  }

  /* ───────── участницы ───────── */

  /**
   * Заявка в канал. Разбираем только те, что пришли по ссылке бота: заявки по
   * другим ссылкам — дело админов канала, например для кураторов.
   */
  async joinDecision(chatId: string, tgUserId: string, viaLink: string | undefined): Promise<JoinDecision> {
    const [m] = await this.db.select().from(marathons).where(eq(marathons.channelChatId, chatId)).limit(1);
    if (!m || !m.channelInviteLink || viaLink !== m.channelInviteLink) return { act: false };

    const [row] = await this.db
      .select({ p: participants, e: enrollments })
      .from(participants)
      .leftJoin(enrollments, and(eq(enrollments.participantId, participants.id), eq(enrollments.marathonId, m.id)))
      .where(eq(participants.tgUserId, tgUserId))
      .limit(1);

    const lang = (row?.p.lang ?? m.defaultLang) as Lang;
    const enrolled = !!row?.e && row.e.status !== 'left';
    return { act: true, approve: enrolled, enrollmentId: row?.e?.id, lang };
  }

  async markJoined(enrollmentId: string): Promise<void> {
    await this.db.update(enrollments).set({ channelJoinedAt: new Date() }).where(eq(enrollments.id, enrollmentId));
  }

  async markInvited(enrollmentId: string): Promise<void> {
    await this.db.update(enrollments).set({ channelInvitedAt: new Date() }).where(eq(enrollments.id, enrollmentId));
  }

  async markRemoved(enrollmentId: string): Promise<void> {
    await this.db.update(enrollments).set({ channelJoinedAt: null }).where(eq(enrollments.id, enrollmentId));
  }

  /** Ссылка для кнопки «вступить» — только если канал готов принимать. */
  async inviteLinkOf(marathonId: string): Promise<string | null> {
    const s = await this.summary(marathonId);
    return s.ready ? s.inviteLink : null;
  }

  /**
   * Кому ещё не прислали кнопку. Свежих не трогаем: только что записавшаяся
   * получает кнопку в приветствии, а воркер не должен влезть посреди вопроса о цели.
   */
  async pendingInvites(limit: number, olderThan: Date) {
    return this.db
      .select({ enrollmentId: enrollments.id, marathonId: marathons.id, inviteLink: marathons.channelInviteLink })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .innerJoin(botChannels, eq(botChannels.chatId, marathons.channelChatId))
      .where(
        and(
          isNotNull(marathons.channelInviteLink),
          inArray(botChannels.status, ADMIN_STATUSES),
          isNull(enrollments.channelInvitedAt),
          isNull(enrollments.channelJoinedAt),
          inArray(enrollments.status, ['active', 'paused']),
          eq(participants.blocked, false),
          lt(enrollments.createdAt, olderThan),
          inArray(marathons.status, ['recruiting', 'running']),
        ),
      )
      .orderBy(asc(enrollments.createdAt))
      .limit(limit);
  }

  /** Кого убрали из марафона, а из канала ещё нет. */
  async pendingRemovals(limit: number) {
    return this.db
      .select({ enrollmentId: enrollments.id, chatId: marathons.channelChatId, tgUserId: participants.tgUserId })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .innerJoin(botChannels, eq(botChannels.chatId, marathons.channelChatId))
      .where(
        and(
          eq(enrollments.status, 'left'),
          isNotNull(enrollments.channelJoinedAt),
          eq(botChannels.canRestrict, true),
          inArray(botChannels.status, ADMIN_STATUSES),
        ),
      )
      .limit(limit);
  }

  /* ───────── отчёты ───────── */

  /** Канал марафона, если в нём сейчас можно публиковать: тогда отчёт ставится в очередь. */
  async chatForEnrollment(enrollmentId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ chatId: marathons.channelChatId })
      .from(enrollments)
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);
    return row?.chatId ?? null;
  }

  /** Очередь публикации: от старых к новым, только в каналы, где бот может писать. */
  async pendingPosts(limit: number): Promise<PendingPost[]> {
    const rows = await this.db
      .select({
        reportId: reports.id,
        chatId: marathons.channelChatId,
        fileId: reports.videoFileId,
        durationSec: reports.videoDurationSec,
        topicKind: reports.topicKind,
        topicId: reports.topicId,
        dayKey: reports.dayKey,
        attempts: reports.channelAttempts,
        enrollmentStatus: enrollments.status,
        firstName: participants.firstName,
        lastName: participants.lastName,
        placeLabel: participants.placeLabel,
        lang: marathons.defaultLang,
        startDate: marathons.startDate,
      })
      .from(reports)
      .innerJoin(enrollments, eq(enrollments.id, reports.enrollmentId))
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .innerJoin(botChannels, eq(botChannels.chatId, marathons.channelChatId))
      .where(and(eq(reports.channelState, 'pending'), eq(botChannels.canPost, true), inArray(botChannels.status, ADMIN_STATUSES)))
      .orderBy(asc(reports.submittedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, chatId: r.chatId!, lang: r.lang as Lang }));
  }

  async markPosted(reportId: string, chatId: string, messageId: number): Promise<void> {
    await this.db
      .update(reports)
      .set({ channelState: 'posted', channelChatId: chatId, channelMessageId: messageId })
      .where(eq(reports.id, reportId));
  }

  /** Неудачная попытка; после пятой отчёт больше не пробуем. */
  async markFailed(reportId: string, attempts: number): Promise<void> {
    await this.db
      .update(reports)
      .set({ channelAttempts: attempts, channelState: attempts >= 5 ? 'failed' : 'pending' })
      .where(eq(reports.id, reportId));
  }

  async markSkipped(reportId: string): Promise<void> {
    await this.db.update(reports).set({ channelState: 'skipped' }).where(eq(reports.id, reportId));
  }

  /** Название темы для подписи: эмодзи и имя на языке канала. */
  async topicLabel(kind: 'namaz' | 'custom', topicId: string, lang: Lang): Promise<string> {
    if (kind === 'namaz') {
      const n = NAMAZ_BY_ID.get(topicId as NamazId);
      if (!n) return topicId;
      return `${n.emoji} ${lang === 'kg' ? n.nameKg || n.nameRu : n.nameRu || n.nameKg}`;
    }
    const [t] = await this.db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
    if (!t) return '';
    return `${t.emoji} ${lang === 'kg' ? t.nameKg || t.nameRu : t.nameRu || t.nameKg}`;
  }
}

function toSummary(
  m: typeof marathons.$inferSelect | null,
  bc: typeof botChannels.$inferSelect | null,
): ChannelSummary {
  const connected = !!m?.channelChatId && !!bc;
  const rights: BotRights =
    connected && ADMIN_STATUSES.includes(bc.status)
      ? { admin: true, post: bc.canPost, invite: bc.canInvite, restrict: bc.canRestrict }
      : NO_RIGHTS;
  return {
    link: m?.channelLink ?? null,
    chatId: m?.channelChatId ?? null,
    title: m?.channelTitle ?? bc?.title ?? null,
    inviteLink: m?.channelInviteLink ?? null,
    rights,
    isPrivate: connected ? !bc.username : true,
    protectedContent: connected ? bc.protectedContent : false,
    ready: connected && rightsReady(rights) && !!m?.channelInviteLink,
  };
}

function describe(err: unknown): string {
  if (err instanceof GrammyError) return `${err.error_code}: ${err.description}`;
  return err instanceof Error ? err.message : String(err);
}
