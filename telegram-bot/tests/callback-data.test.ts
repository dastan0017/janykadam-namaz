import type { InlineKeyboard } from 'grammy';
import { describe, expect, it } from 'vitest';
import { CALLBACK_DATA_LIMIT, cbData, packId, unpackId } from '../src/bot/callback-data';
import { optionsKeyboard, topicPickerKeyboard } from '../src/bot/keyboards';

const uuid = (n: number) => `6571d337-be13-4312-b9c7-4bcdc847b0${String(n).padStart(2, '0')}`;

/** Все кнопки клавиатуры: Telegram отказывает всему сообщению из-за одной. */
function datas(kb: InlineKeyboard): string[] {
  return kb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : ''));
}

describe('упаковка идентификаторов', () => {
  it('UUID ужимается до 22 символов и разворачивается обратно', () => {
    const id = uuid(1);
    const packed = packId(id);
    expect(packed).toHaveLength(22);
    expect(packed).not.toContain(':');
    expect(unpackId(packed)).toBe(id);
  });

  it('короткие идентификаторы тем не трогает', () => {
    for (const id of ['t1', 't11', 'geo:none']) {
      expect(packId(id)).toBe(id);
      expect(unpackId(id)).toBe(id);
    }
  });

  it('не принимает за UUID то, что им не было', () => {
    // Ровно 22 допустимых символа, но последний несёт биты, которых упаковка
    // UUID никогда не даёт, — значит, это не упакованный UUID.
    const looksPacked = `${'A'.repeat(21)}B`;
    expect(unpackId(looksPacked)).toBe(looksPacked);
  });

  it('ругается, когда данные кнопки не влезают', () => {
    expect(() => cbData('rp', uuid(1), uuid(2))).toThrow(/64/);
  });
});

describe('клавиатуры не превышают предел Telegram', () => {
  // Из-за этого выбор темы не доходил до участницы: своя тема марафона — UUID,
  // и пара «черновик + тема» занимала 76 байт при пределе 64.
  it('выбор темы со своими темами марафона', () => {
    const kb = topicPickerKeyboard(
      uuid(0),
      [
        { topicId: 't1', label: '🌅 Багымдат', late: false },
        { topicId: uuid(7), label: '🕊 Зикир', late: false },
        { topicId: uuid(8), label: '⏰ 📿 Каза намаз', late: true },
      ],
      0,
      'Дагы',
    );

    const all = datas(kb);
    expect(all).toHaveLength(3);
    for (const d of all) expect(Buffer.byteLength(d)).toBeLessThanOrEqual(CALLBACK_DATA_LIMIT);

    // И обратный разбор возвращает настоящие идентификаторы.
    const [, draft, topic] = all[1].split(':');
    expect(unpackId(draft)).toBe(uuid(0));
    expect(unpackId(topic)).toBe(uuid(7));
  });

  it('страница «ещё» помещается', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ topicId: uuid(i + 20), label: `Тема ${i}`, late: false }));
    const kb = topicPickerKeyboard(uuid(0), items, 0, 'Дагы');
    const all = datas(kb);

    expect(all).toHaveLength(9); // восемь тем и «ещё»
    for (const d of all) expect(Buffer.byteLength(d)).toBeLessThanOrEqual(CALLBACK_DATA_LIMIT);
    expect(all.at(-1)).toBe(`rpp:${packId(uuid(0))}:1`);
  });

  it('варианты ответа на вопрос', () => {
    const kb = optionsKeyboard(
      uuid(0),
      uuid(1),
      [
        { id: uuid(2), label: 'Ооба' },
        { id: uuid(3), label: 'Жок' },
      ],
      { multi: true, doneLabel: 'Даяр', skipLabel: 'Өткөрүп жиберүү' },
    );

    const all = datas(kb);
    expect(all).toHaveLength(4);
    for (const d of all) expect(Buffer.byteLength(d)).toBeLessThanOrEqual(CALLBACK_DATA_LIMIT);
    expect(unpackId(all[0].split(':')[2])).toBe(uuid(2));
  });

  it('пустых рядов в клавиатуре не остаётся', () => {
    // Пустой ряд Telegram не обязан принимать, а `.row()` его оставлял.
    const kb = topicPickerKeyboard(uuid(0), [{ topicId: 't1', label: 'Багымдат', late: false }], 0, 'Дагы');
    expect(kb.inline_keyboard.every((row) => row.length > 0)).toBe(true);

    const opts = optionsKeyboard(uuid(0), uuid(1), [{ id: uuid(2), label: 'Ооба' }]);
    expect(opts.inline_keyboard.every((row) => row.length > 0)).toBe(true);
  });
});
