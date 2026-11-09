import { currentData } from '../lib/derive';
import { useActions, useAppState } from '../store/context';

/** Начисление и снятие баллов требует причину: её видит участница и она попадает в журнал. */
export function PointsModal() {
  const s = useAppState();
  const { set, adjustPoints } = useActions();
  const pm = s.pointsModal;
  if (!pm) return null;
  const p = currentData(s).participants.find((x) => x.id === pm.pid);
  if (!p) return null;

  return (
    <div className="scrim scrim-center" style={{ zIndex: 50 }}>
      <section className="dialog" style={{ width: 'min(420px, 100%)', gap: 12 }} role="dialog" aria-modal="true" aria-label={`Изменить баллы — ${p.name}`}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Изменить баллы — {p.name}</div>

        <label className="label">
          <span className="label-text">Сколько (минус — снять)</span>
          <input type="number" className="input" value={pm.delta} onChange={(e) => set({ pointsModal: { ...pm, delta: e.target.value, err: '' } })} placeholder="+10 или −5" />
        </label>

        <label className="label">
          <span className="label-text">Причина — обязательно, увидит участница</span>
          <input
            type="text"
            className="input"
            value={pm.reason}
            onChange={(e) => set({ pointsModal: { ...pm, reason: e.target.value, err: '' } })}
            placeholder="например: сбой бота 7 ноя, отчёт был"
          />
        </label>

        {pm.err ? (
          <div className="err-text" style={{ fontSize: 12.5 }}>
            {pm.err}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => set({ pointsModal: null })}>
            Отмена
          </button>
          <button type="button" className="btn" onClick={adjustPoints}>
            Начислить
          </button>
        </div>
      </section>
    </div>
  );
}
