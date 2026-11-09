import { currentData, segments } from '../lib/derive';
import { plural } from '../lib/format';
import { buildPreview } from '../lib/preview';
import { useActions, useAppState } from '../store/context';

export function Broadcasts() {
  const s = useAppState();
  const { set, setBc, send } = useActions();
  const segs = segments(s);
  const seg = segs.find((x) => x.id === s.bc.seg) ?? segs[0];
  const n = seg ? seg.list.length : 0;
  const nLabel = `${n} ${plural(n, 'участница', 'участницы', 'участниц')}`;
  const pv = buildPreview(s);
  const history = currentData(s).broadcasts;
  const { stage, result } = s.bc;

  // ~30 сообщений в секунду — на 500 человек это ≈17 секунд, мгновенно не бывает
  const est = n <= 30 ? 'около секунды' : Math.ceil(n / 30) + ' сек';

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {stage === 'compose' ? (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="label">
            <span className="label-row">
              <span>Сообщение</span>
              <span className="mono" style={{ fontWeight: 400 }}>
                {s.bc.text.length} / 4096
              </span>
            </span>
            <textarea rows={5} className="textarea" value={s.bc.text} onChange={(e) => setBc('text', e.target.value)} />
          </label>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="hint">Подставить:</span>
            {['{имя}', '{баллы}', '{марафон}'].map((ph) => (
              <button key={ph} type="button" className="btn-secondary mono" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setBc('text', s.bc.text + ph)}>
                {ph}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <label className="label">
              <span className="label-text">Кому</span>
              {/* Число получателей считается по текущим данным участниц */}
              <select className="select select-white" value={seg?.id ?? 'all'} onChange={(e) => setBc('seg', e.target.value)}>
                {segs.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} — {x.list.length}
                  </option>
                ))}
              </select>
              <span className="hint-sm" style={{ display: 'block', marginTop: 4 }}>
                Считается по текущим данным участниц. Вышедшие и заблокировавшие бота не получат.
              </span>
            </label>

            <div>
              <span className="label-text">Когда</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['now', 'later'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={s.bc.when === w}
                    onClick={() => setBc('when', w)}
                    style={{
                      flex: 1, border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '7px 12px',
                      background: s.bc.when === w ? 'var(--ink)' : 'var(--card)',
                      color: s.bc.when === w ? 'var(--card)' : 'var(--ink)', fontWeight: 600,
                    }}
                  >
                    {w === 'now' ? 'Сейчас' : 'Завтра 09:00'}
                  </button>
                ))}
              </div>
              <span className="hint-sm" style={{ display: 'block', marginTop: 4 }}>
                «Завтра 09:00» — по местному времени каждой участницы.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" style={{ padding: '9px 18px' }} onClick={() => setBc('stage', 'confirm')} disabled={!s.bc.text.trim() || n === 0}>
              Отправить — {nLabel}
            </button>
          </div>
        </section>
      ) : null}

      {stage === 'confirm' ? (
        <section className="card" style={{ borderColor: 'var(--accent)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Подтвердите рассылку</div>
          <div style={{ lineHeight: 1.6 }}>
            Получат <b>{nLabel}</b>. Telegram пропускает около 30 сообщений в секунду, поэтому отправка займёт <b>{est}</b> (≈ 17 сек на 500 человек). Отменить после старта нельзя.
          </div>
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--r-sm)', padding: 10, whiteSpace: 'pre-wrap', fontSize: 13 }}>{pv?.text}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => setBc('stage', 'compose')}>
              Назад
            </button>
            <button type="button" className="btn" onClick={send}>
              Да, отправить
            </button>
          </div>
        </section>
      ) : null}

      {stage === 'sending' ? (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="h-card">
            Отправляется… {s.bc.sent} из {s.bc.total ?? n}
          </div>
          <div style={{ background: 'var(--line-soft)', borderRadius: 'var(--r-pill)', height: 8, overflow: 'hidden' }}>
            <div style={{ height: 8, borderRadius: 'var(--r-pill)', background: 'var(--accent)', width: (s.bc.total ? (s.bc.sent / s.bc.total) * 100 : 0) + '%', transition: 'width .2s' }} />
          </div>
          <div className="sub">Можно уйти с экрана — отправка продолжится на сервере.</div>
        </section>
      ) : null}

      {stage === 'done' && result ? (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Рассылка завершена</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div className="tile">
              <div className="tile-label">Получателей</div>
              <div className="tile-value">{result.count}</div>
            </div>
            <div className="tile" style={{ background: 'var(--sage-soft)' }}>
              <div className="tile-label" style={{ color: 'var(--sage-deep)' }}>
                Доставлено
              </div>
              <div className="tile-value" style={{ color: 'var(--sage-deep)' }}>
                {result.delivered}
              </div>
            </div>
            <div className="tile" style={{ background: 'var(--danger-soft)' }}>
              <div className="tile-label" style={{ color: 'var(--danger-text)' }}>
                Заблокировали бота
              </div>
              <div className="tile-value" style={{ color: 'var(--danger-text)' }}>
                {result.blocked}
              </div>
            </div>
          </div>
          {result.blocked ? (
            <div className="sub">Не получили: {result.blockedNames}. Бот не может написать тем, кто его заблокировал — куратору стоит связаться с ними иначе.</div>
          ) : null}
          <div>
            <button type="button" className="btn-secondary" onClick={() => set((prev) => ({ bc: { ...prev.bc, stage: 'compose', result: null, sent: 0, text: '' } }))}>
              Новая рассылка
            </button>
          </div>
        </section>
      ) : null}

      <section>
        <div className="overline" style={{ marginBottom: 8 }}>
          Прошлые рассылки
        </div>
        <div className="card-flush">
          {history.map((h) => (
            <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 200px', gap: 12, padding: '10px 12px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5 }}>
              <span style={{ color: 'var(--muted)' }}>{h.at}</span>
              <span className="ellipsis">{h.text}</span>
              <span style={{ color: 'var(--muted)' }}>
                {h.seg} · {h.delivered} из {h.count} доставлено
                {h.blocked ? ` · ${h.blocked} заблокировали бота` : ''}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
