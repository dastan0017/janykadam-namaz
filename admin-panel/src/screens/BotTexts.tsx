import { useActions, useAppState } from '../store/context';

/** Тексты бота общие для всех марафонов. Нажатие на строку меняет превью справа. */
export function BotTexts() {
  const s = useAppState();
  const { set } = useActions();
  const q = s.textQ.trim().toLowerCase();
  const untranslated = s.texts.filter((t) => !t.kg || !t.ru).length;

  const rows = s.texts.filter(
    (t) =>
      (!q || t.key.includes(q) || t.ru.toLowerCase().includes(q) || t.kg.toLowerCase().includes(q)) && (!s.textUntr || !t.kg || !t.ru),
  );

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          type="search"
          className="input input-pill"
          style={{ width: 260, maxWidth: '100%' }}
          value={s.textQ}
          onChange={(e) => set({ textQ: e.target.value })}
          aria-label="Поиск текстов"
          placeholder="Ключ или фрагмент текста"
        />
        <label className="check-label" style={{ fontSize: 12.5 }}>
          <input type="checkbox" className="check" checked={s.textUntr} onChange={(e) => set({ textUntr: e.target.checked })} /> Только без перевода ({untranslated})
        </label>
        <div className="grow" />
        <span className="hint">Общие для всех марафонов. Нажмите строку — превью справа.</span>
      </div>

      <div className="card-scroll">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) minmax(0,1fr)', gap: 12, minWidth: 640 }}>
          <span>Ключ</span>
          <span>Русский</span>
          <span>Кыргызча</span>
        </div>
        {rows.map((t) => {
          const untr = !t.kg || !t.ru;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => set({ textKey: t.key })}
              aria-pressed={t.key === s.textKey}
              style={{
                display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) minmax(0,1fr)', gap: 12, padding: '10px 12px',
                borderTop: '1px solid var(--line-soft)', border: 0, borderTopWidth: 1, borderTopStyle: 'solid',
                background: t.key === s.textKey ? 'var(--accent-row)' : untr ? 'var(--warn-soft)' : 'transparent',
                textAlign: 'left', width: '100%', fontSize: 13, color: 'var(--ink)',
              }}
            >
              <span>
                <span className="mono" style={{ fontSize: 12, display: 'block' }}>
                  {t.key}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.ph || '—'}</span>
              </span>
              <span style={{ lineHeight: 1.45 }}>{t.ru || '— нет —'}</span>
              <span style={{ lineHeight: 1.45 }}>{t.kg || '— нет перевода —'}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
