/**
 * Данные кнопок.
 *
 * Telegram даёт на `callback_data` 64 байта и отказывает всему сообщению
 * целиком, если хоть одна кнопка длиннее: `400 BUTTON_DATA_INVALID`. Идентифи-
 * каторы в базе — UUID по 36 символов, поэтому пара «черновик + тема» занимает
 * `rp:` + 36 + `:` + 36 = 76 байт и в предел не влезает. Намазы с их короткими
 * `t1`…`t11` влезали, а первая же своя тема марафона ломала выбор темы.
 *
 * Поэтому UUID едут в кнопке упакованными: те же 16 байт в base64url — 22
 * символа вместо 36. Остальные идентификаторы короткие и едут как есть.
 */

/** Предел Telegram на callback_data, в байтах. */
export const CALLBACK_DATA_LIMIT = 64;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PACKED_RE = /^[A-Za-z0-9_-]{22}$/;

/** UUID → 22 символа base64url. Прочие идентификаторы возвращает как есть. */
export function packId(id: string): string {
  if (!UUID_RE.test(id)) return id;
  return Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
}

/**
 * Обратное преобразование. Распаковывает только то, что действительно было
 * упаковано: если обратная упаковка не сошлась, значение отдаётся нетронутым,
 * и короткий идентификатор темы не может случайно превратиться в UUID.
 */
export function unpackId(value: string): string {
  if (!PACKED_RE.test(value)) return value;

  const buf = Buffer.from(value, 'base64url');
  if (buf.length !== 16) return value;

  const h = buf.toString('hex');
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return packId(uuid) === value ? uuid : value;
}

/**
 * Собирает callback_data и сразу проверяет предел. Лучше громкая ошибка здесь,
 * чем отказ Telegram, из-за которого участница не получает вообще ничего.
 */
export function cbData(...parts: string[]): string {
  const data = parts.join(':');
  const size = Buffer.byteLength(data, 'utf8');
  if (size > CALLBACK_DATA_LIMIT) {
    throw new Error(`callback_data ${size} байт при пределе ${CALLBACK_DATA_LIMIT}: ${data}`);
  }
  return data;
}
