import { useEffect, useRef } from 'react';
import { CreateChannelSteps } from '../components/ChannelGuide';
import { ICONS } from '../data/constants';
import { channelLinkError } from '../lib/channel';
import { dateRu, plural } from '../lib/format';
import { useActions, useAppState } from '../store/context';
import type { MarathonStatus } from '../types';
import { EmptyState, Pager, Segmented, StatusPill } from '../components/ui';
import { usePaged } from '../lib/paged';

const TABS: { id: MarathonStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'running', label: 'Идут' },
  { id: 'draft', label: 'Черновики' },
  { id: 'finished', label: 'Завершённые' },
  { id: 'archive', label: 'Архив' },
];

export function Marathons() {
  const s = useAppState();
  const { set, go, switchM, duplicate, deleteM, copyLink, createM, openNewM } = useActions();

  const list = s.marathons.filter((x) => s.filterTab === 'all' || x.status === s.filterTab);
  const { rows, pager } = usePaged(list, s.filterTab, 12);
  const nm = s.newM;
  // «Дублировать» нажимают и на карточке внизу списка — форма должна оказаться на виду.
  const formRef = useRef<HTMLElement>(null);
  const formKey = nm ? nm.fromId ?? 'new' : null;
  useEffect(() => {
    if (formKey) formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [formKey]);
  const fromName = nm?.fromId ? s.marathons.find((m) => m.id === nm.fromId)?.name : undefined;
  const linkErr = nm?.touched ? channelLinkError(nm.channelLink) : '';

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <Segmented ariaLabel="Фильтр марафонов" value={s.filterTab} onChange={(id) => set({ filterTab: id })} options={TABS} />
        <div className="grow" />
        <button type="button" className="btn-secondary" onClick={() => openNewM()}>
          Новый пустой марафон
        </button>
      </div>

      {nm ? (
        <section ref={formRef} className="card new-m" aria-label={fromName ? 'Копия марафона' : 'Новый марафон'}>
          <div>
            <div className="h-card">{fromName ? `Копия марафона «${fromName}»` : 'Новый марафон'}</div>
            <div className="hint">
              {fromName
                ? 'Намазы, свои темы и вопросы перенесутся. Участницы и канал — нет: у нового потока свой канал.'
                : 'Темы добавите после создания. Канал отчётов нужен сразу — у каждого марафона свой.'}
            </div>
          </div>

          <div className="new-m-grid">
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
          </div>

          <div className="new-m-channel">
            <label className="label">
              <span className="label-text">
                📺 Ссылка на канал отчётов <span className="req">обязательно</span>
              </span>
              <input
                type="url"
                inputMode="url"
                className={'input mono' + (linkErr ? ' input-bad' : '')}
                value={nm.channelLink}
                onChange={(e) => set({ newM: { ...nm, channelLink: e.target.value, err: '' } })}
                placeholder="https://t.me/+AbCdEf…"
                aria-invalid={!!linkErr}
                aria-describedby="new-m-channel-hint"
              />
            </label>
            <div id="new-m-channel-hint" className="hint">
              Закрытый Telegram-канал, куда бот будет выкладывать видеоотчёты участниц. Создайте новый канал для этого марафона и вставьте его ссылку.
            </div>
            {linkErr ? <div className="err-text">{linkErr}</div> : null}
            <button
              type="button"
              className="btn-link"
              aria-expanded={!!nm.guide}
              onClick={() => set({ newM: { ...nm, guide: !nm.guide } })}
            >
              {nm.guide ? 'Скрыть инструкцию' : 'Как создать канал? — 1 минута'}
            </button>
            {nm.guide ? (
              <div className="guide-box">
                <CreateChannelSteps />
              </div>
            ) : null}
          </div>

          <div className="new-m-foot">
            <span className="hint" style={{ flex: '1 1 240px' }}>
              Дальше: добавить бота в канал админом — покажем на следующем шаге.
            </span>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button type="button" className="btn-secondary" onClick={() => set({ newM: null })}>
                Отмена
              </button>
              <button type="button" className="btn" onClick={createM}>
                {fromName ? 'Создать копию' : 'Создать черновик'}
              </button>
            </div>
          </div>
          {nm.err && nm.err !== linkErr ? <div className="err-text">{nm.err}</div> : null}
        </section>
      ) : null}

      {s.marathons.length === 0 ? (
        <EmptyState
          title="Марафонов пока нет"
          action={
            <button type="button" className="btn" onClick={() => openNewM()}>
              Создать марафон
            </button>
          }
        >
          Создайте первый. Следующие удобнее делать дублированием — выбранные намазы и свои темы перенесутся.
        </EmptyState>
      ) : null}

      {s.marathons.length > 0 && list.length === 0 ? <div style={{ color: 'var(--muted)', padding: 30, textAlign: 'center' }}>В этом списке пусто.</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {rows.map((x) => {
          // Данные грузятся по одному марафону, поэтому для остальных берём
          // сводку из списка — иначе карточки показывали бы нули.
          const dd = s.data[x.id];
          const loaded = !!dd && s.loaded.includes(x.id);
          const act = (dd?.participants ?? []).filter((p) => p.status === 'active');
          const activeCount = loaded ? act.length : (x.stats?.active ?? 0);
          const done = loaded ? act.filter((p) => p.today.length).length : (x.stats?.submittedToday ?? 0);
          const nz = loaded ? (dd.namaz ?? []).length : (x.namazCount ?? 0);
          const own = loaded ? dd.topics.length : (x.topicsCount ?? 0);
          const topicsLabel = nz + own + (nz ? ` · из них ${nz} ${plural(nz, 'намаз', 'намаза', 'намазов')}` : '');
          const pct =
            x.status === 'running'
              ? activeCount
                ? Math.round((done / activeCount) * 100) + '% сдали сегодня'
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
                  {x.reported ?? dd?.participants.length ?? 0}
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

      <Pager {...pager} />
    </>
  );
}
