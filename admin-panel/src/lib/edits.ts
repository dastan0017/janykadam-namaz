import type { AppState, EditKind, Snapshot } from '../types';

/**
 * Несохранённые правки формы.
 *
 * Поля формы меняют состояние панели сразу — иначе не работало бы превью, —
 * но на бэкенд не уходят, пока не нажмут «Сохранить». Чтобы знать, что
 * менялось, в начале правки снимается снимок значений: по нему считается тело
 * запроса и по нему же работает «Отменить».
 *
 * Снимок плоский: поле → значение. Варианты ответа лежат в снимке вопроса
 * ключами `o:<id>:kg` — они правятся в той же форме и сохраняются вместе с ним.
 */

export const MARATHON_KEYS = [
  'name', 'start', 'end', 'lang', 'regOpen', 'pointsDefault', 'streakBonus', 'streakEvery',
  'latePasses', 'excused', 'pauseAllowed', 'remindMorning', 'remindEvening', 'skipSubmitted',
  'rulesKg', 'rulesRu',
] as const;

/** `active` правится переключателем в шапке и сохраняется сразу — его здесь нет. */
export const TOPIC_KEYS = ['emoji', 'nameKg', 'nameRu', 'start', 'end', 'points', 'freq', 'mandatory', 'remind'] as const;

/** Тип ответа переписывает варианты на бэкенде, поэтому сохраняется сразу. */
export const QUESTION_KEYS = ['textKg', 'textRu', 'required'] as const;

export const BOT_KEYS = ['desc', 'shortDesc', 'commands', 'quietFrom', 'quietTo', 'capPerDay'] as const;

export const TEXT_KEYS = ['ru', 'kg'] as const;

export const optionKey = (id: string, field: 'kg' | 'ru' | 'pts') => `o:${id}:${field}`;

function pick(obj: object, keys: readonly string[]): Snapshot {
  const src = obj as Record<string, unknown>;
  const out: Snapshot = {};
  for (const k of keys) out[k] = src[k] as Snapshot[string];
  return out;
}

/** Текущие значения формы. `null` — того, что правили, уже нет в состоянии. */
export function snapshot(s: AppState, kind: EditKind, id: string): Snapshot | null {
  if (kind === 'bot') return pick(s.bot, BOT_KEYS);

  if (kind === 'marathon') {
    const m = s.marathons.find((x) => x.id === id);
    return m ? pick(m, MARATHON_KEYS) : null;
  }

  if (kind === 'text') {
    const t = s.texts.find((x) => x.key === id);
    return t ? pick(t, TEXT_KEYS) : null;
  }

  const topics = (s.mid ? s.data[s.mid]?.topics : undefined) ?? [];

  if (kind === 'topic') {
    const t = topics.find((x) => x.id === id);
    return t ? pick(t, TOPIC_KEYS) : null;
  }

  const q = topics.flatMap((t) => t.questions).find((x) => x.id === id);
  if (!q) return null;
  const snap = pick(q, QUESTION_KEYS);
  for (const o of q.options) {
    snap[optionKey(o.id, 'kg')] = o.kg;
    snap[optionKey(o.id, 'ru')] = o.ru;
    snap[optionKey(o.id, 'pts')] = o.pts;
  }
  return snap;
}

/**
 * Что изменилось с начала правки. Ключей, которых нет в одном из снимков,
 * здесь нет: вариант ответа могли добавить или удалить — это отдельное
 * действие, оно уже сохранено.
 */
export function changedKeys(base: Snapshot, now: Snapshot): string[] {
  return Object.keys(base).filter((k) => k in now && now[k] !== base[k]);
}

/** Есть ли несохранённые правки — по ним показывается полоса сохранения. */
export function isDirty(s: AppState): boolean {
  const e = s.edit;
  if (!e) return false;
  const now = snapshot(s, e.kind, e.id);
  return !!now && changedKeys(e.base, now).length > 0;
}
