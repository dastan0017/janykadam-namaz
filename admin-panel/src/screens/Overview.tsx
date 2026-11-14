import { FALLBACK_TZ } from '../data/constants';
import { activeTopics, currentData, currentMarathon, issueSummary, stats, validate } from '../lib/derive';
import { dayCount, dayNumber, fmt, localNow, win, winStr } from '../lib/time';
import { useActions, useAppState } from '../store/context';
import type { AppState } from '../types';

export function Overview() {
  const s = useAppState();
  const { set, go, launch } = useActions();
  const m = currentMarathon(s);
  const d = currentData(s);
  const st = stats(s);
  const issues = validate(s);
  const errs = issues.filter((i) => i.level === 'error').length;
  const summary = issueSummary(errs, issues.length - errs);

  const isDraft = !!m && (m.status === 'draft' || m.status === 'recruiting');

  /** Каждое число ведёт в отфильтрованный список за ним. */
  const goParts = (act: AppState['pf']['act']) => set((prev) => ({ screen: 'participants', pf: { ...prev.pf, act, status: 'all', tz: 'all', q: '' } }));

  const trend = [...(d.trend ?? []), ...(m?.status === 'running' ? [st.pct] : [])];
  const act = d.participants.filter((p) => p.status === 'active');

  const pctColor = st.pct >= 70 ? 'var(--sage-text)' : st.pct >= 50 ? '#8a5f10' : 'var(--danger)';

  // Без канала участницы не видят отчёты друг друга, а черновик не запустить.
  const channelProblem = !!m && !m.channel.ready && m.status !== 'finished' && m.status !== 'archive';

  return (
    <>
      {channelProblem ? (
        <button type="button" className="card banner-bad" onClick={() => go('channel')}>
          <span aria-hidden="true">📺</span>
          <span style={{ flex: 1 }}>
            {m.channel.chatId ? 'У бота в канале отчётов не хватает прав' : 'Канал отчётов не подключён'}
            <span style={{ fontWeight: 400, display: 'block', fontSize: 12.5 }}>
              {m.status === 'draft' ? 'Без него марафон не запустить.' : 'Видеоотчёты не публикуются, участницы не видят друг друга.'} Шаги — на странице «Канал отчётов».
            </span>
          </span>
          <span aria-hidden="true">Подключить →</span>
        </button>
      ) : null}

      {isDraft ? (
        <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Марафон ещё не запущен</div>
            <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 2 }}>{summary}. Запуск откроет deep link и начнёт принимать регистрации.</div>
          </div>
          {/* Ошибки конфигурации действительно блокируют запуск */}
          <button type="button" className="btn" style={{ padding: '9px 18px' }} onClick={launch} disabled={errs > 0}>
            Открыть набор
          </button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        <button type="button" className="card btn-plain" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }} onClick={() => goParts('nottoday')}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Сдали сегодня</span>
          <span className="kpi" style={{ color: pctColor }}>
            {st.pct}%
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {st.done} из {st.active} активных{m ? ` · день ${dayNumber(m.start)} из ${dayCount(m.start, m.end)}` : ''}
          </span>
        </button>

        <button type="button" className="card btn-plain" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }} onClick={() => goParts('today')}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Видеокружков сегодня</span>
          <span className="kpi">{st.reports}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>засчитаны автоматически, без проверки</span>
        </button>

        <button type="button" className="card btn-plain" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }} onClick={() => goParts('stopped')}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Перестали отчитываться</span>
          <span className="kpi" style={{ color: st.stopped ? 'var(--danger)' : 'var(--sage-text)' }}>
            {st.stopped}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>3 и более дней без отчёта</span>
        </button>

        <button type="button" className="card btn-plain" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }} onClick={() => goParts('new')}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Новые сегодня</span>
          <span className="kpi">{st.newToday}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{st.newStarted} уже сдали первый отчёт — старт сразу после регистрации</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
        {trend.length > 1 ? (
          <section className="card">
            <div className="h-card" style={{ marginBottom: 2 }}>
              Сдача по дням
            </div>
            <div className="hint" style={{ marginBottom: 12 }}>
              Доля активных участниц хотя бы с одним отчётом за день. Сегодня — {st.pct}%.
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110, borderBottom: '1px solid var(--line)', paddingBottom: 1 }}>
              {trend.map((v, i) => (
                <div
                  key={i}
                  title={`День ${i + 1}: ${v}%`}
                  style={{ flex: 1, height: v + '%', background: i === trend.length - 1 ? 'var(--accent)' : 'var(--sage-bar)', borderRadius: 3, minWidth: 4 }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              <span>день 1</span>
              <span>сегодня</span>
            </div>
          </section>
        ) : null}

        {/* Проверка конфигурации — пересчитывается на каждом изменении, каждая строка ведёт туда, где её починить */}
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
            <div className="h-card">Проверка конфигурации</div>
            <button type="button" className="btn-link" onClick={() => go('topics')}>
              к темам →
            </button>
          </div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {summary}. Пересчитывается при каждом изменении.
          </div>
          {issues.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {issues.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  className="btn-plain"
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 0', fontSize: 13, lineHeight: 1.45 }}
                  onClick={() => go(it.screen, it.extra)}
                >
                  <span className="dot" style={{ background: it.level === 'error' ? 'var(--danger)' : 'var(--warn)', marginTop: 6 }} />
                  <span>{it.text}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="h-card" style={{ marginBottom: 2 }}>
            Сегодня по темам
          </div>
          <div className="hint" style={{ marginBottom: 12 }}>
            Окна показаны по Бишкеку, сейчас {fmt(localNow(FALLBACK_TZ))}. Намазы у каждой участницы — по её часовому поясу.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeTopics(s).map((t) => {
              const n = act.filter((p) => p.today.includes(t.id)).length;
              const closed = win(t).e <= localNow(FALLBACK_TZ);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="btn-plain"
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.2fr) minmax(90px,1fr) 56px', gap: 10, alignItems: 'center', fontSize: 12.5 }}
                  onClick={() => (t.sys ? go('topics') : go('topicEditor', { topicId: t.id, topicTab: 'settings' }))}
                >
                  <span className="ellipsis">
                    {t.emoji} {t.nameKg} <span style={{ color: 'var(--muted)' }}>{winStr(t)}</span>
                  </span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: (act.length ? (n / act.length) * 100 : 0) + '%', background: closed ? '#a19786' : 'var(--sage)' }} />
                  </span>
                  <span className="nums" style={{ textAlign: 'right' }}>
                    {n} / {act.length}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
