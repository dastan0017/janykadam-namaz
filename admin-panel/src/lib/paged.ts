import { useEffect, useState } from 'react';

export interface PagerState {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}

/**
 * Разбивка длинного списка на страницы.
 *
 * Страница своя у каждой таблицы: это обычный `useState` внутри экрана, так что
 * пятая страница участниц не влияет на тексты бота и наоборот.
 *
 * `reset` — отпечаток фильтров. Когда он меняется, список уже другой, и
 * оставаться на пятой странице незачем.
 */
export function usePaged<T>(items: T[], reset: string, size = 25): { rows: T[]; pager: PagerState } {
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [reset]);

  const pages = Math.max(1, Math.ceil(items.length / size));
  // Список мог укоротиться после обновления — иначе покажется пустая страница.
  const current = Math.min(page, pages - 1);
  const from = current * size;
  const to = Math.min(from + size, items.length);

  return {
    rows: items.slice(from, to),
    pager: { page: current, pages, from, to, total: items.length, onPage: setPage },
  };
}
