import { ICONS } from '../data/constants';
import { dateRu, plural } from '../lib/format';
import { useActions, useAppState } from '../store/context';
import type { MarathonStatus } from '../types';
import { EmptyState, Segmented, StatusPill } from '../components/ui';

const TABS: { id: MarathonStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'running', label: 'Идут' },
  { id: 'draft', label: 'Черновики' },
  { id: 'finished', label: 'Завершённые' },
  { id: 'archive', label: 'Архив' },
];

export function Marathons() {
  const s = useAppState();
  const { set, go, switchM, duplicate, deleteM, copyLink, createM } = useActions();

  const list = s.marathons.filter((x) => s.filterTab === 'all' || x.status === s.filterTab);
  const nm = s.newM;

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <Segmented ariaLabel="Фильтр марафонов" value={s.filterTab} onChange={(id) => set({ filterTab: id })} options={TABS} />
        <div className="grow" />
        <button type="button" className="btn-secondary" onClick={() => set({ newM: { name: '', start: '2026-12-01', end: '2026-12-30', err: '' } })}>
          Новый пустой марафон
        </button>
      </div>

      {nm ? (
        <div
          className="card"
          style={{ borderColor: 'var(--accent)', marginBottom: 14, display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) repeat(2, minmax(130px,1fr)) auto', gap: 10, alignItems: 'end' }}
        >
          <label className="label">
            <span className="label-text">Название</span>
            <input
              type="text"
              className="input"
              value={nm.name}
              onChange={(e) => set({ newM: { ...nm, name: e.target.value, err: '' } })}
              placeholder="Например: Рамазан 2027"
            />
          </label>
          <label className="label">
            <span className="label-text">Начало</span>
            <input type="date" className="input" value={nm.start} onChange={(e) => set({ newM: { ...nm, start: e.target.value } })} />
          </label>
          <label className="label">
            <span className="label-text">Конец</span>
            <input type="date" className="input" value={nm.end} onChange={(e) => set({ newM: { ...nm, end: e.target.value } })} />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn-secondary" onClick={() => set({ newM: null })}>
              Отмена
            </button>
            <button type="button" className="btn" onClick={createM}>
              Создать черновик
            </button>
          </div>
          {nm.err ? (
            <div className="err-text" style={{ gridColumn: '1/-1', fontSize: 12.5 }}>
              {nm.err}
            </div>
          ) : null}
        </div>
      ) : null}

      {s.marathons.length === 0 ? (
        <EmptyState
          title="Марафонов пока нет"
          action={
            <button type="button" className="btn" onClick={() => set({ newM: { name: '', start: '2026-12-01', end: '2026-12-30', err: '' } })}>
              Создать марафон
            </button>
          }
        >
          Создайте первый. Следующие удобнее делать дублированием — выбранные намазы и свои темы перенесутся.
        </EmptyState>
      ) : null}

      {s.marathons.length > 0 && list.length === 0 ? <div style={{ color: 'var(--muted)', padding: 30, textAlign: 'center' }}>В этом списке пусто.</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {list.map((x) => {
          const dd = s.data[x.id];
          const act = dd.participants.filter((p) => p.status === 'active');
          const done = act.filter((p) => p.today.length).length;
          const nz = (dd.namaz ?? []).length;
          const topicsLabel = nz + dd.topics.length + (nz ? ` · из них ${nz} ${plural(nz, 'намаз', 'намаза', 'намазов')}` : '');
          const pct =
            x.status === 'running'
              ? act.length
                ? Math.round((done / act.length) * 100) + '% сдали сегодня'
                : '—'
              : x.status === 'finished'
                ? 'завершён'
                : 'не запущен';

          return (
            <article
              key={x.id}
              className="card"
              style={{ border: x.id === s.mid ? '1.5px solid var(--accent)' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{x.name}</div>
                <StatusPill status={x.status} />
              </div>

              {/* Deep link со кодом марафона — он идёт в био Instagram */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg)', borderRadius: 'var(--r-sm)', padding: '4px 4px 4px 10px', minWidth: 0 }}>
                <span className="mono ellipsis" style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-3)' }}>
                  t.me/{s.bot.username}?start={x.code}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  onClick={() => copyLink(x.id)}
                  aria-label={`Скопировать ссылку на бота для марафона «${x.name}»`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                    <path d={ICONS.copy} />
                  </svg>
                  Копировать
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Даты</span>
                  <br />
                  {dateRu(x.start)} — {dateRu(x.end)}
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Участниц</span>
                  <br />
                  {x.reported ?? dd.participants.length}
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Тем</span>
                  <br />
                  {topicsLabel}
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Сегодня</span>
                  <br />
                  {pct}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                <button
                  type="button"
                  className="btn-dark"
                  onClick={() => {
                    switchM(x.id);
                    go('overview');
                  }}
                >
                  Открыть
                </button>
                {/* Дублирование переносит намазы и свои темы — самая частая кнопка на экране */}
                <button type="button" className="btn btn-sm" onClick={() => duplicate(x.id)}>
                  Дублировать
                </button>
                <div className="grow" />
                <button type="button" className="btn-secondary btn-xs" style={{ color: 'var(--danger)' }} onClick={() => deleteM(x.id)}>
                  Удалить
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
