import { Injectable, Logger } from '@nestjs/common';
import {
  classifyTmePage, normalizeChannelLink, parseChannelLink, type LinkKind,
} from '../domain/channel';

/** Итог проверки ссылки — панель показывает его под полем как есть. */
export interface LinkCheck {
  /** Ссылка в едином виде; null — это вообще не ссылка t.me. */
  link: string | null;
  kind: LinkKind | 'invalid';
  /** Можно ли сохранять: канал или «не удалось проверить». */
  ok: boolean;
  title?: string;
  extra?: string;
  message: string;
}

const CACHE_MS = 60_000;

/**
 * Проверяет, что ссылка ведёт в канал, а не в группу. Без этого админ легко
 * создаёт группу вместо канала: ссылки у них выглядят одинаково, а бот в
 * группе не работает — и кнопка «добавить бота» её даже не показывает.
 */
@Injectable()
export class ChannelLinkService {
  private readonly log = new Logger(ChannelLinkService.name);
  private readonly cache = new Map<string, { at: number; result: LinkCheck }>();

  /** Страница предпросмотра t.me. Подменяется в тестах. */
  fetchPage = async (url: string): Promise<string> => {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; JanykadamBot/1.0)', 'accept-language': 'en' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };

  async check(input: string): Promise<LinkCheck> {
    const parsed = parseChannelLink(input);
    if (!parsed) {
      return {
        link: null,
        kind: 'invalid',
        ok: false,
        message: /t\.me\/[a-z0-9_]+bot\/?$/i.test(input.trim())
          ? 'Это ссылка на бота. Нужна ссылка на ваш канал'
          : 'Это не ссылка на канал. Нужна вида https://t.me/+AbCd… или https://t.me/имя_канала',
      };
    }

    const link = normalizeChannelLink(parsed);
    const hit = this.cache.get(link);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

    let result: LinkCheck;
    try {
      const page = classifyTmePage(await this.fetchPage(link));
      result = { link, ...page, ok: page.kind === 'channel' || page.kind === 'unknown', message: messageFor(page.kind, page.title) };
    } catch (err) {
      // t.me не ответил — не мешаем: бота добавят в канал, и это проверится ещё раз.
      this.log.warn(`Проверка ссылки ${link}: ${err instanceof Error ? err.message : String(err)}`);
      result = { link, kind: 'unknown', ok: true, message: messageFor('unknown') };
    }

    this.cache.set(link, { at: Date.now(), result });
    return result;
  }
}

function messageFor(kind: LinkKind, title?: string): string {
  switch (kind) {
    case 'channel':
      return `Канал «${title ?? ''}»`;
    case 'group':
      return `«${title ?? 'Это'}» — группа, а не канал. Бот работает только с каналом: создайте в Telegram «Новый канал» и вставьте его ссылку`;
    case 'missing':
      return 'Ссылка не открывается: канал удалён или ссылку отозвали. Скопируйте ссылку канала заново';
    case 'other':
      return `«${title ?? ''}» — не канал. Нужна ссылка на канал`;
    default:
      return 'Не удалось проверить ссылку — проверим, когда бот попадёт в канал';
  }
}
