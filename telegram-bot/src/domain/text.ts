/**
 * Подстановка плейсхолдеров и нарезка длинных сообщений.
 *
 * Отправляем простым текстом, без parse_mode: тогда не возникает ошибок
 * экранирования, а имена участниц и названия тем могут содержать что угодно.
 */

export type Lang = 'kg' | 'ru';

export interface TextRow {
  key: string;
  ru: string;
  kg: string;
}

/** Предел одного сообщения в Telegram. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Подставляет значения вместо `{ключ}`. Неизвестные плейсхолдеры остаются как
 * есть — это заметно при вычитке и не ломает отправку.
 */
export function render(template: string, values: Record<string, string | number | undefined> = {}): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const v = values[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** Текст по ключу на нужном языке. Пустой кыргызский откатывается к русскому. */
export function pick(row: TextRow | undefined, lang: Lang): string {
  if (!row) return '';
  if (lang === 'kg') return row.kg.trim() ? row.kg : row.ru;
  return row.ru.trim() ? row.ru : row.kg;
}

/**
 * Режет текст на части не длиннее лимита, по абзацам.
 * Клавиатуру вызывающий код вешает на последнюю часть.
 */
export function splitMessage(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      parts.push(current);
      current = '';
    }
  };

  for (const paragraph of text.split('\n\n')) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    flush();

    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }

    // Абзац сам длиннее лимита — режем по строкам, затем жёстко.
    let rest = paragraph;
    while (rest.length > limit) {
      const cut = rest.lastIndexOf('\n', limit);
      const at = cut > limit * 0.5 ? cut : limit;
      parts.push(rest.slice(0, at));
      rest = rest.slice(at).replace(/^\n/, '');
    }
    current = rest;
  }

  flush();
  return parts;
}

/** Перечисление тем через запятую: «🌅 Багымдат (до 07:44), 📿 Зикир (до 23:00)». */
export function joinTopics(items: { emoji: string; name: string; until?: string }[], untilWord = 'до'): string {
  return items.map((i) => (i.until ? `${i.emoji} ${i.name} (${untilWord} ${i.until})` : `${i.emoji} ${i.name}`)).join(', ');
}
