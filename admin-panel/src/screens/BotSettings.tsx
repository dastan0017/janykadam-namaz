import { Field } from '../components/ui';
import { useActions, useAppState } from '../store/context';

/** Глобальные настройки бота: он один на все марафоны, поэтому их нельзя развести по марафонам. */
export function BotSettings() {
  const s = useAppState();
  const { set, setBot, saveBotName } = useActions();
  const bot = s.bot;
  const editing = s.botDraft !== null;


  return (
    <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="banner-warn" style={{ borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13 }}>
        Бот один на все марафоны ({s.marathons.map((x) => x.name).join(', ')}). Имя, описание, команды и аватар общие — их нельзя сделать разными для разных марафонов.
      </div>

      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <Field label="Username — только через @BotFather" hint="API не умеет менять username. Смена сломает все ссылки в био.">
          <input type="text" className="input" value={'@' + bot.username} disabled />
        </Field>

        <div>
          <span className="label-text">Аватар — только через @BotFather</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 'var(--r-pill)', background: 'repeating-linear-gradient(135deg,#ebddc5 0 6px,#e2d2b5 6px 12px)' }} />
            <span className="hint-sm">Загружается в BotFather командой /setuserpic.</span>
          </div>
        </div>

        {/* Смена имени ограничена Telegram по частоте — поэтому это не живое поле */}
        <div style={{ gridColumn: '1/-1' }}>
          <span className="label-text">Имя бота — меняется через API с подтверждением</span>
          {editing ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                className="input"
                style={{ borderColor: 'var(--accent)', flex: 1, minWidth: 200, width: 'auto' }}
                value={s.botDraft ?? ''}
                onChange={(e) => set({ botDraft: e.target.value })}
                maxLength={64}
                aria-label="Имя бота"
              />
              <button type="button" className="btn-secondary" onClick={() => set({ botDraft: null })}>
                Отмена
              </button>
              <button type="button" className="btn" onClick={saveBotName}>
                Сохранить…
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{bot.name}</span>
              <button type="button" className="btn-secondary btn-xs" onClick={() => set({ botDraft: bot.name })}>
                Изменить
              </button>
            </div>
          )}
          <span className="hint-sm" style={{ display: 'block', marginTop: 4 }}>
            Telegram ограничивает частоту смены имени, поэтому это не живое поле: изменение подтверждается отдельно.
          </span>
        </div>

        <Field label="Описание («Что умеет бот»)" counter={`${bot.desc.length} / 512`}>
          <textarea rows={3} className="textarea" value={bot.desc} onChange={(e) => setBot({ desc: e.target.value })} />
        </Field>
        <Field label="Короткое описание (в профиле)" counter={`${bot.shortDesc.length} / 120`}>
          <textarea rows={3} className="textarea" value={bot.shortDesc} onChange={(e) => setBot({ shortDesc: e.target.value })} />
        </Field>
        <Field label="Команды меню" style={{ gridColumn: '1/-1' }}>
          <textarea rows={6} className="textarea mono" style={{ fontSize: 12.5 }} value={bot.commands} onChange={(e) => setBot({ commands: e.target.value })} />
        </Field>

        <div style={{ gridColumn: '1/-1' }}>
          <span className="label-text" style={{ marginBottom: 6 }}>
            Кнопки под полем ввода
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {bot.menu.map((t, i) => (
              <span key={i} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>
                {t}
              </span>
            ))}
          </div>
          <span className="hint-sm" style={{ display: 'block', marginTop: 6 }}>
            «Кадамдар» и «Командам» убраны из бота. Отчёт — только видеокружок: на фото, видео или текст бот ответит подсказкой, как записать кружок.
          </span>
        </div>
      </section>

      {/* Решение по участнице в двух марафонах — здесь, а не в настройках марафона: чат у неё один */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="h-card">Участница в двух марафонах</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>
          Бот держит <b>один активный марафон</b> на участницу. Переход по ссылке нового марафона переключает контекст на него; вернуться можно командой /marafon или кнопкой в меню. Все
          отчёты и /otchet относятся к активному марафону. Напоминания приходят от обоих, но каждое начинается с метки{' '}
          <span className="mono" style={{ background: 'var(--bg)', padding: '0 4px', borderRadius: 4 }}>
            [Үммөттүн кызы]
          </span>
          , а отправить отчёт по чужому напоминанию можно одним нажатием — кнопка в нём сама переключает контекст.
        </div>
        <div className="hint">Почему не спрашивать каждый раз: лишний шаг на каждом из 6–8 отчётов в день. Почему не два параллельных чата: у одного бота один чат.</div>
      </section>

      {/* Тихие часы и лимит — глобальные, потому что чат у участницы один */}
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <div className="h-card">Защита от потока сообщений</div>
          <div className="hint">Общие для всех марафонов, потому что чат у участницы один. Время — местное для каждой участницы.</div>
        </div>
        <Field label="Тихие часы с">
          <input type="time" className="input" value={bot.quietFrom} onChange={(e) => setBot({ quietFrom: e.target.value })} />
        </Field>
        <Field label="до" hint="Окно «Тахажуд» открывается ночью и попадает в тихие часы — напоминание о нём уйдёт только тем, кто включила его сама.">
          <input type="time" className="input" value={bot.quietTo} onChange={(e) => setBot({ quietTo: e.target.value })} />
        </Field>
        <Field label="Не больше напоминаний в день" hint="Сверх лимита напоминания склеиваются в одно вечернее. Рассылки в лимит не входят.">
          <input type="number" className="input" value={bot.capPerDay} onChange={(e) => setBot({ capPerDay: Number(e.target.value) })} />
        </Field>
      </section>
    </div>
  );
}
