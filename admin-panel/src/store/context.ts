import { createContext, useContext, useEffect, useState } from 'react';
import type { TelegramAuthPayload } from '../api/dto';
import type { AppState, BotSettings, Marathon, Question, Role, Screen } from '../types';

export type Patch = Partial<AppState>;
export type Updater = (s: AppState) => Patch;

export interface Actions {
  set: (patch: Patch | Updater) => void;
  go: (screen: Screen, extra?: Patch) => void;
  toast: (msg: string) => void;
  setRoleView: (role: Role) => void;

  // вход
  loginWithTelegram: (payload: TelegramAuthPayload) => Promise<void>;
  logout: () => void;

  // марафоны
  switchM: (id: string) => void;
  duplicate: (id: string) => void;
  createM: () => void;
  deleteM: (id: string) => void;
  copyLink: (id: string) => void;
  setM: <K extends keyof Marathon>(k: K, v: Marathon[K]) => void;
  launch: () => void;

  // темы
  setT: (k: string, v: unknown) => void;
  toggleTopic: (id: string) => void;
  moveTopic: (id: string, dir: -1 | 1) => void;
  addTopic: () => void;
  deleteTopic: (id: string) => void;

  // вопросы и варианты ответов
  setQ: (k: keyof Question, v: unknown) => void;
  addQ: () => void;
  delQ: (id: string, leave?: boolean) => void;
  moveQ: (id: string, dir: -1 | 1) => void;
  setO: (oid: string, k: 'kg' | 'ru' | 'pts', v: string | number) => void;
  addO: () => void;
  delO: (oid: string) => void;
  moveO: (oid: string, dir: -1 | 1) => void;

  // участницы
  setPf: <K extends keyof AppState['pf']>(k: K, v: AppState['pf'][K]) => void;
  sortBy: (k: AppState['pf']['sort']) => void;
  toggleSel: (id: string) => void;
  selAll: () => void;
  bulk: (action: 'pause' | 'message') => void;
  setP: (id: string, k: string, v: unknown) => void;
  adjustPoints: () => void;
  removeP: (id: string) => void;
  exportCsv: () => void;

  // рассылки
  setBc: <K extends keyof AppState['bc']>(k: K, v: AppState['bc'][K]) => void;
  send: () => void;

  // бот и пользователи
  setBot: (patch: Partial<BotSettings>) => void;
  saveBotName: () => void;
  setRole: (uid: string, role: Role) => void;
  removeUser: (uid: string) => void;
  inviteUser: () => void;
}

export const StateCtx = createContext<AppState | null>(null);
export const ActionsCtx = createContext<Actions | null>(null);

export function useAppState(): AppState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('useAppState вызван вне StoreProvider');
  return s;
}

export function useActions(): Actions {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error('useActions вызван вне StoreProvider');
  return a;
}

/** Ширина окна меньше 760 px — мобильная раскладка: участницы живут и на телефоне. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 760));
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 760);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}
