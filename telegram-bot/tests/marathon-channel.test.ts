import { eq } from 'drizzle-orm';
import type { Update } from 'grammy/types';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { botChannels, enrollments, marathons, reports } from '../src/db/schema';
import { linkMatchesChat, normalizeChannelLink, parseChannelLink, rightsOf } from '../src/domain/channel';
import { validateMarathon, type MarathonInput } from '../src/domain/validation';
import {
  callbackUpdate, enrollmentOf, insertReport, makeHarness, makeParticipant, marathonIdByCode, registerInBishkek,
  textUpdate, videoNoteUpdate, wipeParticipants, wipeTestParticipant, type Harness, type SentCall,
} from './helpers/bot-harness';

/**
 * Канал отчётов марафона.
 *
 * Канал создаёт админ — бот этого не умеет, — вставляет ссылку в панель и
 * добавляет бота админом. Дальше всё делает бот: узнаёт канал по ссылке,
 * впускает участниц по заявке, выкладывает принятые кружки с подписью и
 * убирает исключённых.
 */

const CHAT_ID = -1001234567890;
const PRIMARY = 'https://t.me/+PrimaryHash12345';
const BOT_LINK = 'https://t.me/+BotJoinLink67890';
const TITLE = 'Отчёты марафона';
const BOT_USER = { id: 123456, is_bot: true, first_name: 'Janykadam', username: 'janykadam_bot' };
/** Бишкек, 8 ноября, 09:40 — открыто несколько тем, среди них «Зикир». */
const AT_0940 = new Date('2026-11-08T03:40:00Z');
const TG_PREFIX = '9130';

let h: Harness;
let m5: string;
let seq = 0;

const ok = (result: unknown) => ({ ok: true, result }) as never;

beforeAll(async () => {
  h = await makeHarness();
  m5 = await marathonIdByCode(h.db, 'm5');
  // В тестах не ждём три секунды между постами и не ходим за файлом в Telegram.
  h.channel.gapMs = 0;
  h.channel.download = async () => Buffer.from('mp4');
});

afterAll(async () => {
  await resetChannel();
  await h.close();
});

afterEach(async () => {
  vi.useRealTimers();
  await resetChannel();
  await wipeTestParticipant(h.db);
  await wipeParticipants(h.db, TG_PREFIX);
  h.reset();
});

async function resetChannel(): Promise<void> {
  await h.db
    .update(marathons)
    .set({ channelLink: null, channelChatId: null, channelTitle: null, channelInviteLink: null })
    .where(eq(marathons.id, m5));
  await h.db.delete(botChannels).where(eq(botChannels.chatId, String(CHAT_ID)));
}

/** Канал уже подключён: бот — админ со всеми правами, ссылка-заявка есть. */
async function connectChannel(rights: { post?: boolean; invite?: boolean; restrict?: boolean } = {}): Promise<void> {
  await h.db.insert(botChannels).values({
    chatId: String(CHAT_ID),
    title: TITLE,
    status: 'administrator',
    canPost: rights.post ?? true,
    canInvite: rights.invite ?? true,
    canRestrict: rights.restrict ?? true,
    protectedContent: true,
    inviteLink: PRIMARY,
  });
  await h.db
    .update(marathons)
    .set({ channelLink: PRIMARY, channelChatId: String(CHAT_ID), channelTitle: TITLE, channelInviteLink: BOT_LINK })
    .where(eq(marathons.id, m5));
}

/** Правдоподобный Telegram для канала; `extra` подменяет отдельные ответы. */
function telegram(extra: (c: SentCall) => ReturnType<typeof ok> | undefined = () => undefined): void {
  const channelChat = { id: CHAT_ID, type: 'channel', title: TITLE };
  h.setIntercept((c) => {
    const custom = extra(c);
    if (custom) return custom;
    switch (c.method) {
      case 'getChat':
        return ok({ ...channelChat, invite_link: PRIMARY, has_protected_content: true });
      case 'getChatMember':
        return ok({ status: 'administrator', user: BOT_USER, can_post_messages: true, can_invite_users: true, can_restrict_members: true });
      case 'createChatInviteLink':
        return ok({ invite_link: BOT_LINK, creator: BOT_USER, creates_join_request: true, is_primary: false, is_revoked: false });
      case 'getFile':
        return ok({ file_id: String(c.payload.file_id), file_unique_id: 'u', file_path: 'videos/file_1.mp4' });
      case 'sendVideo':
        return ok({ message_id: 501, date: 0, chat: channelChat });
      case 'sendVideoNote':
        return ok({ message_id: 601, date: 0, chat: channelChat });
      default:
        return undefined;
    }
  });
}

function calls(method: string): SentCall[] {
  return h.sent.filter((c) => c.method === method);
}

/** Апдейт «бота сделали админом канала» (или убрали — по статусу). */
function botMembership(status: 'administrator' | 'left', rights = { post: true, invite: true, restrict: true }): Partial<Update> {
  const member =
    status === 'administrator'
      ? {
          status,
          user: BOT_USER,
          can_be_edited: false,
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: false,
          can_manage_video_chats: false,
          can_restrict_members: rights.restrict,
          can_promote_members: false,
          can_change_info: false,
          can_invite_users: rights.invite,
          can_post_messages: rights.post,
        }
      : { status, user: BOT_USER };
  return {
    my_chat_member: {
      chat: { id: CHAT_ID, type: 'channel', title: TITLE },
      from: { id: 555, is_bot: false, first_name: 'Админ' },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: 'left', user: BOT_USER },
      new_chat_member: member,
    },
  } as unknown as Partial<Update>;
}

function joinRequest(userId: number, link: string): Partial<Update> {
  return {
    chat_join_request: {
      chat: { id: CHAT_ID, type: 'channel', title: TITLE },
      from: { id: userId, is_bot: false, first_name: 'Гүлнара' },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000),
      invite_link: { invite_link: link, creator: BOT_USER, creates_join_request: true, is_primary: false, is_revoked: false },
    },
  } as unknown as Partial<Update>;
}

async function marathon() {
  const [m] = await h.db.select().from(marathons).where(eq(marathons.id, m5)).limit(1);
  return m;
}

async function participant(opts: { status?: 'active' | 'left' } = {}) {
  return makeParticipant(h.db, { tgUserId: `${TG_PREFIX}${String(++seq).padStart(2, '0')}`, ...opts });
}

/** Регистрация и отчёт по «Зикиру» от тестовой участницы. */
async function submitZikr(fileUniqueId: string): Promise<void> {
  vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
  await registerInBishkek(h, AT_0940);
  h.reset();
  telegram();
  await h.feed(videoNoteUpdate({ fileUniqueId, at: AT_0940 }));
  const picker = calls('sendMessage').at(-1)!;
  const kb = picker.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
  const zikr = kb.inline_keyboard.flat().find((b) => b.text.includes('Зикир'))!;
  await h.feed(callbackUpdate(zikr.callback_data));
}

/* ───────── ссылка ───────── */

describe('ссылка на канал из панели', () => {
  it('понимает закрытые и публичные ссылки', () => {
    expect(parseChannelLink('https://t.me/+AbCdEf123456')).toEqual({ kind: 'invite', hash: 'AbCdEf123456' });
    expect(parseChannelLink('t.me/joinchat/AbCdEf123456')).toEqual({ kind: 'invite', hash: 'AbCdEf123456' });
    expect(parseChannelLink('  @Ummot_Reports ')).toEqual({ kind: 'username', username: 'ummot_reports' });
    expect(parseChannelLink('https://t.me/ummot_reports/')).toEqual({ kind: 'username', username: 'ummot_reports' });
    expect(normalizeChannelLink(parseChannelLink('telegram.me/+AbCdEf123456')!)).toBe('https://t.me/+AbCdEf123456');
  });

  it('не принимает ссылку на бота, на пост и на чужой сайт', () => {
    expect(parseChannelLink('https://t.me/janykadam_bot')).toBeNull();
    expect(parseChannelLink('https://t.me/ummot_reports/123')).toBeNull();
    expect(parseChannelLink('https://example.com/+AbCdEf123456')).toBeNull();
    expect(parseChannelLink('')).toBeNull();
  });

  it('совпадает с основной ссылкой канала или с его именем', () => {
    expect(linkMatchesChat(parseChannelLink(PRIMARY), { inviteLink: PRIMARY })).toBe(true);
    expect(linkMatchesChat(parseChannelLink('https://t.me/+Другая'), { inviteLink: PRIMARY })).toBe(false);
    expect(linkMatchesChat(parseChannelLink('@Ummot_Reports'), { username: 'ummot_reports' })).toBe(true);
  });

  it('права бота: без админки нет ничего, без приглашений канал не готов', () => {
    expect(rightsOf({ status: 'member' })).toEqual({ admin: false, post: false, invite: false, restrict: false });
    expect(rightsOf({ status: 'administrator', can_post_messages: true })).toEqual({
      admin: true, post: true, invite: false, restrict: false,
    });
  });
});

/* ───────── бота добавили в канал ───────── */

describe('бот в канале', () => {
  it('узнаёт канал по ссылке из панели, делает ссылку-заявку и пишет первое сообщение', async () => {
    await h.db.update(marathons).set({ channelLink: PRIMARY }).where(eq(marathons.id, m5));
    telegram();

    await h.feed(botMembership('administrator'));

    const m = await marathon();
    expect(m.channelChatId).toBe(String(CHAT_ID));
    expect(m.channelTitle).toBe(TITLE);
    expect(m.channelInviteLink).toBe(BOT_LINK);

    // Ссылка для участниц — с заявкой: впускает только бот, и только своих.
    expect(calls('createChatInviteLink')[0].payload.creates_join_request).toBe(true);

    const hello = calls('sendMessage').find((c) => c.payload.chat_id === String(CHAT_ID));
    expect(hello?.payload.text).toMatch(/Бот туташты/);
    expect(calls('leaveChat')).toHaveLength(0);
  });

  it('ссылка не совпала — канал ждёт выбора в панели, марафон не тронут', async () => {
    await h.db.update(marathons).set({ channelLink: 'https://t.me/+OtherHash99999' }).where(eq(marathons.id, m5));
    telegram();

    await h.feed(botMembership('administrator'));

    expect((await marathon()).channelChatId).toBeNull();
    const [bc] = await h.db.select().from(botChannels).where(eq(botChannels.chatId, String(CHAT_ID)));
    expect(bc.status).toBe('administrator');
    expect(bc.canPost && bc.canInvite).toBe(true);
  });

  it('посты в канале не выгоняют бота', async () => {
    await connectChannel();
    await h.feed({
      channel_post: { message_id: 7, date: 0, chat: { id: CHAT_ID, type: 'channel', title: TITLE }, text: 'Салам' },
    } as unknown as Partial<Update>);
    expect(calls('leaveChat')).toHaveLength(0);
    expect(calls('sendMessage')).toHaveLength(0);
  });

  it('из группы бот по-прежнему уходит', async () => {
    await h.feed({
      my_chat_member: {
        chat: { id: -4001, type: 'group', title: 'Группа' },
        from: { id: 555, is_bot: false, first_name: 'Кто-то' },
        date: 0,
        old_chat_member: { status: 'left', user: BOT_USER },
        new_chat_member: { status: 'member', user: BOT_USER },
      },
    } as unknown as Partial<Update>);
    expect(calls('leaveChat')).toHaveLength(1);
  });

  it('бота убрали из канала — права сброшены', async () => {
    await connectChannel();
    telegram();
    await h.feed(botMembership('left'));
    const [bc] = await h.db.select().from(botChannels).where(eq(botChannels.chatId, String(CHAT_ID)));
    expect(bc.status).toBe('left');
    expect(bc.canPost).toBe(false);
  });
});

/* ───────── заявки ───────── */

describe('заявки в канал', () => {
  it('участницу марафона бот впускает', async () => {
    await connectChannel();
    const made = await participant();
    await h.feed(joinRequest(Number(made.tgUserId), BOT_LINK));

    expect(calls('approveChatJoinRequest')[0]?.payload.user_id).toBe(Number(made.tgUserId));
    const [e] = await h.db.select().from(enrollments).where(eq(enrollments.id, made.enrollmentId));
    expect(e.channelJoinedAt).not.toBeNull();
  });

  it('чужой отказывает и объясняет почему', async () => {
    await connectChannel();
    await h.feed(joinRequest(91309999, BOT_LINK));

    expect(calls('declineChatJoinRequest')).toHaveLength(1);
    expect(calls('approveChatJoinRequest')).toHaveLength(0);
    const note = calls('sendMessage').find((c) => c.payload.chat_id === 91309999);
    expect(note?.payload.text).toMatch(/катышуучулары үчүн гана/);
  });

  it('исключённую из марафона не впускает', async () => {
    await connectChannel();
    const made = await participant({ status: 'left' });
    await h.feed(joinRequest(Number(made.tgUserId), BOT_LINK));
    expect(calls('declineChatJoinRequest')).toHaveLength(1);
  });

  it('заявки по другим ссылкам оставляет админам канала', async () => {
    await connectChannel();
    const made = await participant();
    await h.feed(joinRequest(Number(made.tgUserId), 'https://t.me/+AdminOwnLink1'));
    expect(calls('approveChatJoinRequest')).toHaveLength(0);
    expect(calls('declineChatJoinRequest')).toHaveLength(0);
  });
});

/* ───────── отчёты ───────── */

describe('отчёты в канале', () => {
  it('принятый кружок уходит в канал видео с подписью: тема, имя, город, день', async () => {
    await connectChannel();
    await submitZikr('vu_ch_1');

    const [e] = [await enrollmentOf(h.db)];
    const [row] = await h.db.select().from(reports).where(eq(reports.enrollmentId, e.id));
    expect(row.channelState).toBe('pending');

    h.reset();
    telegram();
    await h.channel.tick();

    expect(calls('getFile')[0].payload.file_id).toBe('file_vu_ch_1');
    const post = calls('sendVideo')[0];
    expect(post.payload.chat_id).toBe(String(CHAT_ID));
    const caption = String(post.payload.caption);
    expect(caption).toContain('Зикир');
    expect(caption).toContain('Айсулуу');
    expect(caption).toContain('Бишкек');
    // Марафон m5 начался 21 октября: 8 ноября — девятнадцатый день.
    expect(caption).toContain('19-күн');

    const [after] = await h.db.select().from(reports).where(eq(reports.id, row.id));
    expect(after.channelState).toBe('posted');
    expect(after.channelMessageId).toBe(501);

    // Второй проход ничего не повторяет.
    h.reset();
    telegram();
    await h.channel.tick();
    expect(calls('sendVideo')).toHaveLength(0);
  });

  it('без канала отчёт в очередь не встаёт', async () => {
    await submitZikr('vu_ch_2');
    const e = await enrollmentOf(h.db);
    const [row] = await h.db.select().from(reports).where(eq(reports.enrollmentId, e.id));
    expect(row.channelState).toBeNull();
  });

  it('кружок не скачался — уходит кружком, подпись ответом на него', async () => {
    await connectChannel();
    const made = await participant();
    await insertReport(h.db, { enrollmentId: made.enrollmentId, topicId: 't3', dayKey: '2026-11-08' });
    await h.db.update(reports).set({ channelState: 'pending' }).where(eq(reports.enrollmentId, made.enrollmentId));

    const original = h.channel.download;
    h.channel.download = async () => {
      throw new Error('file is too big');
    };
    try {
      telegram();
      await h.channel.tick();
    } finally {
      h.channel.download = original;
    }

    expect(calls('sendVideoNote')).toHaveLength(1);
    const caption = calls('sendMessage').find((c) => c.payload.chat_id === String(CHAT_ID));
    expect((caption?.payload.reply_parameters as { message_id: number }).message_id).toBe(601);
    const [row] = await h.db.select().from(reports).where(eq(reports.enrollmentId, made.enrollmentId));
    expect(row.channelState).toBe('posted');
  });

  it('бота лишили прав — отчёт ждёт, попытки не тратятся', async () => {
    await connectChannel();
    const made = await participant();
    await insertReport(h.db, { enrollmentId: made.enrollmentId, topicId: 't3', dayKey: '2026-11-08' });
    await h.db.update(reports).set({ channelState: 'pending' }).where(eq(reports.enrollmentId, made.enrollmentId));

    telegram((c) =>
      c.method === 'sendVideo'
        ? ({ ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat' } as never)
        : undefined,
    );
    await h.channel.tick();

    const [row] = await h.db.select().from(reports).where(eq(reports.enrollmentId, made.enrollmentId));
    expect(row.channelState).toBe('pending');
    expect(row.channelAttempts).toBe(0);
  });

  it('отчёт исключённой в канал не выкладывается', async () => {
    await connectChannel();
    const made = await participant({ status: 'left' });
    await insertReport(h.db, { enrollmentId: made.enrollmentId, topicId: 't3', dayKey: '2026-11-08' });
    await h.db.update(reports).set({ channelState: 'pending' }).where(eq(reports.enrollmentId, made.enrollmentId));

    telegram();
    await h.channel.tick();

    expect(calls('sendVideo')).toHaveLength(0);
    const [row] = await h.db.select().from(reports).where(eq(reports.enrollmentId, made.enrollmentId));
    expect(row.channelState).toBe('skipped');
  });
});

/* ───────── приглашения и исключённые ───────── */

describe('кнопка «вступить» и выход из канала', () => {
  it('после записи бот последним сообщением присылает кнопку в канал', async () => {
    await connectChannel();
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    telegram();
    await registerInBishkek(h, AT_0940);

    const last = calls('sendMessage').at(-1)!;
    expect(String(last.payload.text)).toMatch(/каналы бар/);
    const kb = last.payload.reply_markup as { inline_keyboard: { url?: string }[][] };
    expect(kb.inline_keyboard.flat()[0].url).toBe(BOT_LINK);
    expect((await enrollmentOf(h.db)).channelInvitedAt).not.toBeNull();
  });

  it('в «Өзүм жөнүндө» есть кнопка канала', async () => {
    await connectChannel();
    vi.useFakeTimers({ now: AT_0940, toFake: ['Date'] });
    await registerInBishkek(h, AT_0940);
    h.reset();

    await h.feed(textUpdate(await h.settings.t('btn_menu_about', 'kg'), AT_0940));
    const kb = calls('sendMessage').at(-1)!.payload.reply_markup as { inline_keyboard: { url?: string }[][] };
    expect(kb.inline_keyboard.flat().some((b) => b.url === BOT_LINK)).toBe(true);
  });

  it('записавшаяся до подключения канала получает кнопку один раз', async () => {
    const made = await participant();
    // Записалась давно: свежих воркер не трогает, им кнопка приходит в приветствии.
    await h.db
      .update(enrollments)
      .set({ createdAt: new Date(Date.now() - 3600_000) })
      .where(eq(enrollments.id, made.enrollmentId));
    await connectChannel();

    telegram();
    await h.channel.tick();
    const invite = calls('sendMessage').find((c) => c.payload.chat_id === made.chatId);
    const kb = invite?.payload.reply_markup as { inline_keyboard: { url?: string }[][] };
    expect(kb.inline_keyboard.flat()[0].url).toBe(BOT_LINK);

    h.reset();
    telegram();
    await h.channel.tick();
    expect(calls('sendMessage').filter((c) => c.payload.chat_id === made.chatId)).toHaveLength(0);
  });

  it('исключённую из марафона бот убирает из канала', async () => {
    await connectChannel();
    const made = await participant({ status: 'left' });
    await h.db.update(enrollments).set({ channelJoinedAt: new Date() }).where(eq(enrollments.id, made.enrollmentId));

    telegram();
    await h.channel.tick();

    const kick = calls('unbanChatMember')[0];
    expect(kick.payload.chat_id).toBe(String(CHAT_ID));
    expect(kick.payload.user_id).toBe(Number(made.tgUserId));
    // Без only_if_banned разбан выводит из канала, а вход по кнопке остаётся.
    expect(kick.payload.only_if_banned).toBeUndefined();
    const [e] = await h.db.select().from(enrollments).where(eq(enrollments.id, made.enrollmentId));
    expect(e.channelJoinedAt).toBeNull();
  });
});

/* ───────── проверка перед запуском ───────── */

describe('запуск без канала', () => {
  const base: MarathonInput = {
    status: 'draft',
    startDate: '2026-12-01',
    endDate: '2026-12-30',
    namaz: ['t2'],
    topics: [],
  };
  const ctx = { today: '2026-11-14', untranslatedTextKeys: [] };
  const ready = { link: true, connected: true, ready: true, isPrivate: true, protectedContent: true, canRestrict: true };
  const codes = (m: MarathonInput) => validateMarathon(m, ctx).map((i) => `${i.level}:${i.code}`);

  it('нет ссылки, нет бота, нет прав — запуск заблокирован', () => {
    expect(codes({ ...base, channel: { ...ready, link: false, connected: false, ready: false } })).toContain('error:channel_link_missing');
    expect(codes({ ...base, channel: { ...ready, connected: false, ready: false } })).toContain('error:channel_not_connected');
    expect(codes({ ...base, channel: { ...ready, ready: false } })).toContain('error:channel_rights');
  });

  it('готовый канал не мешает; публичный и без запрета копирования — только предупреждения', () => {
    expect(codes({ ...base, channel: ready })).toEqual([]);
    const soft = validateMarathon({ ...base, channel: { ...ready, isPrivate: false, protectedContent: false } }, ctx);
    expect(soft.every((i) => i.level === 'warn')).toBe(true);
    expect(soft.map((i) => i.code)).toEqual(['channel_public', 'channel_copying']);
  });

  it('завершённому марафону канал уже не нужен', () => {
    expect(codes({ ...base, status: 'finished', channel: { ...ready, link: false, connected: false, ready: false } })).toEqual([]);
  });
});
