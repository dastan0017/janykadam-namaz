import { LockIcon, Switch } from '../components/ui';
import { NAMAZ, TZ, TZ_ORDER } from '../data/constants';
import { currentData } from '../lib/derive';
import { nsTopic, winStr } from '../lib/time';
import { useActions, useAppState } from '../store/context';
import type { TzKey } from '../types';
import { MoveButtons } from '../components/ui';

const NAMAZ_COLS = '28px minmax(150px,1.3fr) minmax(170px,1.4fr) 120px 60px 60px 130px';
const TOPIC_COLS = '56px minmax(180px,1.6fr) 130px 120px 60px 60px 100px';

export function Topics() {
  const s = useAppState();
  const { set, go, toggleTopic, moveTopic, addTopic } = useActions();
  const d = currentData(s);
  const selected = new Set(d.namaz ?? []);
  const tzView: TzKey = TZ[s.tzView] ? s.tzView : 'bishkek';

  return (
    <>
      {/* Намазы — фиксированная библиотека: в марафоне их только отмечают */}
      <section style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 420px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="h-section">Намазы</h2>
              <span className="tag-fixed">
                <LockIcon />
                фиксированы
              </span>
            </div>
            <div className="sub" style={{ marginTop: 3, lineHeight: 1.5 }}>
              Время считается автоматически по часовому поясу участницы. Названия, окна и баллы одинаковые во всех марафонах — здесь только отметьте, какие нужны.{' '}
              <button type="button" className="btn-link" onClick={() => go('namaz')}>
                Как считается время →
              </button>
            </div>
          </div>
          <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            Время для{' '}
            <select className="select select-pill" style={{ width: 'auto' }} value={tzView} onChange={(e) => set({ tzView: e.target.value as TzKey })}>
              {TZ_ORDER.map((k) => (
                <option key={k} value={k}>
                  {TZ[k].city} · {TZ[k].utc}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="card-scroll">
          <div className="thead" style={{ display: 'grid', gridTemplateColumns: NAMAZ_COLS, gap: 10, minWidth: 820 }}>
            <span />
            <span>Намаз</span>
            <span>Окно сдачи</span>
            <span>Сегодня · {TZ[tzView].city}</span>
            <span>Баллы</span>
            <span>Обяз.</span>
            <span>В марафоне</span>
          </div>
          {NAMAZ.map((n) => {
            const on = selected.has(n.id);
            return (
              <div
                key={n.id}
                style={{ display: 'grid', gridTemplateColumns: NAMAZ_COLS, gap: 10, alignItems: 'center', padding: '9px 12px', borderTop: '1px solid var(--line-soft)', minWidth: 820, background: on ? 'transparent' : 'var(--shade)' }}
              >
                <span style={{ color: 'var(--muted)', display: 'flex' }} title="Фиксированная тема">
                  <LockIcon size={15} />
                  <span className="sr">фиксированная</span>
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>
                    {n.emoji} {n.nameKg}
                  </span>
                  <br />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{n.nameRu}</span>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{n.rule}</span>
                <span>
                  <span className={'tag-win' + (on ? ' tag-win-open' : '')}>{winStr(nsTopic(n), tzView)}</span>
                </span>
                <span className="nums">{n.points}</span>
                <span style={{ fontSize: 12.5 }}>{n.mandatory ? <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>да</span> : null}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Switch on={on} onToggle={() => toggleTopic(n.id)} label={(on ? 'Убрать из марафона: ' : 'Добавить в марафон: ') + n.nameKg} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{on ? 'в марафоне' : 'не выбран'}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Свои темы — окно фиксированное, порядок задаёт порядок кнопок в боте */}
      <section>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 420px' }}>
            <h2 className="h-section">Свои темы марафона</h2>
            <div className="sub" style={{ marginTop: 3, lineHeight: 1.5 }}>
              В боте эти кнопки идут после намазов, в этом порядке. Окно — по местному времени участницы. Отчёт — только видеокружок.
            </div>
          </div>
          <button type="button" className="btn" onClick={addTopic}>
            Новая тема
          </button>
        </div>

        {d.topics.length === 0 ? (
          <div className="empty" style={{ padding: 32 }}>
            Своих тем пока нет. Добавьте вручную или продублируйте прошлый марафон на экране «Все марафоны».
          </div>
        ) : (
          <div className="card-scroll">
            <div className="thead" style={{ display: 'grid', gridTemplateColumns: TOPIC_COLS, gap: 10, minWidth: 760 }}>
              <span />
              <span>Тема</span>
              <span>Окно</span>
              <span>Баллы</span>
              <span>Вопр.</span>
              <span>Обяз.</span>
              <span>Вкл.</span>
            </div>
            {d.topics.map((t, i) => {
              const edit = () => go('topicEditor', { topicId: t.id, topicTab: 'settings' });
              const pointsLabel = t.questions.some((q) => q.options.length) ? (t.points ? t.points + ' + за ответы' : 'за ответы') : t.points;
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'grid', gridTemplateColumns: TOPIC_COLS, gap: 10, alignItems: 'center', padding: '9px 12px',
                    borderTop: '1px solid var(--line-soft)', minWidth: 760, opacity: t.active ? 1 : 0.55,
                    background: t.id === s.topicId ? 'var(--accent-row)' : 'transparent',
                  }}
                >
                  <MoveButtons onUp={() => moveTopic(t.id, -1)} onDown={() => moveTopic(t.id, 1)} isFirst={i === 0} isLast={i === d.topics.length - 1} />
                  <button type="button" className="btn-plain" style={{ minWidth: 0 }} onClick={edit}>
                    <span style={{ fontWeight: 600 }}>
                      {t.emoji} {t.nameKg || '— без названия —'}
                    </span>
                    <br />
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.nameRu || '—'}</span>
                  </button>
                  <span>
                    <span className="tag-win">{winStr(t)}</span>
                  </span>
                  <span className="nums">{pointsLabel}</span>
                  <span>{t.questions.length}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t.mandatory ? <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>да</span> : null}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Switch on={t.active} onToggle={() => toggleTopic(t.id)} label={(t.active ? 'Выключить: ' : 'Включить: ') + (t.nameKg || 'тема без названия')} />
                    <button type="button" className="btn-link" onClick={edit}>
                      изм.
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
