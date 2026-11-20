/**
 * Клиент админ-API.
 *
 * Сессия лежит в httpOnly-куке, поэтому каждый запрос идёт с
 * `credentials: 'include'`, а токенов в JavaScript нет вовсе. Кука ставится с
 * `SameSite=Lax`, так что панель и API должны быть на одном сайте: либо
 * поддомены одного домена, либо localhost с разными портами.
 */

/** Адрес API. Пустая строка — тот же origin, что и панель. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Работаем ли на локальных данных вместо бэкенда. */
export const USE_SEED: boolean = import.meta.env.VITE_USE_SEED === 'true';

export class ApiError extends Error {
  readonly status: number;
  /** Тело ответа: у 400 от бэкенда там бывают `issues` или `removing`. */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }

  get forbidden(): boolean {
    return this.status === 403;
  }
}

/** Вызывается, когда сессия кончилась: панель показывает вход. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Не дёргать обработчик 401 — нужно самой проверке сессии. */
  silent401?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_URL}/api${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Достаёт из тела ответа человеческое сообщение об ошибке. */
function messageOf(status: number, body: unknown): string {
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m) && m.length) return m.map(String).join('; ');
  }
  if (status === 0) return 'Бэкенд недоступен — проверьте, запущен ли он и верный ли VITE_API_URL';
  if (status === 401) return 'Нужно войти заново';
  if (status === 403) return 'Недостаточно прав';
  return `Ошибка ${status}`;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    // Сеть не ответила вовсе: бэкенд не запущен, CORS, обрыв.
    throw new ApiError(0, messageOf(0, null), String(err));
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.silent401) onUnauthorized?.();
    throw new ApiError(res.status, messageOf(res.status, body), body);
  }
  return body as T;
}

/** Ссылка на файл, который браузер скачивает сам (CSV участниц). */
export function fileUrl(path: string): string {
  return buildUrl(path);
}
