import { InlineKeyboard, Keyboard } from 'grammy';
import { cbData, packId } from './callback-data';
import type { Lang } from '../domain/text';

/**
 * Клавиатуры. Все надписи приходят из bot_texts, поэтому строители принимают
 * уже готовые строки — сервис текстов подставляет их заранее.
 *
 * Идентификаторы в кнопках пакуются (см. callback-data.ts): UUID не влезает в
 * отведённые Telegram 64 байта.
 */

/** `.row()` после последней кнопки оставляет пустой ряд — убираем. */
function trim(kb: InlineKeyboard): InlineKeyboard {
  while (kb.inline_keyboard.length > 0 && kb.inline_keyboard.at(-1)!.length === 0) {
    kb.inline_keyboard.pop();
  }
  return kb;
}

/** Главная клавиатура: четыре кнопки, больше ничего. */
export function mainKeyboard(labels: string[]): Keyboard {
  const kb = new Keyboard();
  labels.forEach((label, i) => {
    kb.text(label);
    // Две кнопки в ряд читаются на телефоне лучше, чем четыре.
    if (i % 2 === 1) kb.row();
  });
  return kb.resized().persistent();
}

export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Кыргызча', 'lang:kg').text('Русский', 'lang:ru');
}

export interface PresetButton {
  id: string;
  label: string;
}

/**
 * Выбор места: геолокация, города-пресеты по три в ряд, поиск.
 * Кнопка геолокации не работает в Telegram Desktop, поэтому поиск обязан быть хорошим.
 */
export function locationKeyboard(sendLocationLabel: string, presets: PresetButton[], otherCityLabel: string): Keyboard {
  const kb = new Keyboard().requestLocation(sendLocationLabel).row();

  presets.forEach((p, i) => {
    kb.text(p.label);
    if (i % 3 === 2) kb.row();
  });
  if (presets.length % 3 !== 0) kb.row();

  return kb.text(otherCityLabel).resized().oneTime();
}

export function searchResultsKeyboard(
  hits: { id: string; label: string }[],
  notFoundLabel: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const h of hits) kb.text(h.label, cbData('geo', packId(h.id))).row();
  return kb.text(notFoundLabel, 'geo:none');
}

export function changeLocationKeyboard(label: string): InlineKeyboard {
  return new InlineKeyboard().text(label, 'zona:change');
}

/** Выбор темы для отчёта. Не больше восьми кнопок на странице. */
export function topicPickerKeyboard(
  draftId: string,
  items: { topicId: string; label: string; late: boolean }[],
  page: number,
  moreLabel: string,
  pageSize = 8,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const start = page * pageSize;
  const slice = items.slice(start, start + pageSize);
  const draft = packId(draftId);

  for (const it of slice) {
    kb.text(it.label, cbData('rp', draft, packId(it.topicId))).row();
  }

  if (items.length > start + pageSize) kb.text(moreLabel, cbData('rpp', draft, String(page + 1)));
  return trim(kb);
}

export function confirmKeyboard(yes: string, no: string, prefix: string): InlineKeyboard {
  return new InlineKeyboard().text(yes, `${prefix}:yes`).text(no, `${prefix}:no`);
}

export function autoAssignedKeyboard(draftId: string, changeLabel: string): InlineKeyboard {
  return new InlineKeyboard().text(changeLabel, cbData('rpc', packId(draftId)));
}

/** Варианты ответа на вопрос. */
export function optionsKeyboard(
  draftId: string,
  questionId: string,
  options: { id: string; label: string; checked?: boolean }[],
  extra: { multi?: boolean; doneLabel?: string; skipLabel?: string } = {},
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const draft = packId(draftId);

  for (const o of options) {
    const label = extra.multi ? `${o.checked ? '✓ ' : ''}${o.label}` : o.label;
    kb.text(label, cbData('ans', draft, packId(o.id))).row();
  }
  if (extra.multi && extra.doneLabel) kb.text(extra.doneLabel, cbData('ansdone', draft)).row();
  if (extra.skipLabel) kb.text(extra.skipLabel, cbData('ansskip', draft));
  void questionId;
  return trim(kb);
}

export function marathonSwitchKeyboard(items: { enrollmentId: string; label: string }[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const it of items) kb.text(it.label, cbData('mar', packId(it.enrollmentId))).row();
  return trim(kb);
}

export function pauseLengthKeyboard(d3: string, week: string, untilCancel: string): InlineKeyboard {
  return new InlineKeyboard().text(d3, 'pause:3').row().text(week, 'pause:7').row().text(untilCancel, 'pause:0');
}

export function resumeKeyboard(label: string): InlineKeyboard {
  return new InlineKeyboard().text(label, 'pause:resume');
}

export function notifyNextKeyboard(label: string): InlineKeyboard {
  return new InlineKeyboard().text(label, 'next:yes');
}

/** Кнопка «Сдать для «марафон»» в напоминаниях, когда марафонов несколько. */
export function submitForKeyboard(enrollmentId: string, label: string): InlineKeyboard {
  return new InlineKeyboard().text(label, cbData('sub', packId(enrollmentId)));
}

export function langOf(lang: string): Lang {
  return lang === 'ru' ? 'ru' : 'kg';
}
