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
