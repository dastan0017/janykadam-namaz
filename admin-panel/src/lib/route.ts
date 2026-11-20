import type { Screen } from '../types';

/**
 * Адреса разделов.
 *
 * Панель — одна страница, но у каждого раздела свой адрес: работают «назад» и
 * «вперёд» в браузере, перезагрузка оставляет там же, а ссылкой на нужный
 * экран можно поделиться. Маршрутизатор тут свой на десяток строк — целая
 * библиотека ради четырнадцати экранов не нужна, а состояние навигации и так
 * живёт в хранилище.
 *
 * Caddy отдаёт `index.html` на любой неизвестный путь, поэтому прямая ссылка
 * открывается, а не упирается в 404.
 */

export interface Route {
  screen: Screen;
  /** Код марафона: в адресе он читается лучше, чем UUID. */
  code?: string;
  topicId?: string;
  qId?: string;
  topicTab?: 'settings' | 'questions';
}

/** Экраны, которые живут вне марафона. */
const GLOBAL_PATHS: Record<string, Screen> = {
  '/marathons': 'marathons',
  '/bot/namaz': 'namaz',
  '/bot/texts': 'texts',
  '/bot/settings': 'bot',
  '/users': 'users',
  '/journal': 'journal',
};

/** Экраны марафона с простым адресом `/m/<код>/<что-то>`. */
const M_PATHS: Record<string, Screen> = {
  topics: 'topics',
  participants: 'participants',
  broadcasts: 'broadcasts',
  analytics: 'analytics',
  settings: 'settings',
  channel: 'channel',
};

const flip = (src: Record<string, Screen>): Partial<Record<Screen, string>> =>
  Object.fromEntries(Object.entries(src).map(([path, screen]) => [screen, path]));

const PATH_OF_GLOBAL = flip(GLOBAL_PATHS);
const PATH_OF_M = flip(M_PATHS);

/** Разбирает адрес. Непонятный путь ведёт в список марафонов. */
export function parseRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { screen: 'marathons' };

  const global = GLOBAL_PATHS[path];
  if (global) return { screen: global };

  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'm' && parts[1]) {
    const code = parts[1];
    const rest = parts.slice(2);

    if (rest.length === 0) return { screen: 'overview', code };

    if (rest[0] === 'topics' && rest.length > 1) {
      const topicId = rest[1];
      // Вопрос редактируется внутри темы, поэтому и адрес вложенный.
      if (rest[2] === 'q' && rest[3]) return { screen: 'questionEditor', code, topicId, qId: rest[3] };
      if (rest.length === 2) {
        const tab = new URLSearchParams(search).get('tab');
        return { screen: 'topicEditor', code, topicId, topicTab: tab === 'questions' ? 'questions' : 'settings' };
      }
      return { screen: 'topics', code };
    }

    const screen = M_PATHS[rest[0]];
    if (screen && rest.length === 1) return { screen, code };
  }

  return { screen: 'marathons' };
}

/** Собирает адрес. Экран марафона без кода показать нельзя — ведём в список. */
export function buildPath(route: Route): string {
  const global = PATH_OF_GLOBAL[route.screen];
  if (global) return global;
  if (!route.code) return '/marathons';

  const base = `/m/${encodeURIComponent(route.code)}`;

  switch (route.screen) {
    case 'overview':
      return base;
    case 'topicEditor':
      if (!route.topicId) return `${base}/topics`;
      return `${base}/topics/${route.topicId}${route.topicTab === 'questions' ? '?tab=questions' : ''}`;
    case 'questionEditor':
      if (!route.topicId || !route.qId) return `${base}/topics`;
      return `${base}/topics/${route.topicId}/q/${route.qId}`;
    default: {
      const tail = PATH_OF_M[route.screen];
      return tail ? `${base}/${tail}` : base;
    }
  }
}

/** Адрес, который видит браузер сейчас. */
export function currentPath(): string {
  return window.location.pathname + window.location.search;
}
