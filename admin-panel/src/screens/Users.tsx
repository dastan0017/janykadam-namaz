import { meId } from '../lib/derive';
import { plural } from '../lib/format';
import { useActions, useAppState } from '../store/context';
import type { Role } from '../types';

const COLS = 'minmax(220px,1.6fr) 150px 170px 110px';

/** Только для админов: добавление людей, роли и отключение доступа. */
export function Users() {
  const s = useAppState();
  const { set, setRole, removeUser, inviteUser } = useActions();
  const me = meId(s);
  const q = s.userQ.trim().toLowerCase();
  const admins = s.users.filter((u) => u.role === 'admin').length;
  const rows = s.users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.tg.toLowerCase().includes(q));
  const inv = s.invite;

  return (
    <div style={{ maxWidth: 960, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="pill" style={{ alignSelf: 'flex-start', padding: '2px 10px', fontWeight: 700, background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
            Админ
          </span>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Всё, что может куратор, плюс эта страница: добавлять людей, менять роли, отключать доступ.</div>
        </div>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="pill" style={{ alignSelf: 'flex-start', padding: '2px 10px', fontWeight: 700, background: 'var(--sage-soft)', color: 'var(--sage-deep)' }}>
            Куратор
          </span>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            Все марафоны, темы, участницы, рассылки, аналитика, тексты и настройки бота, журнал. Не видит «Пользователей».
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          className="input input-pill"
          style={{ width: 240, maxWidth: '100%' }}
          value={s.userQ}
          onChange={(e) => set({ userQ: e.target.value })}
          aria-label="Поиск пользователей"
          placeholder="Имя или @username"
        />
        <span className="sub">
          {s.users.length} {plural(s.users.length, 'человек', 'человека', 'человек')} · {admins} {plural(admins, 'админ', 'админа', 'админов')}
        </span>
        <div className="grow" />
        <button type="button" className="btn" onClick={() => set({ invite: { name: '', tg: '', role: 'curator', err: '' } })}>
          Добавить пользователя
        </button>
      </div>

      {inv ? (
        <div className="card" style={{ borderColor: 'var(--accent)', display: 'grid', gridTemplateColumns: 'minmax(180px,1.4fr) minmax(160px,1.2fr) 150px auto', gap: 10, alignItems: 'end' }}>
          <label className="label">
            <span className="label-text">Имя</span>
            <input type="text" className="input" value={inv.name} onChange={(e) => set({ invite: { ...inv, name: e.target.value, err: '' } })} placeholder="Например: Нуриза Токтогулова" />
          </label>
          <label className="label">
            <span className="label-text">Telegram</span>
            <input type="text" className="input" value={inv.tg} onChange={(e) => set({ invite: { ...inv, tg: e.target.value, err: '' } })} placeholder="@username" />
          </label>
          <label className="label">
            <span className="label-text">Роль</span>
            <select className="select select-white" value={inv.role} onChange={(e) => set({ invite: { ...inv, role: e.target.value as Role } })}>
              <option value="curator">Куратор</option>
              <option value="admin">Админ</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn-secondary" onClick={() => set({ invite: null })}>
              Отмена
            </button>
            <button type="button" className="btn" onClick={inviteUser}>
              Добавить
            </button>
          </div>
          {inv.err ? (
            <div className="err-text" style={{ gridColumn: '1/-1', fontSize: 12.5 }}>
              {inv.err}
            </div>
          ) : null}
          <div className="hint" style={{ gridColumn: '1/-1' }}>
            Вход в панель — через Telegram. После добавления человек входит со своего аккаунта, и доступ открывается сразу.
          </div>
        </div>
      ) : null}

      <div className="card-scroll">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '8px 14px', minWidth: 660 }}>
          <span>Пользователь</span>
          <span>Роль</span>
          <span>Последний вход</span>
          <span />
        </div>
        {rows.map((u) => {
          const isMe = u.id === me;
          const canRemove = !isMe && !(u.role === 'admin' && admins <= 1);
          const initials = u.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
          return (
            <div
              key={u.id}
              style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center', padding: '9px 14px', borderTop: '1px solid var(--line-soft)', minWidth: 660, background: isMe ? 'var(--shade)' : 'transparent' }}
            >
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                <span className="avatar" style={{ background: u.role === 'admin' ? 'var(--accent-text)' : 'var(--sage-text)', fontSize: 11.5 }}>
                  {initials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ fontWeight: 600, display: 'block' }}>
                    {u.name}
                    {isMe ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — это вы</span> : null}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{u.tg}</span>
                </span>
              </span>
              <span>
                <select className="select select-white" style={{ padding: '5px 8px' }} value={u.role} onChange={(e) => setRole(u.id, e.target.value as Role)} disabled={isMe} aria-label={'Роль: ' + u.name}>
                  <option value="admin">Админ</option>
                  <option value="curator">Куратор</option>
                </select>
              </span>
              <span className="sub">{u.invited ? <span className="tag-invited">ждёт первого входа</span> : u.last || '—'}</span>
              <span style={{ textAlign: 'right' }}>
                {canRemove ? (
                  <button type="button" className="btn-danger-outline" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeUser(u.id)}>
                    Отключить
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="hint">Свою роль поменять нельзя, и в панели всегда остаётся хотя бы один админ.</div>
    </div>
  );
}
