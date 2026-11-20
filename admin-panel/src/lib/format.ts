const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «2026-11-18» → «18 ноя». Год показывается, только если он не 2026. */
export function dateRu(iso: string | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return Number(d) + ' ' + MONTHS[Number(m) - 1] + (y !== '2026' ? ' ' + y : '');
}

/** Русское склонение по числу: plural(2, 'балл', 'балла', 'баллов'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function uid(): string {
  return 'x' + Math.random().toString(36).slice(2, 7);
}

/** Кыргызские и русские буквы в латиницу — для кода марафона. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ң: 'n', ө: 'o', ү: 'u',
};

/**
 * Код марафона из названия: он попадает в deep link `t.me/bot?start=<код>`,
 * поэтому только строчная латиница, цифры и подчёркивание.
 */
export function slugify(name: string): string {
  const latin = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  const slug = latin.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return slug || 'm' + Date.now().toString(36).slice(-5);
}
