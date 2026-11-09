import { GROUP, STATUS } from '../data/constants';
import { currentMarathon, isCurator, meName } from '../lib/derive';
import { useActions, useAppState } from '../store/context';
import { Segmented, StatusPill } from './ui';

const GROUP_DOT: Record<'all' | 'm' | 'bot' | 'sys', string> = {
  m: 'var(--accent)',
  bot: 'var(--sage)',
  sys: 'var(--muted-2)',
  all: 'var(--ink-3)',
};

export function Header({ isMobile }: { isMobile: boolean }) {
  const s = useAppState();
  const { switchM, setRoleView } = useActions();
  const m = currentMarathon(s);
  const cur = isCurator(s);
  const group = GROUP[s.screen] ?? 'm';

  const contextLabel =
    group === 'm'
      ? m
        ? 'Марафон · ' + m.name
        : 'Марафон'
      : group === 'bot'
        ? 'Бот · общее для всех марафонов'
        : group === 'sys'
          ? 'Система · доступ и история'
          : 'Все марафоны';

  return (
    <header className="app-header">
      {isMobile && m ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Марафон</span>
          <select className="select select-pill" style={{ maxWidth: 190, width: 'auto' }} value={m.id} onChange={(e) => switchM(e.target.value)}>
            {s.marathons.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {STATUS[x.status][0]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!isMobile ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <span className="group-dot" style={{ background: GROUP_DOT[group] }} />
          <span className="ellipsis">{contextLabel}</span>
          {group === 'm' && m ? <StatusPill status={m.status} /> : null}
        </div>
      ) : null}

      <div className="grow" />

      {/* Роль переключается здесь же: у куратора один марафон, своя команда и никаких «Пользователей». */}
      <Segmented
        ariaLabel="Смотреть панель как"
        value={cur ? 'curator' : 'admin'}
        onChange={setRoleView}
        options={[
          { id: 'admin', label: 'Админ' },
          { id: 'curator', label: 'Куратор' },
        ]}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="avatar" style={{ background: cur ? 'var(--sage-text)' : 'var(--accent-text)' }}>
          {cur ? 'АС' : 'ЖА'}
        </div>
        {!isMobile ? (
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{meName(s)}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{cur ? 'Куратор' : 'Админ'}</div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
