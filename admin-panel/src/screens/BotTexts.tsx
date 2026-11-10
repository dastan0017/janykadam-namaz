import { Field, Pager } from '../components/ui';
import { usePaged } from '../lib/paged';
import { useActions, useAppState } from '../store/context';

const COLS = '150px minmax(0,1fr) minmax(0,1fr)';

/**
 * Тексты бота общие для всех марафонов. Нажатие на строку открывает её правку
 * и меняет превью справа. Ключи задаются кодом бота — их не добавляют и не
 * переименовывают: без своего ключа текст боту неоткуда взять.
 */
export function BotTexts() {
  const s = useAppState();
  const { set, setText, leaveForm } = useActions();
  const q = s.textQ.trim().toLowerCase();
  const untranslated = s.texts.filter((t) => !t.kg || !t.ru).length;

  const found = s.texts.filter(
    (t) =>
      (!q || t.key.includes(q) || t.ru.toLowerCase().includes(q) || t.kg.toLowerCase().includes(q)) && (!s.textUntr || !t.kg || !t.ru),
  );
  const { rows, pager } = usePaged(found, `${q}|${String(s.textUntr)}`);

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
        <span className="hint">Нажмите строку — откроется правка, справа превью.</span>
      </div>

      <div className="card-scroll">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, minWidth: 640 }}>
          <span>Ключ</span>
          <span>Русский</span>
          <span>Кыргызча</span>
        </div>
        {rows.map((t) => {
          const untr = !t.kg || !t.ru;
          const open = t.key === s.textKey;
          return (
            <div key={t.key}>
              <button
                type="button"
                // Переключение строки — уход с формы: несохранённое не теряем молча.
                onClick={() => leaveForm(() => set({ textKey: open ? '' : t.key }))}
                aria-expanded={open}
                style={{
                  display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 12px',
                  borderTop: '1px solid var(--line-soft)', border: 0, borderTopWidth: 1, borderTopStyle: 'solid',
                  background: open ? 'var(--accent-row)' : untr ? 'var(--warn-soft)' : 'transparent',
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

              {open ? (
                <div style={{ padding: '12px', background: 'var(--bg)', borderTop: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                    <Field label="Русский" counter={`${t.ru.length} / 4096`}>
                      <textarea
                        rows={4}
                        className="textarea"
                        value={t.ru}
                        onChange={(e) => setText(t.key, 'ru', e.target.value)}
                        placeholder="Текст, который получит участница"
                      />
                    </Field>
                    <Field label="Кыргызча" counter={`${t.kg.length} / 4096`}>
                      <textarea
                        rows={4}
                        className="textarea"
                        value={t.kg}
                        onChange={(e) => setText(t.key, 'kg', e.target.value)}
                        placeholder="Котормо"
                      />
                    </Field>
                  </div>

                  <div className="hint-sm">
                    {t.ph ? (
                      <>
                        Подстановки: <span className="mono">{t.ph}</span> — бот заменит их значениями. Пишите их как есть, в обоих языках.
                      </>
                    ) : (
                      'Подстановок в этом тексте нет.'
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Pager {...pager} />
    </>
  );
}
