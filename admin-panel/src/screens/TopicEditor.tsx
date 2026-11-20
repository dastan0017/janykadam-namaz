import { Field, MoveButtons, Switch } from '../components/ui';
import { QTYPE } from '../data/constants';
import { currentTopic } from '../lib/derive';
import { toMin } from '../lib/time';
import { useActions, useAppState } from '../store/context';
import type { Frequency } from '../types';

export function TopicEditor() {
  const s = useAppState();
  const { set, go, setT, toggleTopic, deleteTopic, addQ, delQ, moveQ } = useActions();
  const t = currentTopic(s);
  if (!t) return <div className="empty">Тема не выбрана.</div>;

  const winMin = toMin(t.end) - toMin(t.start);
  const winLen = winMin > 0 ? (winMin % 60 ? `${Math.floor(winMin / 60)} ч ${winMin % 60} мин` : `${winMin / 60} ч`) : '—';
  const nameErr = !t.nameKg ? 'Название на кыргызском обязательно — это надпись кнопки в боте' : '';
  const pointsErr = t.points === '' || Number(t.points) < 0 || Number.isNaN(Number(t.points)) ? 'Баллы — целое число от 0' : '';
  const onSettings = s.topicTab === 'settings';

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary btn-sm" onClick={() => go('topics')}>
          ← Темы
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {t.emoji} {t.nameKg}
        </div>
        <Switch on={t.active} onToggle={() => toggleTopic(t.id)} label="Включена в боте" />
        <span className="sub">включена в боте</span>
        <div className="grow" />
        <button type="button" className="btn-danger-outline" onClick={() => deleteTopic(t.id)}>
          Удалить тему
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button type="button" role="tab" aria-selected={onSettings} onClick={() => set({ topicTab: 'settings' })}>
          Настройки
        </button>
        <button type="button" role="tab" aria-selected={!onSettings} onClick={() => set({ topicTab: 'questions' })}>
          Вопросы ({t.questions.length})
        </button>
      </div>

      {onSettings ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <section className="card" style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
            <Field label="Эмодзи">
              <input type="text" className="input" style={{ textAlign: 'center' }} value={t.emoji} onChange={(e) => setT('emoji', e.target.value)} />
            </Field>
            <Field label="Название, кыргызча" error={nameErr}>
              <input type="text" className={'input' + (nameErr ? ' input-invalid' : '')} value={t.nameKg} onChange={(e) => setT('nameKg', e.target.value)} placeholder="Зикир" />
            </Field>
            <Field label="Название, по-русски">
              <input type="text" className="input" value={t.nameRu} onChange={(e) => setT('nameRu', e.target.value)} placeholder="Зикр" />
            </Field>
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div className="h-card">Окно сдачи</div>
              <div className="hint">Отчёт принимается только внутри окна, по местному времени участницы. Напоминание уходит при открытии.</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
              <Field label="С">
                <input type="time" className="input" style={{ width: 'auto' }} value={t.start} onChange={(e) => setT('start', e.target.value)} />
              </Field>
              <Field label="До">
                <input type="time" className="input" style={{ width: 'auto' }} value={t.end} onChange={(e) => setT('end', e.target.value)} />
              </Field>
              <span className="hint" style={{ paddingBottom: 8 }}>
                Окно {winLen}, одинаково каждый день.
              </span>
            </div>
            <div className="note">Темы по времени намаза здесь не создаются — они готовые и фиксированные, в разделе «Намазы» на странице «Темы».</div>
          </section>

          <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Field label="Баллы за отчёт" error={pointsErr} hint="Плюс баллы за варианты ответов, если есть.">
              <input
                type="number"
                className={'input' + (pointsErr ? ' input-invalid' : '')}
                value={t.points}
                onChange={(e) => setT('points', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>

            {/* Подтверждение — единственный формат: видеокружок. Он не проверяется. */}
            <div>
              <span className="label-text">Подтверждение</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '7px 10px', background: 'var(--bg)' }}>
                <span aria-hidden="true">🎥</span>
                <span style={{ fontWeight: 600 }}>Видеокружок</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>единственный формат</span>
              </div>
              <span className="hint-sm" style={{ display: 'block', marginTop: 4 }}>
                Не проверяется — факт отправки засчитывается как отчёт. До 60 секунд — ограничение Telegram.
              </span>
            </div>

            <Field label="Частота">
              <select className="select select-white" value={t.freq} onChange={(e) => setT('freq', e.target.value as Frequency)}>
                <option value="daily">Каждый день</option>
                <option value="weekly">Раз в неделю</option>
              </select>
            </Field>

            <Field label="Напоминание" hint="Не уходит тем, кто уже сдал, и в тихие часы бота.">
              <select className="select select-white" value={t.remind} onChange={(e) => setT('remind', Number(e.target.value))}>
                <option value="0">При открытии окна</option>
                <option value="30">Через 30 мин после открытия</option>
                <option value="-30">За 30 мин до закрытия</option>
              </select>
            </Field>

            <label className="check-label check-label-top" style={{ paddingTop: 20 }}>
              <input type="checkbox" className="check" checked={t.mandatory} onChange={(e) => setT('mandatory', e.target.checked)} />
              <span>
                <span style={{ fontWeight: 600 }}>Обязательная</span>
                <br />
                <span className="hint-sm">Пропуск прерывает серию дней. Окна тем могут пересекаться — отчёт сдаётся по каждой теме отдельно.</span>
              </span>
            </label>
          </section>
        </div>
      ) : (
        <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="sub">Задаются по порядку после видеокружка. Без вопросов тема — просто «отправь видеокружок».</div>
          {t.questions.map((q, i) => {
            const bad = (q.type === 'single' || q.type === 'multi') && q.options.length < 2;
            return (
              <div key={q.id} className="card" style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 12, alignItems: 'center' }}>
                <span style={{ width: 26, height: 26, borderRadius: 'var(--r-pill)', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
                  {i + 1}
                </span>
                <button type="button" className="btn-plain" style={{ minWidth: 0 }} onClick={() => go('questionEditor', { qId: q.id })}>
                  <div style={{ fontWeight: 600 }}>{q.textKg || '— пусто —'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{q.textRu || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    {QTYPE[q.type]}
                    {q.options.length ? ` · ${q.options.length} вариантов` : ''}
                    {q.required ? ' · обязательный' : ''}
                    {bad ? (
                      <>
                        {' · '}
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}>меньше 2 вариантов</span>
                      </>
                    ) : null}
                  </div>
                </button>
                <MoveButtons
                  size="lg"
                  onUp={() => moveQ(q.id, -1)}
                  onDown={() => moveQ(q.id, 1)}
                  isFirst={i === 0}
                  isLast={i === t.questions.length - 1}
                  extra={
                    <>
                      <button type="button" className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => go('questionEditor', { qId: q.id })}>
                        Изменить
                      </button>
                      <button type="button" className="btn-plain" style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }} onClick={() => delQ(q.id)}>
                        Удалить
                      </button>
                    </>
                  }
                />
              </div>
            );
          })}
          <div>
            <button type="button" className="btn" onClick={addQ}>
              Добавить вопрос
            </button>
          </div>
        </div>
      )}
    </>
  );
}
