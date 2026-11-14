import { ICONS, STATUS } from '../data/constants';
import { currentMarathon, isCurator, validate } from '../lib/derive';
import { dateRu } from '../lib/format';
import { useActions, useAppState } from '../store/context';
import type { Screen } from '../types';
import { Icon, StatusPill } from './ui';

interface NavDef {
  screen: Screen;
  label: string;
  badge?: number | string;
  tone?: 'neutral' | 'bad' | 'warn';
  tag?: string;
}

function NavButton({ def }: { def: NavDef }) {
  const s = useAppState();
  const { go } = useActions();
  // Редакторы темы и вопроса подсвечивают «Темы» — они её часть.
  const on = s.screen === def.screen || (def.screen === 'topics' && (s.screen === 'topicEditor' || s.screen === 'questionEditor'));
  const toneClass = def.tone === 'bad' ? ' badge-bad' : def.tone === 'warn' ? ' badge-warn' : '';

  return (
    <button
      type="button"
      className={'nav-item' + (def.screen === 'marathons' ? ' nav-item-flat' : '')}
      aria-current={on ? 'page' : undefined}
      onClick={() => go(def.screen)}
    >
      <Icon path={ICONS[def.screen === 'marathons' ? 'all' : def.screen]} />
      <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
        {def.label}
      </span>
      {def.badge ? <span className={'badge' + toneClass}>{def.badge}</span> : null}
      {def.tag ? <span className="tag-outline">{def.tag}</span> : null}
    </button>
  );
}

export function Sidebar() {
  const s = useAppState();
  const { switchM } = useActions();
  const m = currentMarathon(s);
  const issues = validate(s);
  const errs = issues.filter((i) => i.level === 'error').length;
  const untranslated = s.texts.filter((t) => !t.kg || !t.ru).length;
  const cur = isCurator(s);

  // Канал не готов — красная отметка, пока марафон ещё идёт или впереди.
  const channelProblem = !!m && !m.channel.ready && m.status !== 'finished' && m.status !== 'archive';
  const navM: NavDef[] = [
    { screen: 'overview', label: 'Обзор', badge: errs, tone: 'bad' },
    { screen: 'topics', label: 'Темы' },
    { screen: 'participants', label: 'Участницы' },
    { screen: 'broadcasts', label: 'Рассылки' },
    { screen: 'analytics', label: 'Аналитика' },
    { screen: 'channel', label: 'Канал отчётов', badge: channelProblem ? '!' : undefined, tone: 'bad' },
    { screen: 'settings', label: 'Настройки' },
  ];
  const navBot: NavDef[] = [
    { screen: 'namaz', label: 'Время намазов' },
    { screen: 'texts', label: 'Тексты бота', badge: untranslated, tone: 'warn' },
    { screen: 'bot', label: 'Настройки бота' },
  ];
  const navSys: NavDef[] = [
    ...(cur ? [] : [{ screen: 'users' as Screen, label: 'Пользователи', tag: 'админ' }]),
    { screen: 'journal', label: 'Журнал изменений' },
  ];

  return (
    <aside className="sidebar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 0', flex: 'none' }}>
        <div className="avatar" style={{ background: 'var(--accent-text)', fontSize: 13 }}>
          JK
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.1 }}>Janykadam</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>панель марафонов</div>
        </div>
      </div>

      <nav aria-label="Разделы панели" style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 'none' }}>
        <div>
          <NavButton def={{ screen: 'marathons', label: 'Все марафоны', badge: s.marathons.length }} />
        </div>

        {m ? (
          <section
            aria-label="Текущий марафон"
            style={{ background: 'var(--sand-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '10px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="group-dot" style={{ background: 'var(--accent)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', flex: 1 }}>Марафон</span>
                <StatusPill status={m.status} />
              </div>
              <select className="select" style={{ fontWeight: 600 }} value={m.id} onChange={(e) => switchM(e.target.value)} aria-label="Выбрать марафон">
                {s.marathons.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {STATUS[x.status][0]}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {dateRu(m.start)} — {dateRu(m.end)}
                {m.status === 'running' ? ' · день 20 из 30' : ''}
              </div>
            </div>
            <div className="nav-group">
              {navM.map((d) => (
                <NavButton key={d.screen} def={d} />
              ))}
            </div>
          </section>
        ) : null}

        <section aria-label="Бот — общее для всех марафонов" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="group-head">
            <span className="group-dot" style={{ background: 'var(--sage)' }} />
            <span>Бот</span>
            <span style={{ fontSize: 11.5, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>общее для всех марафонов</span>
          </div>
          <div className="nav-group">
            {navBot.map((d) => (
              <NavButton key={d.screen} def={d} />
            ))}
          </div>
        </section>

        <section aria-label="Система" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="group-head">
            <span className="group-dot" style={{ background: 'var(--muted-2)' }} />
            <span>Система</span>
            <span style={{ fontSize: 11.5, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>доступ и история</span>
          </div>
          <div className="nav-group">
            {navSys.map((d) => (
              <NavButton key={d.screen} def={d} />
            ))}
          </div>
        </section>
      </nav>

      <div style={{ flex: '1 0 8px' }} />
      <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 10px', lineHeight: 1.4, flex: 'none' }}>
        Один бот на все марафоны: @{s.bot.username}
      </div>
    </aside>
  );
}
