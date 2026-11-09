import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GLOBAL, NAMAZ, TODAY_LABEL } from '../data/constants';
import { seed } from '../data/seed';
import { currentData, currentMarathon, filteredParts, meId, meName, segments } from '../lib/derive';
import { plural, uid } from '../lib/format';
import { tzLabel } from '../lib/time';
import type { AppState, Marathon, MarathonData, QuestionType } from '../types';
import { ActionsCtx, StateCtx, type Actions, type Patch, type Updater } from './context';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const emptyData = (): MarathonData => ({ topics: [], namaz: [], participants: [], trend: [], ledger: {}, broadcasts: [] });



export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(seed);
  const toastTimer = useRef<number | undefined>(undefined);
  const sendTimer = useRef<number | undefined>(undefined);

  const set = useCallback((patch: Patch | Updater) => {
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  }, []);

  const toast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setState((s) => ({ ...s, toast: msg }));
    toastTimer.current = window.setTimeout(() => setState((s) => ({ ...s, toast: null })), 3600);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearInterval(sendTimer.current);
    },
    [],
  );

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

    const go: Actions['go'] = (screen, extra) => set({ screen, navOpen: false, ...extra });

    const confirmAction = (title: string, body: string, ok: string, danger: boolean, onOk: () => void) =>
      set({ confirm: { title, body, ok, danger, onOk } });

    const logAudit = (s: AppState, what: string) => [{ at: '8 ноя 09:40', who: meName(s), what }, ...s.audit];

    return {
      set,
      go,
      toast,
      setRoleView: (role) => set(role === 'curator' ? { role, drawerId: null, invite: null } : { role }),

      switchM: (id) =>
        set((s) => ({
          mid: id,
          topicId: null,
          qId: null,
          drawerId: null,
          pf: { ...s.pf, sel: [] },
          // С общих экранов переключение марафона не уводит.
          screen: GLOBAL.includes(s.screen) ? s.screen : 'overview',
        })),

      duplicate: (id) => {
        const src = state.marathons.find((m) => m.id === id);
        const dd = state.data[id];
        if (!src || !dd) return;
        mut((d, _s, ms) => {
          const n = 'm' + (ms.length + 4);
          ms.push({ ...src, id: n, code: n, name: 'Копия: ' + src.name, status: 'draft', start: '2026-12-01', end: '2026-12-30', regOpen: false, reported: undefined });
          d[n] = { topics: clone(d[id].topics), namaz: [...(d[id].namaz ?? [])], participants: [], trend: [], ledger: {}, broadcasts: [] };
        });
        const nz = (dd.namaz ?? []).length;
        toast(
          `Создан черновик «Копия: ${src.name}» — ${nz} ${plural(nz, 'намаз', 'намаза', 'намазов')} и ${dd.topics.length} ${plural(dd.topics.length, 'своя тема', 'свои темы', 'своих тем')}, без участниц`,
        );
      },

      createM: () => {
        const nm = state.newM;
        if (!nm) return;
        if (!nm.name.trim()) {
          set({ newM: { ...nm, err: 'Название обязательно' } });
          return;
        }
        mut((d, _s, ms) => {
          const n = 'm' + (ms.length + 4);
          ms.push({
            id: n, code: n, name: nm.name.trim(), status: 'draft',
            start: nm.start || '2026-12-01', end: nm.end || '2026-12-30',
            lang: 'kg', regOpen: false, pointsDefault: 10, streakBonus: 5, streakEvery: 7,
            latePasses: 2, excused: 3, pauseAllowed: true, remindMorning: '05:30', remindEvening: '21:00', skipSubmitted: true,
          });
          d[n] = emptyData();
          return { newM: null };
        });
        toast('Черновик создан. На странице «Темы» отметьте нужные намазы и добавьте свои темы.');
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
          () =>
            mut((d, s, ms) => {
              const i = ms.findIndex((x) => x.id === id);
              ms.splice(i, 1);
              delete d[id];
              return { confirm: null, mid: s.mid === id ? ms[0]?.id ?? null : s.mid };
            }),
        );
      },

      copyLink: (id) => {
        const m = state.marathons.find((x) => x.id === id);
        if (!m) return;
        const link = `https://t.me/${state.bot.username}?start=${m.code}`;
        void navigator.clipboard?.writeText(link).catch(() => {});
        toast(m.status === 'draft' ? `Скопировано: ${link} — заработает после запуска марафона` : `Скопировано: ${link}`);
      },

      setM: (k, v) =>
        mut((_d, s, ms) => {
          const m = ms.find((x) => x.id === s.mid);
          if (m) (m[k] as Marathon[typeof k]) = v;
        }),

      launch: () => {
        mut((_d, s, ms) => {
          const m = ms.find((x) => x.id === s.mid);
          if (m) m.status = 'recruiting';
        });
        toast('Марафон открыт для набора. Deep link активен.');
      },

      setT: (k, v) =>
        mut((d, s) => {
          const t = s.mid ? d[s.mid].topics.find((x) => x.id === s.topicId) : undefined;
          if (t) (t as unknown as Record<string, unknown>)[k] = v;
        }),

      toggleTopic: (id) => {
        const ns = NAMAZ.find((x) => x.id === id);
        const own = currentData(state).topics.find((x) => x.id === id);
        if (!ns && !own) return;

        const m = currentMarathon(state);
        const n = currentData(state).participants.filter((p) => p.status === 'active').length;
        const on = ns ? (currentData(state).namaz ?? []).includes(id) : own!.active;
        const name = (ns ?? own)!.nameKg || 'без названия';

        const apply = (d: Record<string, MarathonData>, s: AppState) => {
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
                apply(d, s);
                return { confirm: null };
              });
              toast(`«${name}» выключена. Записано в журнал.`);
            },
          );
        } else {
          mut((d, s) => apply(d, s));
        }
      },

      moveTopic: (id, dir) =>
        mut((d, s) => {
          if (!s.mid) return;
          const a = d[s.mid].topics;
          const i = a.findIndex((t) => t.id === id);
          const j = i + dir;
          if (j < 0 || j >= a.length) return;
          [a[i], a[j]] = [a[j], a[i]];
        }),

      addTopic: () => {
        const id = uid();
        const pts = currentMarathon(state)?.pointsDefault ?? 5;
        mut((d, s) => {
          if (!s.mid) return;
          d[s.mid].topics.push({
            id, emoji: '🕊', nameKg: '', nameRu: '', active: true, mode: 'fixed',
            start: '05:00', end: '22:00', points: pts, freq: 'daily', mandatory: false, remind: 0, questions: [],
          });
          return { screen: 'topicEditor', topicId: id, topicTab: 'settings' };
        });
      },

      deleteTopic: (id) => {
        const t = currentData(state).topics.find((x) => x.id === id);
        if (!t) return;
        confirmAction(
          `Удалить тему «${t.nameKg || 'без названия'}»?`,
          'Удалятся вопросы и варианты ответов. Уже принятые отчёты и баллы по теме сохранятся в истории участниц.',
          'Удалить тему',
          true,
          () =>
            mut((d, s) => {
              if (!s.mid) return;
              d[s.mid].topics = d[s.mid].topics.filter((x) => x.id !== id);
              return { confirm: null, screen: 'topics', topicId: null };
            }),
        );
      },

      setQ: (k, v) =>
        mut((d, s) => {
          if (!s.mid) return;
          const q = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions.find((x) => x.id === s.qId);
          if (!q) return;
          (q as unknown as Record<string, unknown>)[k] = v;

          // Смена типа переписывает варианты: у шкалы и да/нет надписи заданы типом.
          if (k === 'type') {
            const type = v as QuestionType;
            if (type === 'scale') {
              q.options = [1, 2, 3, 4, 5].map((n) => ({ id: 'o' + n, kg: String(n), ru: String(n), pts: 1, locked: true }));
            } else if (type === 'yesno') {
              q.options = [
                { id: 'oy', kg: 'Ооба', ru: 'Да', pts: 5, locked: true },
                { id: 'on', kg: 'Жок', ru: 'Нет', pts: 0, locked: true },
              ];
            } else if (type !== 'single' && type !== 'multi') {
              q.options = [];
            } else if (q.options.some((o) => o.locked)) {
              q.options = q.options.map((o) => ({ ...o, locked: false }));
            }
          }
        }),

      addQ: () => {
        const id = uid();
        mut((d, s) => {
          if (!s.mid) return;
          d[s.mid].topics
            .find((t) => t.id === s.topicId)
            ?.questions.push({ id, textKg: '', textRu: '', type: 'single', required: true, options: [{ id: uid(), kg: '', ru: '', pts: 0 }] });
          return { screen: 'questionEditor', qId: id };
        });
      },

      delQ: (id, leave) =>
        mut((d, s) => {
          if (!s.mid) return;
          const t = d[s.mid].topics.find((x) => x.id === s.topicId);
          if (t) t.questions = t.questions.filter((q) => q.id !== id);
          return leave ? { screen: 'topicEditor', topicTab: 'questions', qId: null } : {};
        }),

      moveQ: (id, dir) =>
        mut((d, s) => {
          if (!s.mid) return;
          const a = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions;
          if (!a) return;
          const i = a.findIndex((q) => q.id === id);
          const j = i + dir;
          if (j < 0 || j >= a.length) return;
          [a[i], a[j]] = [a[j], a[i]];
        }),

      setO: (oid, k, v) =>
        mut((d, s) => {
          if (!s.mid) return;
          const o = d[s.mid].topics
            .find((t) => t.id === s.topicId)
            ?.questions.find((q) => q.id === s.qId)
            ?.options.find((x) => x.id === oid);
          if (o) (o as unknown as Record<string, unknown>)[k] = v;
        }),

      addO: () =>
        mut((d, s) => {
          if (!s.mid) return;
          d[s.mid].topics
            .find((t) => t.id === s.topicId)
            ?.questions.find((q) => q.id === s.qId)
            ?.options.push({ id: uid(), kg: '', ru: '', pts: 0 });
        }),

      delO: (oid) =>
        mut((d, s) => {
          if (!s.mid) return;
          const q = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions.find((x) => x.id === s.qId);
          if (q) q.options = q.options.filter((o) => o.id !== oid);
        }),

      moveO: (oid, dir) =>
        mut((d, s) => {
          if (!s.mid) return;
          const a = d[s.mid].topics.find((t) => t.id === s.topicId)?.questions.find((q) => q.id === s.qId)?.options;
          if (!a) return;
          const i = a.findIndex((o) => o.id === oid);
          const j = i + dir;
          if (j < 0 || j >= a.length) return;
          [a[i], a[j]] = [a[j], a[i]];
        }),

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
        if (action === 'pause') {
          mut((d, s) => {
            if (!s.mid) return;
            d[s.mid].participants.forEach((p) => {
              if (s.pf.sel.includes(p.id)) p.status = 'paused';
            });
            return { pf: { ...s.pf, sel: [] } };
          });
          toast(`Пауза включена у ${n} ${plural(n, 'участницы', 'участниц', 'участниц')}`);
        }
        if (action === 'message') {
          set((s) => ({ screen: 'broadcasts', bc: { ...s.bc, seg: 'selected', selIds: [...s.pf.sel], stage: 'compose' } }));
        }
      },

      setP: (id, k, v) =>
        mut((d, s) => {
          if (!s.mid) return;
          const p = d[s.mid].participants.find((x) => x.id === id);
          if (p) (p as unknown as Record<string, unknown>)[k] = v;
        }),

      adjustPoints: () => {
        const pm = state.pointsModal;
        if (!pm) return;
        const n = Number(pm.delta);
        if (!n) {
          set({ pointsModal: { ...pm, err: 'Укажите число, отличное от нуля' } });
          return;
        }
        if (!pm.reason.trim()) {
          set({ pointsModal: { ...pm, err: 'Причина обязательна — она видна участнице и попадает в журнал' } });
          return;
        }
        mut((d, s) => {
          if (!s.mid) return;
          const p = d[s.mid].participants.find((x) => x.id === pm.pid);
          if (p) p.points += n;
          const L = d[s.mid].ledger;
          (L[pm.pid] = L[pm.pid] ?? []).unshift({ d: TODAY_LABEL, delta: n, reason: pm.reason.trim() });
          return { pointsModal: null };
        });
        toast(`${n > 0 ? '+' : ''}${n} баллов начислено. Участница получит уведомление с причиной.`);
      },

      removeP: (id) => {
        const p = currentData(state).participants.find((x) => x.id === id);
        if (!p) return;
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
            toast(`${p.name} исключена из марафона`);
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
        a.download = 'uchastnitsy-' + state.mid + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`CSV: ${rows.length - 1} строк`);
      },

      setBc: (k, v) => set((s) => ({ bc: { ...s.bc, [k]: v } })),

      /**
       * Отправка идёт видимо долго: Telegram пропускает ~30 сообщений в секунду,
       * поэтому мгновенного «Отправлено» здесь быть не может.
       */
      send: () => {
        const segs = segments(state);
        const seg = segs.find((x) => x.id === state.bc.seg) ?? segs[0];
        if (!seg) return;
        const n = seg.list.length;
        set((s) => ({ bc: { ...s.bc, stage: 'sending', sent: 0, total: n } }));

        window.clearInterval(sendTimer.current);
        sendTimer.current = window.setInterval(() => {
          setState((s) => {
            const sent = Math.min(n, s.bc.sent + Math.max(1, Math.ceil(n / 8)));
            if (sent < n) return { ...s, bc: { ...s.bc, sent } };

            window.clearInterval(sendTimer.current);
            const blockedList = seg.list.filter((p) => p.blocked);
            const result = {
              count: n,
              delivered: n - blockedList.length,
              blocked: blockedList.length,
              blockedNames: blockedList.map((p) => p.name).join(', '),
            };
            const d = clone(s.data);
            if (s.mid) {
              d[s.mid].broadcasts.unshift({
                id: uid(), at: 'сейчас', text: s.bc.text, seg: seg.name,
                count: n, delivered: result.delivered, blocked: result.blocked,
              });
            }
            return { ...s, data: d, bc: { ...s.bc, stage: 'done', sent: n, result } };
          });
        }, 450);
      },

      saveBotName: () => {
        const draft = state.botDraft;
        if (draft === null) return;
        confirmAction(
          'Изменить имя бота?',
          `Имя «${draft}» увидят участницы всех марафонов — оно общее. Telegram ограничивает частоту смены имени: после сохранения следующее изменение будет доступно не сразу.`,
          'Изменить имя',
          false,
          () => {
            set((s) => ({ bot: { ...s.bot, name: draft }, botDraft: null, confirm: null }));
            toast('Имя бота обновлено через Bot API');
          },
        );
      },

      setRole: (id, role) => {
        const u = state.users.find((x) => x.id === id);
        if (!u || u.role === role) return;
        const admins = state.users.filter((x) => x.role === 'admin').length;
        if (id === meId(state)) {
          toast('Свою роль поменять нельзя — попросите другого админа');
          return;
        }
        if (u.role === 'admin' && admins <= 1) {
          toast('В панели должен остаться хотя бы один админ');
          return;
        }
        set((s) => ({
          users: s.users.map((x) => (x.id === id ? { ...x, role } : x)),
          audit: logAudit(s, `Изменила роль: ${u.name} — теперь ${role === 'admin' ? 'админ' : 'куратор'}`),
        }));
        toast(role === 'admin' ? `${u.name} теперь админ — видит и «Пользователей»` : `${u.name} теперь куратор — всё, кроме «Пользователей»`);
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
            set((s) => ({ users: s.users.filter((x) => x.id !== id), confirm: null, audit: logAudit(s, `Отключила доступ: ${u.name}`) }));
            toast(`Доступ ${u.name} отключён`);
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

        set((s) => ({
          users: [...s.users, { id: uid(), name, tg, role: iv.role, last: '', invited: true }],
          invite: null,
          audit: logAudit(s, `Добавила ${name} (${tg}) как ${iv.role === 'admin' ? 'админа' : 'куратора'}`),
        }));
        toast(`${name} добавлена. Пусть войдёт в панель через Telegram — доступ откроется сразу.`);
      },
    };
  }, [state, set, toast]);

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}
