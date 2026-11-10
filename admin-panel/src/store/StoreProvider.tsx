import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, USE_SEED, setUnauthorizedHandler } from '../api/client';
import { api } from '../api/endpoints';
import { loadGlobal, loadMarathon, loadParts, type GlobalPart } from '../api/load';
import {
  botPatch, marathonPatch, optionPatch, questionPatch, toLedger, toMe, toSegmentDto, toTopic, topicPatch,
} from '../api/map';
import { GLOBAL, NAMAZ } from '../data/constants';
import { initialState } from '../data/initial';
import { seed } from '../data/seed';
import { currentData, currentMarathon, filteredParts, segments } from '../lib/derive';
import { changedKeys, isDirty, snapshot } from '../lib/edits';
import { plural, slugify } from '../lib/format';
import { buildPath, currentPath, parseRoute, type Route } from '../lib/route';
import { localDate, tzLabel } from '../lib/time';
import type {
  AppState, BotSettings, BotText, EditKind, EditState, Marathon, MarathonData, QuestionType, Screen, Snapshot,
} from '../types';
import { ActionsCtx, StateCtx, type Actions, type Patch, type Updater } from './context';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Что перезагружать при открытии экрана.
 *
 * Данные правит не только панель: бот пишет в ту же базу, и отчёт, пришедший
 * минуту назад, виден только после обновления. Поэтому экран открывается со
 * свежими данными — но тянет лишь то, что показывает. `data` — текущий марафон.
 */
const REFRESH: Record<Screen, (GlobalPart | 'data')[]> = {
  marathons: ['marathons'],
  overview: ['data'],
  topics: ['data'],
  topicEditor: ['data'],
  questionEditor: ['data'],
  participants: ['data'],
  broadcasts: ['data'],
  analytics: ['data'],
  settings: ['marathons', 'data'],
  namaz: ['marathons', 'data'],
  texts: ['texts'],
  bot: ['bot'],
  users: ['users'],
  journal: ['audit'],
};

/** Состояние навигации по текущему адресу. */
type NavPatch = Pick<AppState, 'screen' | 'mid' | 'topicId' | 'qId' | 'topicTab'>;

function navOf(route: Route, marathons: Marathon[], fallbackMid: string | null): NavPatch {
  const m = route.code ? marathons.find((x) => x.code === route.code) : undefined;

  // Ссылка на марафон, которого нет: показываем список, а не пустой экран.
  if (!GLOBAL.includes(route.screen) && !m) {
    return { screen: 'marathons', mid: fallbackMid, topicId: null, qId: null, topicTab: 'settings' };
  }

  return {
    screen: route.screen,
    mid: m?.id ?? fallbackMid,
    topicId: route.topicId ?? null,
    qId: route.qId ?? null,
    topicTab: route.topicTab ?? 'settings',
  };
}

/** Адрес, отвечающий состоянию навигации. */
function pathOf(s: Pick<AppState, 'screen' | 'mid' | 'topicId' | 'qId' | 'topicTab' | 'marathons'>): string {
  return buildPath({
    screen: s.screen,
    code: s.marathons.find((m) => m.id === s.mid)?.code,
    topicId: s.topicId ?? undefined,
    qId: s.qId ?? undefined,
    topicTab: s.topicTab,
  });
}

/**
 * Состояние панели.
 *
 * Данные живут на бэкенде; здесь их копия, которой рисуются экраны. Правка
 * применяется сразу локально — интерфейс не должен ждать сеть, — а потом уходит
 * в API. Если запрос не прошёл, показывается причина и данные перезагружаются:
 * лучше вернуть правду, чем оставить на экране то, чего в базе нет.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const toastTimer = useRef<number | undefined>(undefined);
  const pollTimer = useRef<number | undefined>(undefined);
  // Текущее состояние для эффекта обновления: он зависит только от экрана.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Экран и марафон, для которых данные уже обновлены.
  const refreshedKey = useRef<string | null>(null);

  const set = useCallback((patch: Patch | Updater) => {
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  }, []);

  const toast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setState((s) => ({ ...s, toast: msg }));
    toastTimer.current = window.setTimeout(() => setState((s) => ({ ...s, toast: null })), 3600);
  }, []);

  /* ───────── загрузка ───────── */

  const reloadGlobal = useCallback(async () => {
    const patch = await loadGlobal();
    setState((s) => ({ ...s, ...patch }));
    return patch;
  }, []);

  const reloadMarathon = useCallback(async (id: string) => {
    const data = await loadMarathon(id);
    setState((s) => ({
      ...s,
      data: { ...s.data, [id]: data },
      loaded: s.loaded.includes(id) ? s.loaded : [...s.loaded, id],
      loading: false,
    }));
  }, []);

  /**
   * Возврат формы к значениям до правки. Варианты ответа, которых уже нет,
   * не воскрешаем: их удаление — отдельное действие, оно уже сохранено.
   */
  const undoEdit = useCallback(() => {
    setState((s) => {
      const e = s.edit;
      if (!e) return s;
      const base = e.base;

      if (e.kind === 'bot') return { ...s, bot: { ...s.bot, ...(base as unknown as Partial<BotSettings>) }, edit: null };
      if (e.kind === 'text') {
        return { ...s, texts: s.texts.map((x) => (x.key === e.id ? { ...x, ...(base as unknown as Partial<BotText>) } : x)), edit: null };
      }
      if (e.kind === 'marathon') {
        return { ...s, marathons: s.marathons.map((m) => (m.id === e.id ? { ...m, ...(base as unknown as Partial<Marathon>) } : m)), edit: null };
      }

      const d = clone(s.data);
      const topics = (s.mid ? d[s.mid]?.topics : undefined) ?? [];
      if (e.kind === 'topic') {
        const topic = topics.find((x) => x.id === e.id);
        if (topic) Object.assign(topic, base);
        return { ...s, data: d, edit: null };
      }

      const q = topics.flatMap((x) => x.questions).find((x) => x.id === e.id);
      for (const [k, v] of Object.entries(base)) {
        if (!q) break;
        if (!k.startsWith('o:')) {
          (q as unknown as Record<string, unknown>)[k] = v;
          continue;
        }
        const [, oid, field] = k.split(':');
        const o = q.options.find((x) => x.id === oid);
        if (o) (o as unknown as Record<string, unknown>)[field] = v;
      }
      return { ...s, data: d, edit: null };
    });
  }, []);

  const bootstrap = useCallback(async () => {
    // Разработка без бэкенда: панель работает на фикстурах и ничего не сохраняет.
    if (USE_SEED) {
      setState(seed());
      return;
    }
    try {
      const me = await api.me();
      const patch = await loadGlobal();
      const first = patch.marathons.find((m) => m.status === 'running') ?? patch.marathons[0];
      // Открываем то, что в адресе: перезагрузка должна оставить на месте.
      const nav = navOf(parseRoute(window.location.pathname, window.location.search), patch.marathons, first?.id ?? null);

      // Отмечаем до того, как панель станет видимой: иначе эффект обновления
      // успеет сработать на первом же кадре и сходит за тем же самым второй раз.
      refreshedKey.current = `${nav.screen}|${nav.mid ?? ''}`;

      // Приводим адрес к каноническому виду: «/» и непонятный путь не должны
      // остаться в истории — иначе «назад» вернёт туда же.
      window.history.replaceState(null, '', pathOf({ ...nav, marathons: patch.marathons }));

      setState((s) => ({
        ...s,
        ...patch,
        ...nav,
        auth: 'ready',
        authError: null,
        me: toMe(me),
        role: me.role,
        loading: !!nav.mid,
      }));

      if (nav.mid) await reloadMarathon(nav.mid);
    } catch (err) {
      const anonymous = err instanceof ApiError && err.unauthorized;
      setState((s) => ({
        ...s,
        auth: 'anonymous',
        me: null,
        authError: anonymous ? null : errorText(err),
      }));
    }
  }, [reloadMarathon]);

  /**
   * Журнал баллов и окна на сегодня грузятся, когда открывают карточку:
   * тянуть их для всех участниц сразу не нужно, а в таблице они не видны.
   */
  useEffect(() => {
    const pid = state.drawerId;
    const mid = state.mid;
    if (!pid || !mid || state.data[mid]?.ledger[pid]) return;

    let alive = true;
    void api
      .participant(pid, mid)
      .then((detail) => {
        if (!alive) return;
        setState((s) => {
          const data = s.data[mid];
          if (!data) return s;
          // Сколько отчётов в каждый из последних дней — настоящие, из базы.
          const byDay: Record<string, number> = {};
          for (const r of detail.last7) byDay[r.dayKey] = (byDay[r.dayKey] ?? 0) + 1;

          return {
            ...s,
            data: {
              ...s.data,
              [mid]: {
                ...data,
                ledger: { ...data.ledger, [pid]: detail.ledger.map(toLedger) },
                recent: { ...data.recent, [pid]: byDay },
              },
            },
          };
        });
      })
      .catch(() => {
        // Карточка откроется и без журнала — показывать ошибку здесь незачем.
      });

    return () => {
      alive = false;
    };
  }, [state.drawerId, state.mid, state.data]);

  useEffect(() => {
    setUnauthorizedHandler(() => setState((s) => ({ ...s, auth: 'anonymous', me: null })));
    void bootstrap();
    return () => {
      setUnauthorizedHandler(null);
      window.clearTimeout(toastTimer.current);
      window.clearInterval(pollTimer.current);
    };
  }, [bootstrap]);

  /** Закрытие вкладки с несохранённой формой — через вопрос браузера. */
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (isDirty(stateRef.current)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  /** Адрес следует за состоянием: каждый раздел виден в строке браузера. */
  const path = pathOf(state);
  useEffect(() => {
    if (state.auth !== 'ready') return;
    if (currentPath() === path) return;
    window.history.pushState(null, '', path);
  }, [path, state.auth]);

  /** «Назад» и «вперёд» в браузере: адрес ведёт состояние. */
  useEffect(() => {
    const onPop = () => {
      const s = stateRef.current;
      if (s.auth !== 'ready') return;

      const apply = () => {
        const nav = navOf(parseRoute(window.location.pathname, window.location.search), s.marathons, s.mid);
        // Непонятный путь не должен остаться в строке браузера: показываем список
        // марафонов — пусть и адрес будет его.
        const canonical = pathOf({ ...nav, marathons: s.marathons });
        if (canonical !== currentPath()) window.history.replaceState(null, '', canonical);

        setState((prev) => ({ ...prev, ...nav, drawerId: null, navOpen: false }));
      };

      if (!isDirty(s)) {
        apply();
        return;
      }

      // «Назад» с несохранённой формой: возвращаем адрес и спрашиваем. После
      // отмены правок тот же «назад» пройдёт уже без вопроса.
      window.history.pushState(null, '', pathOf(s));
      setState((prev) => ({
        ...prev,
        confirm: {
          title: 'Уйти без сохранения?',
          body: 'Правки в форме не сохранены. Если уйти, они пропадут.',
          ok: 'Уйти без сохранения',
          danger: true,
          onOk: () => {
            setState((x) => ({ ...x, confirm: null }));
            undoEdit();
            window.history.back();
          },
        },
      }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [undoEdit]);

  /**
   * Обновление при открытии экрана. Срабатывает на смену экрана или марафона
   * и тянет только то, что этот экран показывает.
   */
  const refreshKey = `${state.screen}|${state.mid ?? ''}`;
  useEffect(() => {
    if (USE_SEED || state.auth !== 'ready') return;
    if (refreshedKey.current === refreshKey) return;
    refreshedKey.current = refreshKey;

    const { screen, mid, loaded } = stateRef.current;
    const parts = REFRESH[screen];
    const globals = parts.filter((p): p is GlobalPart => p !== 'data');
    // Данные марафона нужны и тем экранам, что их не показывают, если их ещё
    // нет: иначе переключение марафона с общего экрана оставит пустоту.
    const withData = !!mid && (parts.includes('data') || !loaded.includes(mid));

    // Несохранённых правок здесь уже нет: уход с формы их сохраняет или
    // отменяет — иначе ответ сервера затёр бы их молча.
    let alive = true;
    void (async () => {
      try {
        await Promise.all([
          globals.length
            ? loadParts(globals).then((patch) => {
                if (alive) setState((s) => ({ ...s, ...patch }));
              })
            : null,
          withData && mid ? reloadMarathon(mid) : null,
        ]);
      } catch (err) {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false }));
        toast(`Не удалось обновить данные: ${errorText(err)}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshKey, state.auth, reloadMarathon, toast]);

  const actions = useMemo<Actions>(() => {
    /** Правка данных марафонов: клонирует data и marathons, чтобы мутировать их свободно. */
    const mut = (f: (d: Record<string, MarathonData>, s: AppState, ms: Marathon[]) => Patch | void) => {
      setState((s) => {
        const d = clone(s.data);
        const ms = clone(s.marathons);
        const extra = f(d, s, ms) ?? {};
        return { ...s, data: d, marathons: ms, ...extra };
      });
    };

    /**
     * Запрос к API. Ошибку показывает тостом и возвращает данные с бэкенда:
     * локальная правка могла не сохраниться, и на экране осталась бы неправда.
     */
    const call = async (fn: () => Promise<unknown>, opts: { ok?: string; reload?: string | 'global' } = {}) => {
      try {
        await fn();
        if (opts.ok) toast(opts.ok);
        return true;
      } catch (err) {
        toast(errorText(err));
        if (opts.reload === 'global') void reloadGlobal().catch(() => {});
        else if (opts.reload) void reloadMarathon(opts.reload).catch(() => {});
        return false;
      }
    };

    const confirmAction = (title: string, body: string, ok: string, danger: boolean, onOk: () => void) =>
      set({ confirm: { title, body, ok, danger, onOk } });

    /* ───────── несохранённые правки формы ───────── */

    /**
     * Поля формы меняют состояние сразу, а на бэкенд уходят по кнопке
     * «Сохранить». Перед первой правкой снимается снимок значений: по нему
     * считается тело запроса и по нему же работает «Отменить».
     */
    const startEdit = (s: AppState, kind: EditKind, id: string): Patch => {
      if (s.edit && s.edit.kind === kind && s.edit.id === id) return {};
      const base = snapshot(s, kind, id);
      return base ? { edit: { kind, id, base, saving: false } } : {};
    };

    const merge = (keys: string[], one: (k: string) => Record<string, unknown> | null) => {
      const body: Record<string, unknown> = {};
      for (const k of keys) Object.assign(body, one(k) ?? {});
      return Object.keys(body).length ? body : null;
    };

    /** Правки формы — в запросы: у вопроса их два, у остальных форм один. */
    const sendEdit = async (e: EditState, now: Snapshot, keys: string[]) => {
      if (e.kind === 'marathon') {
        const body = merge(keys, (k) => marathonPatch(k, now[k]));
        if (body) await api.patchMarathon(e.id, body);
        return;
      }
      if (e.kind === 'topic') {
        // Пустые баллы и незаполненное окно на бэкенд не отправляются: лучше
        // сказать об этом, чем молча оставить на экране несохранённое поле.
        const bad = keys.filter((k) => !topicPatch(k, now[k]));
        if (bad.length) {
          throw new Error(bad.includes('points') ? 'Баллы не заданы — тема не сохранена' : 'Окно сдачи заполнено не до конца — тема не сохранена');
        }
        const body = merge(keys, (k) => topicPatch(k, now[k]));
        if (body) await api.patchTopic(e.id, body);
        return;
      }
      if (e.kind === 'bot') {
        const body = merge(keys, (k) => botPatch(k, now[k]));
        if (body) await api.patchBotSettings(body);
        return;
      }
      if (e.kind === 'text') {
        const body = merge(keys, (k) => ({ [k]: String(now[k]) }));
        if (body) await api.patchBotText(e.id, body);
        return;
      }

      // Вопрос и его варианты ответа — одна форма, но разные ручки.
      const qBody = merge(keys.filter((k) => !k.startsWith('o:')), (k) => questionPatch(k, now[k]));
      const byOption = new Map<string, Record<string, unknown>>();
      for (const k of keys) {
        if (!k.startsWith('o:')) continue;
        const [, oid, field] = k.split(':');
        const patch = optionPatch(field as 'kg' | 'ru' | 'pts', now[k] as string | number);
        byOption.set(oid, { ...(byOption.get(oid) ?? {}), ...patch });
      }

      await Promise.all([
        qBody ? api.patchQuestion(e.id, qBody) : null,
        ...[...byOption].map(([oid, body]) => api.patchOption(oid, body)),
      ]);
    };

    /**
     * Сохранение формы. `false` — не прошло; правки остаются на экране, чтобы
     * их можно было поправить и отправить снова, а не набирать заново.
     */
    const saveEdit = async (quiet = false): Promise<boolean> => {
      const s = stateRef.current;
      const e = s.edit;
      const now = e ? snapshot(s, e.kind, e.id) : null;
      const keys = e && now ? changedKeys(e.base, now) : [];

      if (!e || !now || keys.length === 0) {
        if (e) setState((x) => ({ ...x, edit: null }));
        return true;
      }

      setState((x) => ({ ...x, edit: x.edit ? { ...x.edit, saving: true } : null }));
      try {
        await sendEdit(e, now, keys);
        setState((x) => ({ ...x, edit: null }));
        if (!quiet) toast('Сохранено');
        return true;
      } catch (err) {
        setState((x) => ({ ...x, edit: x.edit ? { ...x.edit, saving: false } : null }));
        toast(errorText(err));
        return false;
      }
    };

    /**
     * Добавить, удалить, переставить — действия сразу: они перезагружают
     * данные, и несохранённую правку формы сначала надо дослать.
     */
    const afterSave = (fn: () => void) => {
      void (async () => {
        if (await saveEdit(true)) fn();
      })();
    };

    /** Перед удалением: правки удаляемого выбрасываем, чужие — досылаем. */
    const beforeDelete = (id: string, fn: () => void) => {
      const e = stateRef.current.edit;
      if (e && e.id === id) {
        setState((x) => ({ ...x, edit: null }));
        fn();
        return;
      }
      afterSave(fn);
    };

    /** Уход с формы с несохранёнными правками: спрашиваем, а не теряем молча. */
    const guard = (leave: () => void) => {
      if (!isDirty(stateRef.current)) {
        leave();
        return;
      }
      confirmAction('Уйти без сохранения?', 'Правки в форме не сохранены. Если уйти, они пропадут.', 'Уйти без сохранения', true, () => {
        set({ confirm: null });
        undoEdit();
        leave();
      });
    };

    const go: Actions['go'] = (screen, extra) => guard(() => set({ screen, navOpen: false, ...extra }));

    return {
      set,
      go,
      toast,
      setRoleView: (role) => set(role === 'curator' ? { role, drawerId: null, invite: null } : { role }),

      /* ───────── форма ───────── */

      saveEdit: () => void saveEdit(),
      undoEdit,
      leaveForm: (then) => guard(then),

      /* ───────── вход ───────── */

      loginWithTelegram: async (payload) => {
        setState((s) => ({ ...s, auth: 'checking', authError: null }));
        try {
          await api.loginTelegram(payload);
          await bootstrap();
        } catch (err) {
          setState((s) => ({ ...s, auth: 'anonymous', authError: errorText(err) }));
        }
      },

      logout: () => {
        void api.logout().catch(() => {});
        setState(() => ({ ...initialState(), auth: 'anonymous' }));
      },

      /* ───────── марафоны ───────── */

      switchM: (id) =>
        guard(() => {
        // Загрузку берёт на себя эффект обновления ниже: он всё равно сходит
        // за данными при смене марафона, и два запроса подряд не нужны.
        set((s) => ({
          mid: id,
          loading: !s.loaded.includes(id),
          topicId: null,
          qId: null,
          drawerId: null,
          pf: { ...s.pf, sel: [] },
          // С общих экранов переключение марафона не уводит.
          screen: GLOBAL.includes(s.screen) ? s.screen : 'overview',
        }));
        }),

      duplicate: (id) => {
        const src = state.marathons.find((m) => m.id === id);
        const dd = state.data[id];
        if (!src) return;
        void (async () => {
          try {
            const copy = await api.duplicateMarathon(id);
            await reloadGlobal();
            await reloadMarathon(copy.id);
            const nz = (dd?.namaz ?? []).length;
            const nt = dd?.topics.length ?? 0;
            toast(
              `Создан черновик «${copy.name}» — ${nz} ${plural(nz, 'намаз', 'намаза', 'намазов')} и ${nt} ${plural(nt, 'своя тема', 'свои темы', 'своих тем')}, без участниц`,
            );
          } catch (err) {
            toast(errorText(err));
          }
        })();
      },

      createM: () => {
        const nm = state.newM;
        if (!nm) return;
        if (!nm.name.trim()) {
          set({ newM: { ...nm, err: 'Название обязательно' } });
          return;
        }
        const name = nm.name.trim();
        void (async () => {
          try {
            const created = await api.createMarathon({
              code: slugify(name),
              name,
              startDate: nm.start || localDate('Asia/Bishkek'),
              endDate: nm.end || localDate('Asia/Bishkek'),
            });
            await reloadGlobal();
            await reloadMarathon(created.id);
            set({ newM: null, mid: created.id });
            toast(`Черновик создан, код ${created.code}. На странице «Темы» отметьте намазы и добавьте свои темы.`);
          } catch (err) {
            set((s) => ({ newM: s.newM ? { ...s.newM, err: errorText(err) } : null }));
          }
        })();
      },

      deleteM: (id) => {
        const m = state.marathons.find((x) => x.id === id);
        if (!m) return;
        const n = state.data[id]?.participants.length ?? 0;
        confirmAction(
          `Удалить марафон «${m.name}»?`,
          m.status === 'draft'
            ? 'Черновик удалится вместе со своими темами. Участниц в нём нет.'
            : `Удалятся ${n} участниц, все отчёты и баллы. Это действие нельзя отменить.`,
          'Удалить',
          true,
          () => {
            set({ confirm: null });
            void (async () => {
              if (!(await call(() => api.deleteMarathon(id), { reload: 'global' }))) return;
              mut((d, s, ms) => {
                const i = ms.findIndex((x) => x.id === id);
                if (i >= 0) ms.splice(i, 1);
                delete d[id];
                return { mid: s.mid === id ? (ms[0]?.id ?? null) : s.mid };
              });
            })();
          },
        );
      },

      copyLink: (id) => {
        const m = state.marathons.find((x) => x.id === id);
        if (!m) return;
        if (!state.bot.username) {
          toast('Username бота неизвестен — бот ещё не поднялся или Telegram недоступен');
          return;
        }
        const link = `https://t.me/${state.bot.username}?start=${m.code}`;
        void navigator.clipboard?.writeText(link).catch(() => {});
        toast(m.status === 'draft' ? `Скопировано: ${link} — заработает после запуска марафона` : `Скопировано: ${link}`);
      },

      setM: (k, v) => {
        const mid = state.mid;
        if (!mid) return;
        mut((_d, s, ms) => {
          const m = ms.find((x) => x.id === s.mid);
          if (m) (m[k] as Marathon[typeof k]) = v;
          return startEdit(s, 'marathon', mid);
        });
      },

      launch: () => {
        const mid = state.mid;
        if (!mid) return;
        void (async () => {
          try {
            await api.launch(mid);
            await reloadGlobal();
            toast('Марафон открыт для набора. Deep link активен.');
          } catch (err) {
            toast(errorText(err));
          }
        })();
      },

      /* ───────── темы ───────── */

      setT: (k, v) => {
        const topicId = state.topicId;
        if (!topicId || !state.mid) return;
        mut((d, s) => {
          const t = s.mid ? d[s.mid].topics.find((x) => x.id === s.topicId) : undefined;
          if (t) (t as unknown as Record<string, unknown>)[k] = v;
          return startEdit(s, 'topic', topicId);
        });
      },

      toggleTopic: (id) =>
        afterSave(() => {
        const ns = NAMAZ.find((x) => x.id === id);
        const own = currentData(state).topics.find((x) => x.id === id);
        if (!ns && !own) return;

        const mid = state.mid;
        if (!mid) return;
        const m = currentMarathon(state);
        const n = currentData(state).participants.filter((p) => p.status === 'active').length;
        const enabled = currentData(state).namaz ?? [];
        const on = ns ? enabled.includes(id) : own!.active;
        const name = (ns ?? own)!.nameKg || 'без названия';

        const save = async (confirmRemoval: boolean) => {
          if (ns) {
            const next = on ? enabled.filter((x) => x !== id) : [...enabled, id];
            const ordered = NAMAZ.filter((x) => next.includes(x.id)).map((x) => x.id);
            return call(() => api.setNamaz(mid, ordered, confirmRemoval), { reload: mid });
          }
          return call(() => api.patchTopic(id, { active: !on }), { reload: mid });
        };

        const applyLocal = (d: Record<string, MarathonData>, s: AppState) => {
          if (!s.mid) return;
          if (ns) {
            const a = d[s.mid].namaz ?? (d[s.mid].namaz = []);
            const i = a.indexOf(id);
            if (i >= 0) a.splice(i, 1);
            else {
              a.push(id);
              // Держим намазы в каноническом порядке библиотеки.
              a.sort((x, y) => NAMAZ.findIndex((z) => z.id === x) - NAMAZ.findIndex((z) => z.id === y));
            }
          } else {
            const x = d[s.mid].topics.find((t) => t.id === id);
            if (x) x.active = !x.active;
          }
        };

        // Выключение темы в идущем марафоне — с последствием и записью в журнал, без черновика.
        if (m?.status === 'running' && on) {
          confirmAction(
            `Выключить «${name}» в этом марафоне?`,
            `Это уберёт «${name}» из списка у ${n} ${plural(n, 'участницы', 'участниц', 'участниц')} начиная с сегодняшнего дня. Отчёты за прошлые дни сохранятся, баллы не снимутся. Изменение применяется сразу, без черновика.`,
            'Выключить',
            false,
            () => {
              mut((d, s) => {
                applyLocal(d, s);
                return { confirm: null };
              });
              void (async () => {
                if (await save(true)) toast(`«${name}» выключена. Записано в журнал.`);
              })();
            },
          );
        } else {
          mut((d, s) => applyLocal(d, s));
          void save(false);
        }
        }),

      moveTopic: (id, dir) =>
        afterSave(() => {
        const mid = state.mid;
        if (!mid) return;
        mut((d, s) => {
          if (!s.mid) return;
          const a = d[s.mid].topics;
          const i = a.findIndex((t) => t.id === id);
          const j = i + dir;
          if (j < 0 || j >= a.length) return;
          [a[i], a[j]] = [a[j], a[i]];
          void call(() => api.reorderTopics(mid, a.map((t) => t.id)), { reload: mid });
        });
        }),

      addTopic: () =>
        afterSave(() => {
        const mid = state.mid;
        if (!mid) return;
        const pts = currentMarathon(state)?.pointsDefault ?? 5;
        void (async () => {
          try {
            const created = await api.createTopic(mid, {
              emoji: '🕊',
              nameKg: '',
              nameRu: '',
              active: true,
              startLocal: '05:00',
              endLocal: '22:00',
              points: pts,
              freq: 'daily',
              mandatory: false,
              remindOffsetMin: 0,
            });
            mut((d, s) => {
              if (!s.mid) return;
              d[s.mid].topics.push(toTopic({ ...created, questions: [] }));
              return { screen: 'topicEditor', topicId: created.id, topicTab: 'settings' };
            });
          } catch (err) {
            toast(errorText(err));
          }
        })();
        }),

      deleteTopic: (id) => {
        const t = currentData(state).topics.find((x) => x.id === id);
        const mid = state.mid;
        if (!t || !mid) return;
        confirmAction(
          `Удалить тему «${t.nameKg || 'без названия'}»?`,
          'Удалятся вопросы и варианты ответов. Уже принятые отчёты и баллы по теме сохранятся в истории участниц.',
          'Удалить тему',
          true,
          () =>
            beforeDelete(id, () => {
            mut((d, s) => {
              if (!s.mid) return;
              d[s.mid].topics = d[s.mid].topics.filter((x) => x.id !== id);
              return { confirm: null, screen: 'topics', topicId: null };
            });
            void call(() => api.deleteTopic(id), { reload: mid });
            }),
        );
      },

      /* ───────── вопросы и варианты ответов ───────── */

      setQ: (k, v) => {
        const qId = state.qId;
        const mid = state.mid;
        if (!qId || !mid) return;

        if (k === 'type') {
          // Смена типа переписывает варианты на бэкенде: у шкалы и да/нет надписи
          // заданы типом. Поэтому она применяется сразу, а ответ сервера
          // забирается целиком — угадать новые варианты панель не может.
          const body = questionPatch('type', v);
          if (!body) return;
          afterSave(() => {
            void (async () => {
              try {
                await api.patchQuestion(qId, body);
                await reloadMarathon(mid);
                void (v as QuestionType);
              } catch (err) {
                toast(errorText(err));
                void reloadMarathon(mid).catch(() => {});
              }
            })();
          });
          return;
        }

        mut((d, s) => {
          if (!s.mid) return;
          const q = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions.find((x) => x.id === s.qId);
          if (!q) return;
          (q as unknown as Record<string, unknown>)[k] = v;
          return startEdit(s, 'question', qId);
        });
      },

      addQ: () =>
        afterSave(() => {
        const topicId = state.topicId;
        const mid = state.mid;
        if (!topicId || !mid) return;
        void (async () => {
          try {
            const q = await api.createQuestion(topicId, { type: 'single', required: true, textKg: '', textRu: '' });
            // У одиночного выбора вариантов нет вовсе — редактору нужен хотя бы один.
            await api.createOption(q.id, { labelKg: '', labelRu: '', points: 0 });
            await reloadMarathon(mid);
            set({ screen: 'questionEditor', qId: q.id });
          } catch (err) {
            toast(errorText(err));
          }
        })();
        }),

      delQ: (id, leave) =>
        beforeDelete(id, () => {
        const mid = state.mid;
        if (!mid) return;
        mut((d, s) => {
          if (!s.mid) return;
          const t = d[s.mid].topics.find((x) => x.id === s.topicId);
          if (t) t.questions = t.questions.filter((q) => q.id !== id);
          return leave ? { screen: 'topicEditor', topicTab: 'questions', qId: null } : {};
        });
        void call(() => api.deleteQuestion(id), { reload: mid });
        }),

      moveQ: (id, dir) =>
        afterSave(() => {
        const mid = state.mid;
        const topicId = state.topicId;
        if (!mid || !topicId) return;
        mut((d, s) => {
          if (!s.mid) return;
          const a = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions;
          if (!a) return;
          const i = a.findIndex((q) => q.id === id);
          const j = i + dir;
          if (j < 0 || j >= a.length) return;
          [a[i], a[j]] = [a[j], a[i]];
          void call(() => api.reorderQuestions(topicId, a.map((q) => q.id)), { reload: mid });
        });
        }),

      setO: (oid, k, v) => {
        const qId = state.qId;
        if (!qId || !state.mid) return;
        mut((d, s) => {
          if (!s.mid) return;
          const o = d[s.mid].topics
            .find((t) => t.id === s.topicId)
            ?.questions.find((q) => q.id === s.qId)
            ?.options.find((x) => x.id === oid);
          if (o) (o as unknown as Record<string, unknown>)[k] = v;
          return startEdit(s, 'question', qId);
        });
      },

      addO: () =>
        afterSave(() => {
        const qId = state.qId;
        const mid = state.mid;
        if (!qId || !mid) return;
        void (async () => {
          try {
            const created = await api.createOption(qId, { labelKg: '', labelRu: '', points: 0 });
            mut((d, s) => {
              if (!s.mid) return;
              d[s.mid].topics
                .find((t) => t.id === s.topicId)
                ?.questions.find((q) => q.id === s.qId)
                ?.options.push({ id: created.id, kg: '', ru: '', pts: 0 });
            });
          } catch (err) {
            toast(errorText(err));
          }
        })();
        }),

      delO: (oid) =>
        afterSave(() => {
        const mid = state.mid;
        if (!mid) return;
        mut((d, s) => {
          if (!s.mid) return;
          const q = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions.find((x) => x.id === s.qId);
          if (q) q.options = q.options.filter((o) => o.id !== oid);
        });
        void call(() => api.deleteOption(oid), { reload: mid });
        }),

      moveO: (oid, dir) =>
        afterSave(() => {
        const mid = state.mid;
        const qId = state.qId;
        if (!mid || !qId) return;
        mut((d, s) => {
          if (!s.mid) return;
          const a = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions.find((q) => q.id === s.qId)?.options;
          if (!a) return;
          const i = a.findIndex((o) => o.id === oid);
          const j = i + dir;
          if (j < 0 || j >= a.length) return;
          [a[i], a[j]] = [a[j], a[i]];
          void call(() => api.reorderOptions(qId, a.map((o) => o.id)), { reload: mid });
        });
        }),

      /* ───────── участницы ───────── */

      setPf: (k, v) => set((s) => ({ pf: { ...s.pf, [k]: v } })),

      sortBy: (k) => set((s) => ({ pf: { ...s.pf, sort: k, dir: s.pf.sort === k ? ((-s.pf.dir) as 1 | -1) : 1 } })),

      toggleSel: (id) =>
        set((s) => ({ pf: { ...s.pf, sel: s.pf.sel.includes(id) ? s.pf.sel.filter((x) => x !== id) : [...s.pf.sel, id] } })),

      selAll: () => {
        const ids = filteredParts(state).map((p) => p.id);
        set((s) => ({ pf: { ...s.pf, sel: s.pf.sel.length === ids.length ? [] : ids } }));
      },

      bulk: (action) => {
        const n = state.pf.sel.length;
        const mid = state.mid;
        if (!mid) return;

        if (action === 'pause') {
          const ids = [...state.pf.sel];
          mut((d, s) => {
            if (!s.mid) return;
            d[s.mid].participants.forEach((p) => {
              if (ids.includes(p.id)) p.status = 'paused';
            });
            return { pf: { ...s.pf, sel: [] } };
          });
          void (async () => {
            for (const id of ids) {
              if (!(await call(() => api.setParticipantStatus(id, mid, 'paused'), { reload: mid }))) return;
            }
            toast(`Пауза включена у ${n} ${plural(n, 'участницы', 'участниц', 'участниц')}`);
          })();
        }
        if (action === 'message') {
          set((s) => ({ screen: 'broadcasts', bc: { ...s.bc, seg: 'selected', selIds: [...s.pf.sel], stage: 'compose' } }));
        }
      },

      setP: (id, k, v) => {
        const mid = state.mid;
        mut((d, s) => {
          if (!s.mid) return;
          const p = d[s.mid].participants.find((x) => x.id === id);
          if (p) (p as unknown as Record<string, unknown>)[k] = v;
        });
        if (mid && k === 'status') {
          void call(() => api.setParticipantStatus(id, mid, v as 'active' | 'paused' | 'left' | 'finished'), { reload: mid });
        }
      },

      adjustPoints: () => {
        const pm = state.pointsModal;
        const mid = state.mid;
        if (!pm || !mid) return;
        const n = Number(pm.delta);
        if (!n) {
          set({ pointsModal: { ...pm, err: 'Укажите число, отличное от нуля' } });
          return;
        }
        if (!pm.reason.trim()) {
          set({ pointsModal: { ...pm, err: 'Причина обязательна — она видна участнице и попадает в журнал' } });
          return;
        }
        const reason = pm.reason.trim();
        void (async () => {
          try {
            await api.adjustPoints(pm.pid, mid, n, reason);
            mut((d, s) => {
              if (!s.mid) return;
              const p = d[s.mid].participants.find((x) => x.id === pm.pid);
              if (p) p.points += n;
              const L = d[s.mid].ledger;
              (L[pm.pid] = L[pm.pid] ?? []).unshift({ d: localDate('Asia/Bishkek'), delta: n, reason });
              return { pointsModal: null };
            });
            toast(`${n > 0 ? '+' : ''}${n} баллов начислено. Участница получит уведомление с причиной.`);
          } catch (err) {
            set((s) => ({ pointsModal: s.pointsModal ? { ...s.pointsModal, err: errorText(err) } : null }));
          }
        })();
      },

      removeP: (id) => {
        const p = currentData(state).participants.find((x) => x.id === id);
        const mid = state.mid;
        if (!p || !mid) return;
        confirmAction(
          `Удалить ${p.name} из марафона?`,
          `Она перестанет получать напоминания и не сможет сдавать отчёты. ${p.points} баллов и история сохранятся в архиве. Бот отправит ей сообщение об исключении.`,
          'Удалить из марафона',
          true,
          () => {
            mut((d, s) => {
              if (!s.mid) return;
              const x = d[s.mid].participants.find((y) => y.id === id);
              if (x) x.status = 'left';
              return { confirm: null, drawerId: null };
            });
            void (async () => {
              if (await call(() => api.removeParticipant(id, mid), { reload: mid })) {
                toast(`${p.name} исключена из марафона`);
              }
            })();
          },
        );
      },

      exportCsv: () => {
        const rows: (string | number)[][] = [
          ['Имя', 'Telegram', 'Часовой пояс', 'Статус', 'Баллы', 'Серия', 'Дней без отчёта'],
          ...filteredParts(state).map((p) => [p.name, p.user, tzLabel(p.tz), p.status, p.points, p.streak, p.last]),
        ];
        // BOM, чтобы Excel не поломал кириллицу; разделитель — точка с запятой.
        const csv = '﻿' + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = 'uchastnitsy-' + (state.mid ?? 'marathon') + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`CSV: ${rows.length - 1} строк`);
      },

      /* ───────── рассылки ───────── */

      setBc: (k, v) => set((s) => ({ bc: { ...s.bc, [k]: v } })),

      /**
       * Отправка идёт видимо долго: бот держит общий лимит 25 сообщений в
       * секунду, поэтому прогресс настоящий — мы опрашиваем рассылку у бэкенда.
       */
      send: () => {
        const mid = state.mid;
        if (!mid) return;
        const segs = segments(state);
        const seg = segs.find((x) => x.id === state.bc.seg) ?? segs[0];
        if (!seg) return;

        const text = state.bc.text;
        const segment = toSegmentDto(state.bc.seg, state.bc.selIds);
        const schedule = state.bc.when === 'now' ? { kind: 'now' } : { kind: 'tomorrow', at: '09:00' };

        set((s) => ({ bc: { ...s.bc, stage: 'sending', sent: 0, total: seg.list.length } }));

        void (async () => {
          try {
            const { id, count } = await api.createBroadcast(mid, { text, segment, schedule });
            set((s) => ({ bc: { ...s.bc, total: count } }));

            // «Завтра 09:00» уйдёт без нас: показываем, что рассылка поставлена.
            if (state.bc.when !== 'now') {
              await reloadMarathon(mid);
              set((s) => ({
                ...s,
                bc: { ...s.bc, stage: 'done', sent: count, result: { count, delivered: 0, blocked: 0, blockedNames: '' } },
              }));
              toast(`Рассылка поставлена на завтра 09:00 — ${count} ${plural(count, 'получатель', 'получателя', 'получателей')}`);
              return;
            }

            window.clearInterval(pollTimer.current);
            pollTimer.current = window.setInterval(() => {
              void (async () => {
                try {
                  const p = await api.broadcastProgress(id);
                  const blocked = (p.totals.blocked ?? 0) + (p.totals.failed ?? 0);
                  const handled = (p.totals.sent ?? 0) + blocked;

                  if (p.status === 'done' || (p.totals.pending ?? 0) === 0) {
                    window.clearInterval(pollTimer.current);
                    await reloadMarathon(mid);
                    setState((s) => {
                      const names = (s.data[mid]?.participants ?? [])
                        .filter((x) => x.blocked && seg.list.some((y) => y.id === x.id))
                        .map((x) => x.name)
                        .join(', ');
                      return {
                        ...s,
                        bc: {
                          ...s.bc,
                          stage: 'done',
                          sent: count,
                          result: { count, delivered: p.totals.sent ?? 0, blocked, blockedNames: names },
                        },
                      };
                    });
                  } else {
                    setState((s) => ({ ...s, bc: { ...s.bc, sent: handled } }));
                  }
                } catch (err) {
                  window.clearInterval(pollTimer.current);
                  toast(errorText(err));
                  setState((s) => ({ ...s, bc: { ...s.bc, stage: 'compose' } }));
                }
              })();
            }, 1500);
          } catch (err) {
            toast(errorText(err));
            set((s) => ({ bc: { ...s.bc, stage: 'compose' } }));
          }
        })();
      },

      /* ───────── бот и пользователи ───────── */

      setBot: (patch) => set((s) => ({ bot: { ...s.bot, ...patch }, ...startEdit(s, 'bot', 'bot') })),

      setText: (key, lang, value) =>
        set((s) => ({
          texts: s.texts.map((x) => (x.key === key ? { ...x, [lang]: value } : x)),
          ...startEdit(s, 'text', key),
        })),

      saveBotName: () => {
        const draft = state.botDraft;
        if (draft === null) return;
        confirmAction(
          'Изменить имя бота?',
          `Имя «${draft}» увидят участницы всех марафонов — оно общее. Telegram ограничивает частоту смены имени: после сохранения следующее изменение будет доступно не сразу.`,
          'Изменить имя',
          false,
          () => {
            set({ confirm: null });
            void (async () => {
              if (await call(() => api.setBotName(draft))) {
                set((s) => ({ bot: { ...s.bot, name: draft }, botDraft: null }));
                toast('Имя бота обновлено через Bot API');
              }
            })();
          },
        );
      },

      setRole: (id, role) => {
        const u = state.users.find((x) => x.id === id);
        if (!u || u.role === role) return;
        void (async () => {
          try {
            await api.setUserRole(id, role);
            await reloadGlobal();
            toast(role === 'admin' ? `${u.name} теперь админ — видит и «Пользователей»` : `${u.name} теперь куратор — всё, кроме «Пользователей»`);
          } catch (err) {
            toast(errorText(err));
          }
        })();
      },

      removeUser: (id) => {
        const u = state.users.find((x) => x.id === id);
        if (!u) return;
        confirmAction(
          `Отключить доступ: ${u.name}?`,
          'Она больше не сможет войти в панель. Её действия останутся в журнале изменений. Вернуть доступ можно, добавив её снова.',
          'Отключить',
          true,
          () => {
            set({ confirm: null });
            void (async () => {
              try {
                await api.disableUser(id);
                await reloadGlobal();
                toast(`Доступ ${u.name} отключён`);
              } catch (err) {
                toast(errorText(err));
              }
            })();
          },
        );
      },

      inviteUser: () => {
        const iv = state.invite;
        if (!iv) return;
        const name = iv.name.trim();
        let tg = iv.tg.trim();
        const bad = (err: string) => set({ invite: { ...iv, err } });

        if (!name) return bad('Укажите имя');
        if (!/^@?[A-Za-z0-9_]{5,32}$/.test(tg)) return bad('Telegram username: 5–32 символа — латиница, цифры и _');
        if (tg[0] !== '@') tg = '@' + tg;
        if (state.users.some((u) => u.tg.toLowerCase() === tg.toLowerCase())) return bad(tg + ' уже есть в списке');

        void (async () => {
          try {
            await api.addUser({ name, tgUsername: tg.slice(1), role: iv.role });
            await reloadGlobal();
            set({ invite: null });
            toast(`${name} добавлена. Пусть войдёт в панель через Telegram — доступ откроется сразу.`);
          } catch (err) {
            bad(errorText(err));
          }
        })();
      },
    };
  }, [state, set, toast, bootstrap, reloadGlobal, reloadMarathon, undoEdit]);

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}
