import { NAMAZ, TODAY_LABEL } from '../data/constants';
import { currentData } from '../lib/derive';
import { plural } from '../lib/format';
import { fmt, localNow, nsTopic, openNow, tzLabel, winStr } from '../lib/time';
import { useActions, useAppState } from '../store/context';
import { ParticipantPill } from './ui';

/** Профиль, намазы по её времени, 7 дней точками, журнал баллов с причинами и действия. */
export function ParticipantDrawer() {
  const s = useAppState();
  const { set, setP, toast, removeP } = useActions();
  const d = currentData(s);
  const p = d.participants.find((x) => x.id === s.drawerId);
  if (!p) return null;

  const close = () => set({ drawerId: null });

  // Каза намаз привязан к фиксированному окну, в плитках «сегодня» он не нужен
  const namazTiles = NAMAZ.filter((n) => (d.namaz ?? []).includes(n.id) && n.s[0] !== 'fixed').map((n) => {
    const t = nsTopic(n);
    return { id: n.id, name: n.emoji + ' ' + n.nameKg, win: winStr(t, p.tz), open: openNow(t, p.tz) };
  });

  const timeline = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const done =
      i === 0
        ? p.today.length
        : p.joined === TODAY_LABEL
          ? 0
          : p.status === 'active' && i >= p.last && !(i % 5 === 3 && p.streak < 10)
            ? 5 + (i % 3)
            : 0;
    return {
      id: i,
      day: i === 0 ? 'Сегодня' : i === 1 ? 'Вчера' : 8 - i + ' ноя',
      n: done ? `${done} ${plural(done, 'отчёт', 'отчёта', 'отчётов')}` : p.joined === TODAY_LABEL && i > 0 ? 'ещё не участвовала' : 'нет отчётов',
      done: done > 0,
    };
  });

  const ledger = d.ledger[p.id] ?? [
    { d: '7 ноя', delta: 10, reason: 'Куптан — отчёт принят' },
    { d: '7 ноя', delta: 10, reason: 'Багымдат — отчёт принят' },
  ];

  const togglePause = () => {
    setP(p.id, 'status', p.status === 'paused' ? 'active' : 'paused');
    toast(p.status === 'paused' ? 'Пауза снята' : 'Пауза включена — напоминания не приходят, баллы не снимаются');
  };

  return (
    <div className="scrim">
      <button type="button" className="scrim-close" aria-label="Закрыть" onClick={close} />
      <section className="drawer" role="dialog" aria-modal="true" aria-label={p.name}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{p.name}</div>
            <div className="sub">
              {p.user} · {tzLabel(p.tz)} · язык: {p.lang === 'kg' ? 'кыргызский' : 'русский'} · с {p.joined}
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={close}>
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <div className="tile">
            <div className="tile-label">Баллы</div>
            <div className="tile-value">{p.points}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Дней подряд</div>
            <div className="tile-value">{p.streak}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Статус</div>
            <div style={{ marginTop: 4 }}>
              <ParticipantPill status={p.status} />
            </div>
          </div>
        </div>

        {p.blocked ? (
          <div className="banner-error">Заблокировала бота — сообщения и напоминания не доходят. Статус обновится, когда она снова напишет боту.</div>
        ) : null}

        {/* Действия рядом с данными; удаление и исключение — только через диалог */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => set((prev) => ({ screen: 'broadcasts', drawerId: null, bc: { ...prev.bc, seg: 'selected', selIds: [p.id], stage: 'compose' } }))}>
            Написать
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => set({ pointsModal: { pid: p.id, delta: '', reason: '', err: '' } })}>
            Изменить баллы
          </button>
          {p.status === 'left' ? (
            <span className="sub" style={{ alignSelf: 'center' }}>
              Вышла из марафона — действия недоступны
            </span>
          ) : null}
          {p.status === 'active' ? (
            <button type="button" className="btn-secondary btn-sm" onClick={togglePause}>
              Пауза
            </button>
          ) : null}
          {p.status === 'paused' ? (
            <button type="button" className="btn-secondary btn-sm" onClick={togglePause}>
              Снять паузу
            </button>
          ) : null}
          <button type="button" className="btn-secondary btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger-line)' }} onClick={() => removeP(p.id)}>
            Удалить из марафона
          </button>
        </div>

        {namazTiles.length ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <div className="overline">Намазы сегодня — по её времени</div>
              <span className="sub" style={{ whiteSpace: 'nowrap' }}>
                у неё сейчас {fmt(localNow(p.tz))}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
              {namazTiles.map((z) => (
                <div
                  key={z.id}
                  style={{ background: z.open ? 'var(--sage-soft)' : 'var(--bg)', border: '1px solid ' + (z.open ? 'var(--sage-bar)' : 'transparent'), borderRadius: 'var(--r-sm)', padding: '6px 8px' }}
                >
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{z.name}</div>
                  <div className="nums" style={{ fontSize: 13, fontWeight: 700 }}>
                    {z.win}
                  </div>
                </div>
              ))}
            </div>
            <div className="hint-sm" style={{ marginTop: 6 }}>
              Пояс она выбрала при регистрации; сменить может сама командой /zona.
            </div>
          </div>
        ) : null}

        <div>
          <div className="overline" style={{ marginBottom: 8 }}>
            Последние 7 дней
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {timeline.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 'var(--r-pill)', background: t.done ? 'var(--sage)' : 'var(--line)', flex: 'none' }} />
                <span style={{ width: 70, color: 'var(--muted)' }}>{t.day}</span>
                <span>{t.n}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="overline" style={{ marginBottom: 8 }}>
            Баллы — журнал
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {ledger.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, color: l.delta > 0 ? 'var(--sage-text)' : l.delta < 0 ? 'var(--danger)' : 'var(--muted)', minWidth: 36, textAlign: 'right' }}>
                  {l.delta > 0 ? '+' : ''}
                  {l.delta}
                </span>
                <span style={{ flex: 1 }}>{l.reason}</span>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{l.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
