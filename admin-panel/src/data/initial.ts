import type { AppState } from '../types';
import { FALLBACK_TZ } from './constants';

/**
 * Пустое состояние панели: интерфейсные поля заданы, данных нет.
 * Данные приезжают из API сразу после проверки сессии.
 */
export function initialState(): AppState {
  return {
    auth: 'checking',
    me: null,
    authError: null,
    loading: false,
    loaded: [],
    role: 'admin',
    screen: 'marathons',
    mid: null,
    navOpen: false,
    marathons: [],
    data: {},
    users: [],
    audit: [],
    texts: [],
    bot: {
      username: '',
      name: '',
      desc: '',
      shortDesc: '',
      commands: '',
      menu: [],
      quietFrom: '22:30',
      quietTo: '04:30',
      capPerDay: 0,
    },
    botDraft: null,
    edit: null,
    topicId: null,
    topicTab: 'settings',
    qId: null,
    pvLang: 'kg',
    pvDone: false,
    tzView: FALLBACK_TZ,
    // Таблица участниц открывается на активных — вкладка «Все» рядом.
    pf: { q: '', status: 'active', tz: 'all', act: 'all', sort: 'name', dir: 1, sel: [] },
    drawerId: null,
    pointsModal: null,
    confirm: null,
    toast: null,
    textQ: '',
    textUntr: false,
    textKey: '',
    bc: {
      text: 'Ассаляму алейкум, {имя}! «{марафон}» уланууда — бүгүн да видеокружок унутпаңыз. Сиздин баллыңыз: {баллы}.',
      seg: 'all',
      when: 'now',
      stage: 'compose',
      sent: 0,
      result: null,
    },
    newM: null,
    channelStatus: {},
    filterTab: 'all',
    invite: null,
    userQ: '',
  };
}
