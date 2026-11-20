import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { ICONS, PSTATUS, STATUS } from '../data/constants';
import type { PagerState } from '../lib/paged';
import type { MarathonStatus, ParticipantStatus } from '../types';

/* ───────── Иконка ───────── */

export function Icon({ path, size = 16, style }: { path: string; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="nav-icon" style={style}>
      <path d={path} />
    </svg>
  );
}

export const LockIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
    <path d={ICONS.lock} />
  </svg>
);

/* ───────── Статусы ───────── */

export function StatusPill({ status }: { status: MarathonStatus }) {
  const [label, color, background] = STATUS[status] ?? STATUS.draft;
  return (
    <span className="pill" style={{ color, background }}>
      {label}
    </span>
  );
}

export function ParticipantPill({ status }: { status: ParticipantStatus }) {
  const [label, color, background] = PSTATUS[status] ?? PSTATUS.active;
  return (
    <span className="pill" style={{ color, background }}>
      {label}
    </span>
  );
}

/* ───────── Переключатель ───────── */

export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} className="switch">
      <span />
    </button>
  );
}

/* ───────── Поля ───────── */

export function Field({
  label,
  hint,
  error,
  counter,
  children,
  as = 'label',
  style,
}: {
  label: string;
  hint?: string;
  error?: string;
  counter?: string;
  children: ReactNode;
  as?: 'label' | 'div';
  style?: CSSProperties;
}) {
  const Tag = as;
  return (
    <Tag className="label" style={style}>
      {counter ? (
        <span className="label-row">
          <span>{label}</span>
          <span className="mono" style={{ fontWeight: 400 }}>
            {counter}
          </span>
        </span>
      ) : (
        <span className="label-text">{label}</span>
      )}
      {children}
      {error ? (
        <span className="err-text" style={{ display: 'block', marginTop: 4 }}>
          {error}
        </span>
      ) : null}
      {hint && !error ? (
        <span className="hint-sm" style={{ display: 'block', marginTop: 4 }}>
          {hint}
        </span>
      ) : null}
    </Tag>
  );
}

/* ───────── Сегментированный переключатель ───────── */

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** Сколько записей во вкладке — серым числом после надписи. */
  count?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  size?: 'xs';
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={'segmented' + (size === 'xs' ? ' segmented-xs' : '')}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
          {o.count !== undefined ? <span className="seg-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ───────── Перестановка строк ───────── */

export function MoveButtons({
  onUp,
  onDown,
  isFirst,
  isLast,
  size,
  extra,
}: {
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  size?: 'lg' | 'tall';
  extra?: ReactNode;
}) {
  const cls = 'btn-arrow' + (size === 'lg' ? ' btn-arrow-lg' : size === 'tall' ? ' btn-arrow-tall' : '');
  return (
    <span style={{ display: 'flex', gap: size === 'tall' ? 3 : size === 'lg' ? 4 : 2, alignSelf: size === 'tall' ? 'start' : undefined }}>
      <button type="button" className={cls} onClick={onUp} disabled={isFirst} aria-label="Выше">
        ▲
      </button>
      <button type="button" className={cls} onClick={onDown} disabled={isLast} aria-label="Ниже">
        ▼
      </button>
      {extra}
    </span>
  );
}

/* ───────── Пустое состояние ───────── */

export function EmptyState({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty" style={{ maxWidth: 560, margin: '30px auto' }}>
      {title ? <div className="empty-title">{title}</div> : null}
      <div style={{ marginBottom: action ? 16 : 0 }}>{children}</div>
      {action}
    </div>
  );
}

/* ───────── Диалог подтверждения ───────── */

export function ConfirmDialog({
  title,
  body,
  ok,
  danger,
  onOk,
  onCancel,
}: {
  title: string;
  body: string;
  ok: string;
  danger: boolean;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="scrim scrim-center" style={{ zIndex: 60 }}>
      <section className="dialog" style={{ width: 'min(440px, 100%)' }} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'btn'} onClick={onOk}>
            {ok}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ───────── Полоса сохранения ───────── */

/**
 * Правки формы ждут этой кнопки. Полоса липнет к низу экрана и появляется
 * только когда есть что сохранять — пустая строка внизу ничего не сообщает.
 */
export function SaveBar({ saving, onSave, onUndo }: { saving: boolean; onSave: () => void; onUndo: () => void }) {
  // Ctrl/⌘+S — привычка из любого редактора.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);

  return (
    <div className="savebar" role="region" aria-label="Несохранённые изменения">
      <span style={{ fontWeight: 600 }}>Несохранённые изменения</span>
      <span className="hint savebar-hint">Пока не сохраните, бот работает по-старому</span>
      <div className="grow" />
      <button type="button" className="btn-secondary" onClick={onUndo} disabled={saving}>
        Отменить
      </button>
      <button type="button" className="btn" onClick={onSave} disabled={saving}>
        {saving ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </div>
  );
}

/* ───────── Тост ───────── */

export function Toast({ text }: { text: string }) {
  return (
    <div role="status" className="toast">
      {text}
    </div>
  );
}

/* ───────── Полоса-индикатор ───────── */

export function Bar({ pct, color, height, radius }: { pct: number; color?: string; height?: number; radius?: 'pill' | 'sm' }) {
  return (
    <span className={'bar-track' + (radius === 'pill' ? ' bar-track-pill' : '')} style={{ height }}>
      <span className="bar-fill" style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: color }} />
    </span>
  );
}

/* ───────── Страницы ───────── */

/** Переключатель страниц. На одной странице не показывается. */
export function Pager({ page, pages, from, to, total, onPage }: PagerState) {
  if (pages <= 1) return null;

  return (
    <nav className="pager" aria-label="Страницы">
      <span className="sub">
        {from + 1}–{to} из {total}
      </span>
      <div className="grow" />
      <button type="button" className="btn-secondary btn-sm" onClick={() => onPage(page - 1)} disabled={page === 0}>
        Назад
      </button>
      <span className="sub nums" aria-live="polite">
        {page + 1} / {pages}
      </span>
      <button type="button" className="btn-secondary btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>
        Вперёд
      </button>
    </nav>
  );
}
