/**
 * Канал отчётов марафона на стороне панели: проверка ссылки до отправки и
 * ссылка «добавить бота в канал» с заранее отмеченными правами.
 *
 * Разбор ссылки повторяет бэкенд (`domain/channel.ts`): панель подсказывает
 * сразу, а сервер всё равно проверит.
 */

const USERNAME = /^[a-z][a-z0-9_]{3,31}$/i;
const INVITE_HASH = /^[A-Za-z0-9_-]{10,64}$/;

/** `https://t.me/+HASH` или `https://t.me/имя`; не ссылка на канал — null. */
export function normalizeChannelLink(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith('@')) {
    const u = raw.slice(1);
    return USERNAME.test(u) ? `https://t.me/${u.toLowerCase()}` : null;
  }

  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.+?)\/?$/i.exec(raw);
  if (!m) return null;
  const path = m[1].split('?')[0];

  if (path.startsWith('+')) return INVITE_HASH.test(path.slice(1)) ? `https://t.me/${path}` : null;
  if (path.toLowerCase().startsWith('joinchat/')) {
    const hash = path.slice('joinchat/'.length);
    return INVITE_HASH.test(hash) ? `https://t.me/+${hash}` : null;
  }
  if (path.includes('/')) return null;
  return USERNAME.test(path) && !/bot$/i.test(path) ? `https://t.me/${path.toLowerCase()}` : null;
}

/** Текст ошибки под полем ссылки; пустая строка — всё в порядке. */
export function channelLinkError(input: string): string {
  if (!input.trim()) return 'Вставьте ссылку на канал отчётов';
  if (/t\.me\/[a-z0-9_]+bot\/?$/i.test(input.trim())) return 'Это ссылка на бота. Нужна ссылка на ваш канал';
  return normalizeChannelLink(input) ? '' : 'Это не ссылка на канал. Нужна вида https://t.me/+AbCd… или https://t.me/имя_канала';
}

/**
 * Ссылка «добавить бота в канал админом». Telegram откроет выбор канала, а
 * права — публиковать, приглашать, удалять участниц — уже будут отмечены.
 */
export function addBotToChannelUrl(botUsername: string): string {
  return `https://t.me/${botUsername}?startchannel&admin=post_messages+invite_users+restrict_members`;
}
