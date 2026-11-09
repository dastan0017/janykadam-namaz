import { Field, MoveButtons } from '../components/ui';
import { QTYPE } from '../data/constants';
import { currentMarathon, currentQuestion, currentTopic } from '../lib/derive';
import { useActions, useAppState } from '../store/context';
import type { QuestionType } from '../types';

const OPT_COLS = '24px minmax(0,1fr) minmax(0,1fr) 72px 88px';

export function QuestionEditor() {
  const s = useAppState();
  const { go, setQ, setO, addO, delO, moveO, delQ } = useActions();
  const t = currentTopic(s);
  const q = currentQuestion(s);
  const m = currentMarathon(s);
  if (!t || !q || !m) return <div className="empty">Вопрос не выбран.</div>;

  const isChoice = q.type === 'single' || q.type === 'multi';
  const isLocked = q.type === 'scale' || q.type === 'yesno';
  const noOptions = q.type === 'text' || q.type === 'number';
  // callback_data должен уложиться в 64 байта — поэтому кнопка несёт только короткие id
  const cb = `${m.code}:${t.id}:${q.id}:o1`;

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button type="button" className="btn-secondary btn-sm" onClick={() => go('topicEditor', { topicTab: 'questions' })}>
          ← К вопросам темы
        </button>
        <div className="grow" />
        <button type="button" className="btn-danger-outline" onClick={() => delQ(q.id, true)}>
          Удалить вопрос
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label-text" style={{ marginBottom: 0 }}>
            Тип ответа
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(Object.keys(QTYPE) as QuestionType[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={q.type === k}
                onClick={() => setQ('type', k)}
                style={{
                  border: '1px solid ' + (q.type === k ? 'var(--accent)' : 'var(--line)'),
                  borderRadius: 'var(--r-pill)',
                  padding: '6px 12px',
                  background: q.type === k ? 'var(--accent-soft)' : 'var(--card)',
                  color: q.type === k ? 'var(--accent-text)' : 'var(--ink)',
                  fontWeight: 600,
                  fontSize: 12.5,
                }}
              >
                {QTYPE[k]}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            <Field label="Вопрос, кыргызча" counter={`${q.textKg.length} / 4096`}>
              <textarea rows={3} className="textarea" value={q.textKg} onChange={(e) => setQ('textKg', e.target.value)} placeholder="Канча бет окудуңуз?" />
            </Field>
            <Field label="Вопрос, по-русски" counter={`${q.textRu.length} / 4096`}>
              <textarea rows={3} className="textarea" value={q.textRu} onChange={(e) => setQ('textRu', e.target.value)} placeholder="Сколько страниц прочитали?" />
            </Field>
          </div>

          <label className="check-label">
            <input type="checkbox" className="check" checked={q.required} onChange={(e) => setQ('required', e.target.checked)} /> Обязательный — без ответа отчёт не засчитывается
          </label>
        </section>

        {q.options.length ? (
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div className="h-card">Варианты ответа — {q.options.length}</div>
                <div className="hint">Разные ответы могут стоить по-разному. Надпись кнопки — до 64 символов.</div>
              </div>
              {isLocked ? <span className="hint">Надписи заданы типом, меняются только баллы</span> : null}
            </div>

            {q.options.length > 8 ? (
              <div className="banner-warn">Больше восьми кнопок — на телефоне клавиатура не помещается, участница листает. Посмотрите превью справа.</div>
            ) : null}

            <div className="thead" style={{ display: 'grid', gridTemplateColumns: OPT_COLS, gap: 8, padding: 0 }}>
              <span />
              <span>Кыргызча</span>
              <span>По-русски</span>
              <span>Баллы</span>
              <span />
            </div>

            {q.options.map((o, i) => (
              <div
                key={o.id}
                style={{
                  display: 'grid', gridTemplateColumns: OPT_COLS, gap: 8, alignItems: 'center', padding: '6px 0',
                  borderTop: i ? '1px solid var(--line-soft)' : 0,
                  // За восьмым вариантом фон предупреждает, не дожидаясь, пока прочтут текст
                  background: i >= 8 ? 'var(--warn-soft)' : 'transparent',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{i + 1}</span>
                <span>
                  <input type="text" className="input" value={o.kg} onChange={(e) => setO(o.id, 'kg', e.target.value)} disabled={o.locked} maxLength={80} placeholder="1 бет" />
                  <span className="mono" style={{ fontSize: 10.5, color: o.kg.length > 64 ? 'var(--danger)' : 'var(--muted)' }}>
                    {o.kg.length}/64
                  </span>
                </span>
                <input
                  type="text"
                  className="input"
                  style={{ alignSelf: 'start' }}
                  value={o.ru}
                  onChange={(e) => setO(o.id, 'ru', e.target.value)}
                  disabled={o.locked}
                  maxLength={80}
                  placeholder="1 страница"
                  aria-label={`Вариант ${i + 1}, по-русски`}
                />
                <input
                  type="number"
                  className="input"
                  style={{ alignSelf: 'start', padding: '6px 8px' }}
                  value={o.pts}
                  onChange={(e) => setO(o.id, 'pts', Number(e.target.value))}
                  aria-label={`Баллы за вариант ${i + 1}`}
                />
                <MoveButtons
                  size="tall"
                  onUp={() => moveO(o.id, -1)}
                  onDown={() => moveO(o.id, 1)}
                  isFirst={i === 0}
                  isLast={i === q.options.length - 1}
                  extra={
                    <button
                      type="button"
                      className="btn-arrow"
                      style={{ width: 28, height: 30, color: 'var(--danger)' }}
                      onClick={() => delO(o.id)}
                      disabled={o.locked}
                      aria-label={`Удалить вариант ${i + 1}`}
                    >
                      ✕
                    </button>
                  }
                />
              </div>
            ))}

            {isChoice ? (
              <div>
                <button type="button" className="btn-secondary btn-sm" onClick={addO}>
                  Добавить вариант
                </button>
              </div>
            ) : null}

            <div className="hint-sm" style={{ marginTop: 4 }}>
              Кнопка передаёт боту только короткий id — <span className="mono">{cb}</span> ({cb.length} байт из 64 допустимых). Текст, баллы и логика хранятся на сервере, поэтому варианты
              нельзя нагрузить произвольными данными.
            </div>
          </section>
        ) : null}

        {noOptions ? (
          <section className="card sub">
            Для этого типа кнопок нет — после видеокружка бот ждёт ответ сообщением и проверяет формат. Баллы начисляются по теме, не по ответу.
          </section>
        ) : null}
      </div>
    </>
  );
}
