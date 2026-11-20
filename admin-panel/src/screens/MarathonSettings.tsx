import { Field } from '../components/ui';
import { TZ, TZ_ORDER } from '../data/constants';
import { currentMarathon } from '../lib/derive';
import { useActions, useAppState } from '../store/context';
import type { Lang } from '../types';

export function MarathonSettings() {
  const s = useAppState();
  const { go, setM, copyLink, toast } = useActions();
  const m = currentMarathon(s);
  if (!m) return <div className="empty">Марафон не выбран.</div>;

  const link = `https://t.me/${s.bot.username}?start=${m.code}`;
  const dateErr = m.status === 'draft' && m.start < '2026-11-08' ? 'Дата начала уже прошла — марафон нельзя запустить' : m.end < m.start ? 'Окончание раньше начала' : '';

  return (
    <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label="Название" style={{ gridColumn: '1/-1' }}>
          <input type="text" className="input" value={m.name} onChange={(e) => setM('name', e.target.value)} />
        </Field>
        <Field label="Начало">
          <input type="date" className="input" value={m.start} onChange={(e) => setM('start', e.target.value)} />
        </Field>
        <Field label="Окончание">
          <input type="date" className="input" value={m.end} onChange={(e) => setM('end', e.target.value)} />
        </Field>
        {dateErr ? (
          <div className="err-text" style={{ gridColumn: '1/-1', fontSize: 12.5 }}>
            {dateErr}
          </div>
        ) : null}
        <label className="check-label check-label-top" style={{ gridColumn: '1/-1', gap: 10 }}>
          <input type="checkbox" className="check" checked={m.regOpen} onChange={(e) => setM('regOpen', e.target.checked)} />
          <span>
            <span style={{ fontWeight: 600 }}>Регистрация открыта</span>
            <br />
            <span className="hint">Пока закрыта, переход по ссылке показывает «Набор закрыт» и предлагает подписаться на следующий марафон.</span>
          </span>
        </label>
      </section>

      {/* Deep link + QR: бот не может написать первым, участница должна сама нажать «Старт» */}
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px', gap: 16, alignItems: 'center' }}>
        <div>
          <div className="h-card" style={{ marginBottom: 4 }}>
            Ссылка для входа
          </div>
          <div className="mono" style={{ fontSize: 13, background: 'var(--bg)', borderRadius: 'var(--r-sm)', padding: '8px 10px', wordBreak: 'break-all' }}>
            {link}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Ставьте её в био Instagram. Бот не может написать первым — участница должна сама нажать «Старт». Код <b>{m.code}</b> в ссылке говорит боту, в какой марафон записать.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => copyLink(m.id)}>
              Скопировать
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => toast('QR-код со ссылкой скачан (PNG)')}>
              Скачать QR (PNG)
            </button>
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            width: 120, height: 120, borderRadius: 'var(--r-md)',
            background: 'repeating-linear-gradient(90deg,#201e1d 0 6px,transparent 6px 12px), repeating-linear-gradient(0deg,#201e1d 0 6px,#fdf9f2 6px 12px)',
            backgroundBlendMode: 'screen', border: '6px solid var(--card)', outline: '1px solid var(--line)',
            display: 'flex', alignItems: 'end', justifyContent: 'center',
          }}
        >
          <span className="mono" style={{ background: 'var(--card)', fontSize: 10, padding: '1px 4px' }}>
            QR · {m.code}
          </span>
        </div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="h-card">Регистрация и старт</div>
          <div className="hint">Что происходит после перехода по ссылке. Сообщения бота — в превью справа.</div>
        </div>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <li style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
            <span style={{ width: 24, height: 24, borderRadius: 'var(--r-pill)', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
              1
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>Язык</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                <label className="sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  Первое сообщение на{' '}
                  <select className="select select-white" style={{ width: 'auto', padding: '5px 8px' }} value={m.lang} onChange={(e) => setM('lang', e.target.value as Lang)}>
                    <option value="kg">кыргызском</option>
                    <option value="ru">русском</option>
                  </select>
                </label>
                <span className="hint">дальше участница выбирает сама</span>
              </div>
            </div>
          </li>
          <li style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
            <span style={{ width: 24, height: 24, borderRadius: 'var(--r-pill)', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
              2
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>Часовой пояс</div>
              <div className="sub" style={{ margin: '2px 0 6px', lineHeight: 1.5 }}>
                По нему бот сам считает время намазов. Список общий для всех марафонов —{' '}
                <button type="button" className="btn-link" onClick={() => go('namaz')}>
                  «Время намазов»
                </button>
                .
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TZ_ORDER.map((k) => (
                  <span key={k} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '3px 10px', fontSize: 12, background: '#fff' }}>
                    {TZ[k].city} · {TZ[k].utc}
                  </span>
                ))}
              </div>
            </div>
          </li>
          <li style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
            <span style={{ width: 24, height: 24, borderRadius: 'var(--r-pill)', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
              3
            </span>
            <div>
              <div style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                Старт сразу <span className="tag-new" style={{ padding: '1px 8px', fontSize: 11.5 }}>всегда</span>
              </div>
              <div className="sub" style={{ marginTop: 2, lineHeight: 1.5 }}>
                Бот тут же показывает, какие отчёты открыты прямо сейчас по её времени, и принимает первый видеокружок. Серия и баллы начинаются с этого отчёта — ждать следующего дня не нужно.
              </div>
            </div>
          </li>
        </ol>
      </section>

      {/* Правила — часть входа: без согласия участница в марафон не попадает */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="h-card">Правила марафона</div>
          <div className="hint">
            Бот показывает их по ссылке до записи и ждёт «Согласна» — без этого участницы в марафоне не будет. Оставьте поля пустыми, и покажутся общие
            правила для всех марафонов: они лежат в «Текстах бота» под ключом <span className="mono">marathon_rules</span>.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          <Field label="Кыргызча" counter={`${m.rulesKg.length} / 4096`}>
            <textarea
              rows={8}
              className="textarea"
              value={m.rulesKg}
              onChange={(e) => setM('rulesKg', e.target.value)}
              placeholder="Пусто — общие правила"
            />
          </Field>
          <Field label="По-русски" counter={`${m.rulesRu.length} / 4096`}>
            <textarea
              rows={8}
              className="textarea"
              value={m.rulesRu}
              onChange={(e) => setM('rulesRu', e.target.value)}
              placeholder="Пусто — общие правила"
            />
          </Field>
        </div>
        {m.rulesKg || m.rulesRu ? (
          <div className="hint-sm">Свои правила у этого марафона. Если заполнен только один язык, на втором покажутся эти же.</div>
        ) : null}
      </section>

      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ gridColumn: '1/-1' }} className="h-card">
          Баллы и серии
        </div>
        <Field label="Баллы за отчёт по умолчанию" hint="Подставляется в новые свои темы. У намазов баллы фиксированы.">
          <input type="number" className="input" value={m.pointsDefault} onChange={(e) => setM('pointsDefault', Number(e.target.value))} />
        </Field>
        <div>
          <span className="label-text">Бонус за серию</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="number" className="input" style={{ width: 70 }} value={m.streakBonus} onChange={(e) => setM('streakBonus', Number(e.target.value))} aria-label="Бонус за серию, баллы" />
            <span style={{ fontSize: 12.5 }}>б. каждые</span>
            <input type="number" className="input" style={{ width: 60 }} value={m.streakEvery} onChange={(e) => setM('streakEvery', Number(e.target.value))} aria-label="Каждые сколько дней" />
            <span style={{ fontSize: 12.5 }}>дн.</span>
          </div>
          <span className="hint-sm" style={{ display: 'block', marginTop: 4 }}>
            Серия — дни со всеми обязательными темами.
          </span>
        </div>
        <Field label="Поздних сдач на марафон" hint="Столько раз можно сдать после закрытия окна до конца дня без потери серии.">
          <input type="number" className="input" value={m.latePasses} onChange={(e) => setM('latePasses', Number(e.target.value))} />
        </Field>
        <Field label="Уважительных дней" hint="Куратор отмечает их вручную; серия не прерывается, баллов нет.">
          <input type="number" className="input" value={m.excused} onChange={(e) => setM('excused', Number(e.target.value))} />
        </Field>
        <label className="check-label check-label-top" style={{ gridColumn: '1/-1', gap: 10 }}>
          <input type="checkbox" className="check" checked={m.pauseAllowed} onChange={(e) => setM('pauseAllowed', e.target.checked)} />
          <span>
            <span style={{ fontWeight: 600 }}>Участница может поставить себя на паузу (/pauza)</span>
            <br />
            <span className="hint">На паузе не приходят напоминания и не считаются пропуски — например, в дни, когда намаз не совершается.</span>
          </span>
        </label>
      </section>

      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <div className="h-card">Напоминания марафона</div>
          <div className="hint">По местному времени каждой участницы.</div>
        </div>
        <Field label="Утреннее">
          <input type="time" className="input" value={m.remindMorning} onChange={(e) => setM('remindMorning', e.target.value)} />
        </Field>
        <Field label="Вечернее — что не сдано">
          <input type="time" className="input" value={m.remindEvening} onChange={(e) => setM('remindEvening', e.target.value)} />
        </Field>
        <label className="check-label check-label-top" style={{ gridColumn: '1/-1', gap: 10 }}>
          <input type="checkbox" className="check" checked={m.skipSubmitted} onChange={(e) => setM('skipSubmitted', e.target.checked)} />
          <span>
            <span style={{ fontWeight: 600 }}>Не напоминать тем, кто уже сдал</span>
            <br />
            <span className="hint">Тихие часы и лимит сообщений в день — общие для всех марафонов, они в «Настройках бота».</span>
          </span>
        </label>
      </section>
    </div>
  );
}
