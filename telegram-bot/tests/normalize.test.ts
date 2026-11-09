import { describe, expect, it } from 'vitest';
import { buildSearchText, normalizeForSearch } from '../src/domain/normalize';

describe('нормализация поиска', () => {
  it('кириллица и латиница сходятся в одну форму', () => {
    expect(normalizeForSearch('Талас')).toBe('talas');
    expect(normalizeForSearch('талас')).toBe('talas');
    expect(normalizeForSearch('Talas')).toBe('talas');
    expect(normalizeForSearch('TALAS')).toBe('talas');
  });

  it('опечатка «Бишкэк» совпадает с «Бишкек»', () => {
    expect(normalizeForSearch('Бишкэк')).toBe(normalizeForSearch('Бишкек'));
    expect(normalizeForSearch('Бишкек')).toBe('bishkek');
  });

  it('ё приводится к е', () => {
    expect(normalizeForSearch('Орёл')).toBe(normalizeForSearch('Орел'));
  });

  it('кыргызские буквы ң, ө, ү складываются в н, о, у', () => {
    expect(normalizeForSearch('Ңң')).toBe('nn');
    expect(normalizeForSearch('Өө')).toBe('oo');
    expect(normalizeForSearch('Үү')).toBe('uu');
    // Жалал-Абад в кыргызском написании
    expect(normalizeForSearch('Жалал-Абад')).toBe('zhalal abad');
  });

  it('Ош', () => {
    expect(normalizeForSearch('Ош')).toBe('osh');
    expect(normalizeForSearch('Osh')).toBe('osh');
  });

  it('диакритика снимается', () => {
    expect(normalizeForSearch('Zürich')).toBe('zurich');
    expect(normalizeForSearch('İstanbul')).toBe(normalizeForSearch('Istanbul'));
  });

  it('пунктуация и лишние пробелы убираются', () => {
    expect(normalizeForSearch('  Нью-Йорк  ')).toBe('nyu iork');
    expect(normalizeForSearch("Ala-Too'")).toBe('ala too');
  });

  it('пустая строка остаётся пустой', () => {
    expect(normalizeForSearch('')).toBe('');
    expect(normalizeForSearch('---')).toBe('');
  });
});

describe('текст для индекса', () => {
  it('собирает имя, ascii-имя и альтернативные названия без дублей', () => {
    const text = buildSearchText({
      name: 'Talas',
      asciiname: 'Talas',
      alternatenames: 'Талас,Talas,Таласъ',
    });
    expect(text).toContain('talas');
    // «Talas» встречается трижды, в индексе должен остаться один раз
    expect(text.split(' ').filter((w) => w === 'talas')).toHaveLength(1);
  });

  it('кириллическое альтернативное имя делает город находимым по-русски', () => {
    const moscow = buildSearchText({
      name: 'Moscow',
      asciiname: 'Moscow',
      alternatenames: 'Москва,Moskva,Moskau',
    });
    expect(moscow).toContain(normalizeForSearch('Москва'));
    expect(moscow).toContain('moscow');
  });
});
