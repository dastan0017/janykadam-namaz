import { buildPreview } from '../lib/preview';
import { useActions, useAppState } from '../store/context';
import type { Lang } from '../types';
import { Segmented } from './ui';

/**
 * «Что получит участница» — компонент дизайн-системы панели, а не имитация телефона.
 * Показывает структуру и лимиты: текст со счётчиком против 4096, кнопки стопкой,
 * сценарий, «когда и кому», переключатель КГ/РУ и предупреждения.
 */
export function PreviewRail() {
  const s = useAppState();
  const { set } = useActions();
  const pv = buildPreview(s);
  if (!pv) return null;

  return (
    <aside className="rail">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div className="overline">Что получит участница</div>
        <Segmented
          size="xs"
          ariaLabel="Язык превью"
          value={s.pvLang}
          onChange={(id: Lang) => set({ pvLang: id })}
          options={[
            { id: 'kg', label: 'КГ' },
            { id: 'ru', label: 'РУ' },
          ]}
        />
      </div>

      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{pv.title}</div>

      <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="overline">Текст сообщения</span>
          <span className="mono" style={{ fontSize: 11.5, color: pv.over ? 'var(--danger)' : 'var(--muted)', fontWeight: pv.over ? 700 : 400 }}>
            {pv.lenLabel}
          </span>
        </div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.5, wordBreak: 'break-word' }}>{pv.text}</div>

        {pv.buttons.length ? (
          <>
            <div className="overline">Кнопки</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pv.buttons.map((b, i) =>
                b.hint ? (
                  <div key={i} style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                    {b.hint}
                  </div>
                ) : (
                  <div
                    key={i}
                    className={'preview-btn' + (i >= 8 ? ' preview-btn-over' : '') + (pv.ugly ? ' preview-btn-ugly' : '')}
                    title={b.cb ? `callback_data: ${b.cb} (${b.cb.length} байт из 64)` : undefined}
                  >
                    <span>{b.text}</span>
                    <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{b.pts !== undefined ? b.pts + ' б.' : ''}</span>
                  </div>
                ),
              )}
            </div>
          </>
        ) : null}

        {pv.steps.length ? (
          <>
            <div className="overline">Сценарий</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pv.steps.map((x, i) =>
                x.k === 'step' ? (
                  <div key={i} style={{ fontSize: 12.5, paddingTop: 4, color: 'var(--ink-2)' }}>
                    {x.text}
                  </div>
                ) : x.k === 'btn' ? (
                  <div key={i} className={'preview-step' + (x.hot ? ' preview-step-hot' : '')}>
                    <span>{x.text}</span>
                    <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{x.pts !== undefined ? x.pts + ' б.' : ''}</span>
                  </div>
                ) : (
                  <div key={i} style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginLeft: 14 }}>
                    {x.text}
                  </div>
                ),
              )}
            </div>
          </>
        ) : null}
      </div>

      {s.screen === 'topicEditor' ? (
        <label className="check-label" style={{ fontSize: 12.5, marginTop: 10 }}>
          <input type="checkbox" className="check" checked={s.pvDone} onChange={(e) => set({ pvDone: e.target.checked })} /> Как видит уже сдавшая участница
        </label>
      ) : null}

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        <span style={{ fontWeight: 700, color: 'var(--ink-3)' }}>Когда и кому.</span> {pv.when}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{pv.twoPrefix}</div>

      {pv.warns.length ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pv.warns.map((w, i) => (
            <div key={i} className="banner-warn">
              {w}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
