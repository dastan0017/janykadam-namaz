import { Pager } from '../components/ui';
import { usePaged } from '../lib/paged';
import { useAppState } from '../store/context';

export function Journal() {
  const s = useAppState();
  const { rows, pager } = usePaged(s.audit, 'journal');

  return (
    <div style={{ maxWidth: 820 }}>
      <section className="card-flush">
        <div className="sub" style={{ padding: '12px 14px' }}>
          Кто, когда и что изменил — во всех марафонах и в боте. Хранится 12 месяцев.
        </div>
        {rows.map((a, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5 }}>
            <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{a.at}</span>
            <span>
              <b>{a.who}</b> — {a.what}
            </span>
          </div>
        ))}
      </section>

      <Pager {...pager} />
    </div>
  );
}
