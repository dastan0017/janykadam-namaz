import { TZ, TZ_ORDER } from '../data/constants';
import { NEVER_REPORTED } from '../api/map';
import { activeTopics, currentData, doneToday } from '../lib/derive';
import { useActions, useAppState } from '../store/context';

export function Analytics() {
  const s = useAppState();
  const { set, exportCsv } = useActions();
  const all = currentData(s).participants;
  const act = all.filter((p) => p.status === 'active');

  const byTopic = activeTopics(s).map((t) => {
    const n = act.filter((p) => p.today.includes(t.id)).length;
    return { id: t.id, name: t.emoji + ' ' + t.nameKg, pct: act.length ? Math.round((n / act.length) * 100) : 0 };
  });

  const byTz = TZ_ORDER.map((k) => {
    const tp = act.filter((p) => p.tz === k);
    const n = tp.filter((p) => doneToday(s, p)).length;
    return { id: k, name: TZ[k].city, total: tp.length, n, pct: tp.length ? (n / tp.length) * 100 : 0 };
  }).filter((x) => x.total > 0);

  const funnel = [
    { id: 'f1', label: 'Зарегистрировались', n: all.length },
    // «Сдала хоть раз» — это и есть первый отчёт: у не сдававших last = NEVER_REPORTED.
    { id: 'f2', label: 'Сдали первый отчёт', n: all.filter((p) => p.last < NEVER_REPORTED).length },
    { id: 'f3', label: 'Сдали день 7', n: all.filter((p) => p.d7).length },
    { id: 'f4', label: 'Активны сегодня', n: act.filter((p) => doneToday(s, p)).length },
  ];

  const dropoff = all.filter((p) => p.status === 'active' && p.last >= 3);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignItems: 'start' }}>
      <section className="card">
        <div className="h-card" style={{ marginBottom: 10 }}>
          Сдача по темам сегодня
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {byTopic.map((t) => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 40px', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <span className="ellipsis">{t.name}</span>
              <span className="bar-track bar-track-pill">
                <span className="bar-fill" style={{ width: t.pct + '%' }} />
              </span>
              <span style={{ textAlign: 'right' }}>{t.pct}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="h-card" style={{ marginBottom: 2 }}>
          По часовым поясам
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>
          Сдали сегодня из активных — каждая по своему местному времени.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {byTz.map((t) => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <span>{t.name}</span>
              <span className="bar-track bar-track-pill">
                <span className="bar-fill" style={{ width: t.pct + '%', background: 'var(--accent)' }} />
              </span>
              <span style={{ textAlign: 'right' }}>
                {t.n} из {t.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="h-card" style={{ marginBottom: 10 }}>
          Воронка
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {funnel.map((f) => (
            <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 30px', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <span>{f.label}</span>
              <span className="bar-track" style={{ height: 22, borderRadius: 6 }}>
                <span className="bar-fill" style={{ width: (all.length ? (f.n / all.length) * 100 : 0) + '%', background: 'var(--sage-bar)' }} />
              </span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{f.n}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="h-card">Отток — молчат 3+ дня</div>
          <button type="button" className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={exportCsv}>
            Экспорт
          </button>
        </div>
        {dropoff.length === 0 ? (
          <div className="sub">Все активные участницы отчитывались за последние 3 дня.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {dropoff.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn-plain"
                style={{ borderTop: '1px solid var(--line-soft)', padding: '7px 0', display: 'grid', gridTemplateColumns: '1fr 90px 60px', gap: 8, fontSize: 12.5 }}
                onClick={() => set({ screen: 'participants', drawerId: p.id })}
              >
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: 'var(--muted)' }}>{p.place || TZ[p.tz]?.city || '—'}</span>
                <span style={{ color: 'var(--danger)', fontWeight: 600, textAlign: 'right' }}>
                  {p.last >= NEVER_REPORTED ? 'ни разу' : `${p.last} дн.`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
