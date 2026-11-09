import { describe, expect, it } from 'vitest';
import { BOT_TEXTS } from '../src/db/seed-texts';
import { pick, render, splitMessage, TELEGRAM_TEXT_LIMIT } from '../src/domain/text';

describe('подстановка плейсхолдеров', () => {
  it('подставляет значения', () => {
    expect(render('Привет, {имя}!', { имя: 'Айжан' })).toBe('Привет, Айжан!');
  });

  it('неизвестные плейсхолдеры остаются нетронутыми', () => {
    expect(render('{тема}: +{баллы}', { тема: 'Зикир' })).toBe('Зикир: +{баллы}');
  });

  it('числа приводятся к строке', () => {
    expect(render('+{баллы}', { баллы: 5 })).toBe('+5');
  });

  it('повторяющийся плейсхолдер заменяется везде', () => {
    expect(render('{a} и ещё {a}', { a: 'x' })).toBe('x и ещё x');
  });
});

describe('выбор языка', () => {
  const row = { key: 'k', ru: 'по-русски', kg: 'кыргызча' };

  it('берёт нужный язык', () => {
    expect(pick(row, 'kg')).toBe('кыргызча');
    expect(pick(row, 'ru')).toBe('по-русски');
  });

  it('пустой кыргызский откатывается к русскому', () => {
    expect(pick({ key: 'k', ru: 'только русский', kg: '' }, 'kg')).toBe('только русский');
    expect(pick({ key: 'k', ru: 'только русский', kg: '   ' }, 'kg')).toBe('только русский');
  });

  it('weekly_summary из сида проверяет этот откат', () => {
    const row = BOT_TEXTS.find((t) => t.key === 'weekly_summary')!;
    expect(row.kg).toBe('');
    expect(pick(row, 'kg')).toBe(row.ru);
  });
});

describe('нарезка длинных сообщений', () => {
  it('короткое не трогает', () => {
    expect(splitMessage('коротко')).toEqual(['коротко']);
  });

  it('режет по абзацам и укладывается в лимит', () => {
    const paragraph = 'а'.repeat(1000);
    const text = Array.from({ length: 8 }, () => paragraph).join('\n\n');
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    // Ни один абзац не потерян.
    expect(parts.join('\n\n').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
  });

  it('абзац длиннее лимита тоже режется', () => {
    const parts = splitMessage('б'.repeat(10_000));
    expect(parts.length).toBe(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(parts.join('')).toHaveLength(10_000);
  });
});

describe('сид текстов', () => {
  it('ключи уникальны', () => {
    const keys = BOT_TEXTS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('русский текст есть у каждого ключа', () => {
    const empty = BOT_TEXTS.filter((t) => !t.ru.trim()).map((t) => t.key);
    expect(empty).toEqual([]);
  });

  it('все объявленные плейсхолдеры действительно встречаются в тексте', () => {
    for (const t of BOT_TEXTS) {
      for (const ph of t.placeholders) {
        expect(`${t.ru} ${t.kg}`, `${t.key} → ${ph}`).toContain(ph);
      }
    }
  });

  it('в текстах нет удалённых понятий: команда, капитан, кадам, модерация', () => {
    const forbidden = /команд[аыуе]|капитан|кадамдар|кадам\b|модерац/i;
    const hits = BOT_TEXTS.filter((t) => forbidden.test(`${t.ru} ${t.kg}`)).map((t) => t.key);
    expect(hits).toEqual([]);
  });

  it('есть атрибуция GeoNames', () => {
    const credit = BOT_TEXTS.find((t) => t.key === 'geonames_credit')!;
    expect(credit.ru).toContain('GeoNames');
    expect(credit.ru).toContain('CC BY 4.0');
  });
});
