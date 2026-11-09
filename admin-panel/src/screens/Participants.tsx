import { ParticipantPill } from '../components/ui';
import { TODAY_LABEL, TZ, TZ_ORDER } from '../data/constants';
import { currentData, currentMarathon, doneToday, filteredParts } from '../lib/derive';
import { tzLabel } from '../lib/time';
import { useActions, useAppState } from '../store/context';
import type { ParticipantStatus, TzKey } from '../types';

const COLS = '28px minmax(180px,1.6fr) 130px 90px 70px 60px 110px';

export function Participants({ isMobile }: { isMobile: boolean }) {
  const s = useAppState();
  const { set, setPf, sortBy, toggleSel, selAll, bulk, exportCsv } = useActions();
  const list = filteredParts(s);
  const total = currentData(s).participants.length;
  const m = currentMarathon(s);
  const selN = s.pf.sel.length;
  const hasFilters = !!(s.pf.q || s.pf.status !== 'all' || s.pf.tz !== 'all' || s.pf.act !== 'all');

  const lastLabel = (n: number) => (n === 0 ? 'сегодня' : n === 1 ? 'вчера' : n + ' дн. назад');

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input
          type="search"
          className="input input-pill"
          style={{ width: 220, maxWidth: '100%' }}
          value={s.pf.q}
          onChange={(e) => setPf('q', e.target.value)}
          aria-label="Поиск участниц"
          placeholder="Имя или @username"
        />
        <select className="select select-pill" style={{ width: 'auto' }} value={s.pf.status} onChange={(e) => setPf('status', e.target.value as ParticipantStatus | 'all')} aria-label="Статус">
          <option value="all">Любой статус</option>
          <option value="active">Активна</option>
          <option value="paused">Пауза</option>
          <option value="left">Вышла</option>
          <option value="finished">Завершила</option>
        </select>
        <select className="select select-pill" style={{ width: 'auto' }} value={s.pf.tz} onChange={(e) => setPf('tz', e.target.value as TzKey | 'all')} aria-label="Часовой пояс">
          <option value="all">Все пояса</option>
          {TZ_ORDER.map((k) => (
            <option key={k} value={k}>
              {TZ[k].city} · {TZ[k].utc}
            </option>
          ))}
        </select>
        <select className="select select-pill" style={{ width: 'auto' }} value={s.pf.act} onChange={(e) => setPf('act', e.target.value as typeof s.pf.act)} aria-label="Активность">
          <option value="all">Любая активность</option>
          <option value="today">Сдали сегодня</option>
          <option value="nottoday">Не сдали сегодня</option>
          <option value="stopped">Молчат 3+ дня</option>
          <option value="new">Новые сегодня</option>
        </select>
        {hasFilters ? (
          <button type="button" className="btn-link" onClick={() => set({ pf: { q: '', status: 'all', tz: 'all', act: 'all', sort: 'name', dir: 1, sel: [] } })}>
            сбросить
          </button>
        ) : null}
        <div className="grow" />
        <span className="sub">
          {list.length} из {total}
        </span>
        <button type="button" className="btn-secondary btn-sm" onClick={exportCsv}>
          Экспорт CSV
        </button>
      </div>

      {selN > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--ink)', color: 'var(--card)', borderRadius: 'var(--r-md)', padding: '8px 12px', marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>Выбрано: {selN}</span>
          <button type="button" style={{ border: '1px solid var(--muted)', borderRadius: 'var(--r-pill)', padding: '4px 12px', background: 'transparent', color: 'var(--card)', fontWeight: 600, fontSize: 12.5 }} onClick={() => bulk('message')}>
            Написать
          </button>
          <button type="button" style={{ border: '1px solid var(--muted)', borderRadius: 'var(--r-pill)', padding: '4px 12px', background: 'transparent', color: 'var(--card)', fontWeight: 600, fontSize: 12.5 }} onClick={() => bulk('pause')}>
            Поставить на паузу
          </button>
          <div className="grow" />
          <button type="button" style={{ border: 0, background: 'transparent', color: 'var(--line-strong)', fontSize: 12.5 }} onClick={() => setPf('sel', [])}>
            снять выбор
          </button>
        </div>
      ) : null}

      {list.length === 0 ? (
        <div className="empty">
          {hasFilters ? 'Никто не подходит под фильтры.' : null}
          {total === 0 ? (
            <>
              Участниц пока нет. Они появятся, когда перейдут по ссылке <span className="mono">t.me/{s.bot.username}?start={m?.code}</span> и нажмут «Старт» — бот не может написать первым.
            </>
          ) : null}
        </div>
      ) : isMobile ? (
        /* На телефоне — карточки: куратор смотрит участниц между другими делами */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              className="card btn-plain"
              style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}
              onClick={() => set({ drawerId: p.id })}
            >
              <span className="dot" style={{ background: doneToday(s, p) ? 'var(--sage)' : p.status === 'active' ? 'var(--line)' : 'transparent' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, display: 'block' }}>{p.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {tzLabel(p.tz)} · {lastLabel(p.last)}
                </span>
              </span>
              <span style={{ fontWeight: 700 }}>{p.points}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card-scroll">
          <div className="thead" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center', minWidth: 760 }}>
            <input type="checkbox" className="check" checked={list.length > 0 && selN === list.length} onChange={selAll} aria-label="Выбрать всех" />
            <button type="button" className="thead-sort" onClick={() => sortBy('name')}>
              Участница ↕
            </button>
            <button type="button" className="thead-sort" onClick={() => sortBy('tz')}>
              Пояс ↕
            </button>
            <span>Статус</span>
            <button type="button" className="thead-sort" onClick={() => sortBy('points')}>
              Баллы ↕
            </button>
            <span>Серия</span>
            <button type="button" className="thead-sort" onClick={() => sortBy('last')}>
              Отчёт ↕
            </button>
          </div>

          {list.map((p) => {
            const lateBad = p.last >= 3 && p.status === 'active';
            return (
              <div
                key={p.id}
                className="trow"
                style={{
                  display: 'grid', gridTemplateColumns: COLS, gap: 10, minWidth: 760,
                  background: s.pf.sel.includes(p.id) ? 'var(--accent-row)' : s.drawerId === p.id ? 'var(--shade)' : 'transparent',
                }}
              >
                <input type="checkbox" className="check" checked={s.pf.sel.includes(p.id)} onChange={() => toggleSel(p.id)} aria-label={`Выбрать ${p.name}`} />
                <button type="button" className="btn-plain" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }} onClick={() => set({ drawerId: p.id })}>
                  {/* Точка слева — сдала сегодня */}
                  <span className="dot" style={{ background: doneToday(s, p) ? 'var(--sage)' : p.status === 'active' ? 'var(--line)' : 'transparent' }} />
                  <span style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontWeight: 600, display: 'block' }}>
                      {p.name}
                      {p.joined === TODAY_LABEL ? <span className="tag-new" style={{ marginLeft: 4 }}>новая</span> : null}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.user}</span>
                  </span>
                </button>
                <span style={{ fontSize: 12.5 }}>{tzLabel(p.tz)}</span>
                <span>
                  <ParticipantPill status={p.status} />
                </span>
                <span className="nums" style={{ fontWeight: 600 }}>
                  {p.points}
                </span>
                <span className="sub">{p.streak} дн.</span>
                {/* Просрочка — красный текст без фона */}
                <span style={{ fontSize: 12.5, color: lateBad ? 'var(--danger)' : undefined, fontWeight: lateBad ? 600 : undefined }}>{lastLabel(p.last)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
