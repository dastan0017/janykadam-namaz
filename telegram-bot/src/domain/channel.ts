/**
 * Канал отчётов марафона: разбор ссылки, которую вставил админ, и права бота.
 *
 * Бот не может сам создать канал и не может сам добавить туда людей — это
 * ограничение Telegram. Поэтому канал создаёт админ, вставляет ссылку в панель
 * и добавляет бота админом. Бот узнаёт «свой» канал, сравнивая эту ссылку с
 * основной ссылкой-приглашением канала или с его публичным именем.
 */

export type ChannelLink =
  | { kind: 'username'; username: string }
  | { kind: 'invite'; hash: string };

/** Имя пользователя Telegram: 5–32 символа, латиница, цифры и подчёркивание. */
const USERNAME = /^[a-z][a-z0-9_]{3,31}$/i;
/** Хэш приглашения: base64url без паддинга. */
const INVITE_HASH = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * Разбирает ссылку на канал. Понимает:
 * `https://t.me/+HASH`, `t.me/joinchat/HASH`, `https://t.me/name`, `@name`,
 * а также `telegram.me` вместо `t.me`. Всё прочее — `null`.
 */
export function parseChannelLink(input: string): ChannelLink | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith('@')) {
    const username = raw.slice(1);
    return USERNAME.test(username) ? { kind: 'username', username: username.toLowerCase() } : null;
  }

  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.+?)\/?$/i.exec(raw);
  if (!m) return null;
  const path = m[1].split('?')[0];

  if (path.startsWith('+')) {
    const hash = path.slice(1);
    return INVITE_HASH.test(hash) ? { kind: 'invite', hash } : null;
  }
  if (path.toLowerCase().startsWith('joinchat/')) {
    const hash = path.slice('joinchat/'.length);
    return INVITE_HASH.test(hash) ? { kind: 'invite', hash } : null;
  }
  // Ссылка на бота или на отдельный пост — не ссылка на канал.
  if (path.includes('/')) return null;
  return USERNAME.test(path) && !/bot$/i.test(path) ? { kind: 'username', username: path.toLowerCase() } : null;
}

/** Единый вид ссылки для хранения: `https://t.me/+HASH` или `https://t.me/name`. */
export function normalizeChannelLink(link: ChannelLink): string {
  return link.kind === 'invite' ? `https://t.me/+${link.hash}` : `https://t.me/${link.username}`;
}

/** Совпадает ли ссылка из панели с каналом, где бот стал админом. */
export function linkMatchesChat(
  link: ChannelLink | null,
  chat: { username?: string | null; inviteLink?: string | null },
): boolean {
  if (!link) return false;
  if (link.kind === 'username') return !!chat.username && chat.username.toLowerCase() === link.username;
  if (!chat.inviteLink) return false;
  const primary = parseChannelLink(chat.inviteLink);
  return primary?.kind === 'invite' && primary.hash === link.hash;
}

/** Права бота в канале — то, что панель показывает галочками. */
export interface BotRights {
  admin: boolean;
  post: boolean;
  invite: boolean;
  restrict: boolean;
}

/** Без этих прав канал не работает: бот не опубликует отчёт и не впустит участницу. */
export function rightsReady(r: BotRights): boolean {
  return r.admin && r.post && r.invite;
}

/** Права из ChatMember бота. Создатель канала может всё. */
export function rightsOf(member: {
  status: string;
  can_post_messages?: boolean;
  can_invite_users?: boolean;
  can_restrict_members?: boolean;
}): BotRights {
  if (member.status === 'creator') return { admin: true, post: true, invite: true, restrict: true };
  if (member.status !== 'administrator') return { admin: false, post: false, invite: false, restrict: false };
  return {
    admin: true,
    post: !!member.can_post_messages,
    invite: !!member.can_invite_users,
    restrict: !!member.can_restrict_members,
  };
}

/**
 * Права, которые панель заранее отмечает в Telegram по ссылке «добавить бота».
 * Удалять участниц нужно, чтобы бот убирал из канала исключённых из марафона.
 */
export const BOT_ADMIN_RIGHTS = ['post_messages', 'invite_users', 'restrict_members'] as const;

/** Подпись под видеоотчётом: Telegram режет подписи длиннее 1024 символов. */
export const CAPTION_LIMIT = 1024;
