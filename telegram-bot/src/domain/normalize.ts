/**
 * Нормализация для поиска городов.
 *
 * И запрос, и индексируемый текст сводятся к одной латинской форме. Тогда
 * «Талас», «талас» и «Talas» дают одну строку, а опечатка в кириллице
 * («Бишкэк» → bishkek) исчезает сама. Остаточные опечатки добирает pg_trgm.
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // кыргызские буквы складываются в ближайшие латинские
  ң: 'n', ө: 'o', ү: 'u', җ: 'j', ʼ: '',
};

/**
 * Приводит строку к нижнему регистру, транслитерирует кириллицу в латиницу,
 * убирает диакритику и всё, кроме букв и цифр.
 */
export function normalizeForSearch(input: string): string {
  const lower = input.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

  let out = '';
  for (const ch of lower) {
    const mapped = CYRILLIC_TO_LATIN[ch];
    if (mapped !== undefined) out += mapped;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    // Дефис, точка и апостроф разделяют слова: «Жалал-Абад» → «zhalal abad».
    else if (/[\s\-–—_.'’]/.test(ch)) out += ' ';
    // прочие символы отбрасываем
  }
  return out.replace(/\s+/g, ' ').trim();
}

const CYRILLIC_RE = /[Ѐ-ӿ]/;

/**
 * Выбирает, как показать город участнице.
 *
 * GeoNames хранит основное имя латиницей («Talas»), а кириллические формы лежат
 * среди alternatenames без пометок языка. Берём кириллический вариант, только
 * если он доказуемо то же самое слово: совпадает после свёртки с запросом
 * участницы или с основным именем. Иначе показываем как есть.
 */
export function displayCityName(row: { name: string; alternatenames: string }, query?: string): string {
  if (CYRILLIC_RE.test(row.name)) return row.name;

  const alternates = row.alternatenames.split(',').map((a) => a.trim()).filter(Boolean);
  const cyrillic = alternates.filter((a) => CYRILLIC_RE.test(a));
  if (cyrillic.length === 0) return row.name;

  const targets = new Set<string>();
  if (query) targets.add(normalizeForSearch(query));
  targets.add(normalizeForSearch(row.name));

  const match = cyrillic.find((a) => targets.has(normalizeForSearch(a)));
  return match ?? row.name;
}

/**
 * Нормализованное основное имя города. Точное совпадение с ним — самый сильный
 * сигнал: в alternatenames у крупных городов попадаются посторонние формы,
 * которые после свёртки случайно совпадают с чужими короткими названиями.
 */
export function buildNameNorm(row: { name: string; asciiname: string }): string {
  const parts = [row.name, row.asciiname].map(normalizeForSearch).filter(Boolean);
  return [...new Set(parts)].join(' ');
}

/**
 * Текст, по которому ищем строку GeoNames: собственное имя, ascii-имя и все
 * альтернативные названия (в них и кириллица, и кыргызские формы).
 */
export function buildSearchText(row: { name: string; asciiname: string; alternatenames: string }): string {
  const parts = [row.name, row.asciiname, ...row.alternatenames.split(',')]
    .map((p) => normalizeForSearch(p))
    .filter((p) => p.length > 0);

  // Дубликаты только раздувают индекс.
  return [...new Set(parts)].join(' ');
}
