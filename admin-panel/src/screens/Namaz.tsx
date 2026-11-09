import { LockIcon } from '../components/ui';
import { ICONS, NAMAZ, TZ, TZ_ORDER } from '../data/constants';
import { currentData } from '../lib/derive';
import { plural } from '../lib/format';
import { fmt } from '../lib/time';
import { useAppState } from '../store/context';

const TZ_COLS = 'minmax(170px,1.6fr) repeat(7, minmax(58px,1fr)) 80px';
const LIB_COLS = 'minmax(160px,1.3fr) minmax(200px,1.6fr) 60px 70px 150px';

const FACTS = [
  { k: 'Источник', v: 'Aladhan API', note: 'бесплатный, без ключа' },
  { k: 'Метод', v: 'ДУМ России (№ 14)', note: 'Фаджр 16°, Иша 15°' },
  { k: 'Аср', v: 'Ханафитский мазхаб', note: 'параметр school=1' },
  { k: 'Обновление', v: 'Раз в месяц на 30 дней', note: 'хранится на сервере — бот не ждёт API' },
];

export function Namaz() {
  const s = useAppState();
  const d = currentData(s);

  return (
    <div style={{ maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={{ background: 'var(--sage-panel)', border: '1px solid var(--sage-bar)', borderRadius: 'var(--r-lg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none', marginTop: 1, fill: 'none', stroke: 'var(--sage-text)', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d={ICONS.namaz} />
          </svg>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#2e3a1f' }}>Время намазов считается само</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--sage-deep)', marginTop: 2 }}>
              При регистрации участница выбирает часовой пояс (позже может сменить командой /zona). Каждый день бот берёт время намазов для этого места — вручную ничего вводить не нужно.
              Темы-намазы и правила их окон одинаковые во всех марафонах и не редактируются.
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
          {FACTS.map((f) => (
            <div key={f.k} style={{ background: 'var(--card)', border: '1px solid var(--sage-bar)', borderRadius: 'var(--r-sm)', padding: '8px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sage-text)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{f.k}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{f.v}</div>
              <div className="hint-sm">{f.note}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card-scroll">
        <div style={{ padding: '12px 14px' }}>
          <div className="h-card">Сегодня, 8 ноября — по местному времени</div>
          <div className="hint">
            Эти пояса участница видит кнопками при регистрации. Каждый привязан к городу, потому что время намаза зависит от места, а не только от пояса: Бишкек и Ош в одном поясе, но
            расходятся на 5–15 минут.
          </div>
        </div>
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: TZ_COLS, gap: 8, padding: '8px 14px', minWidth: 860, borderTop: '1px solid var(--line-soft)' }}>
          <span>Пояс</span>
          <span>Тахажуд</span>
          <span>Багымдат</span>
          <span>Восход</span>
          <span>Пешим</span>
          <span>Аср</span>
          <span>Шам</span>
          <span>Куптан</span>
          <span style={{ textAlign: 'right' }}>В марафоне</span>
        </div>
        {TZ_ORDER.map((k) => {
          const z = TZ[k];
          const n = d.participants.filter((p) => p.tz === k && p.status !== 'left').length;
          return (
            <div
              key={k}
              className="nums"
              style={{ display: 'grid', gridTemplateColumns: TZ_COLS, gap: 8, padding: '9px 14px', borderTop: '1px solid var(--line-soft)', fontSize: 13, alignItems: 'center', minWidth: 860 }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, display: 'block' }}>
                  {z.city} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{z.utc}</span>
                </span>
                <span className="hint-sm">{z.note}</span>
              </span>
              <span>{fmt(z.pt.fajr - 150)}</span>
              <span>{fmt(z.pt.fajr)}</span>
              <span style={{ color: 'var(--muted)' }}>{fmt(z.pt.sunrise)}</span>
              <span>{fmt(z.pt.dhuhr)}</span>
              <span>{fmt(z.pt.asr)}</span>
              <span>{fmt(z.pt.maghrib)}</span>
              <span>{fmt(z.pt.isha)}</span>
              <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{n || '—'}</span>
            </div>
          );
        })}
      </section>

      <section className="card-scroll">
        <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="h-card">Темы-намазы</div>
            <div className="hint">В марафоне их только включают или выключают — на странице «Темы» марафона.</div>
          </div>
          <span className="tag-fixed" style={{ padding: '2px 9px' }}>
            <LockIcon />
            не редактируются
          </span>
        </div>
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: LIB_COLS, gap: 10, padding: '8px 14px', minWidth: 700, borderTop: '1px solid var(--line-soft)' }}>
          <span>Тема</span>
          <span>Окно сдачи</span>
          <span>Баллы</span>
          <span>Обяз.</span>
          <span>Используется</span>
        </div>
        {NAMAZ.map((n) => {
          const used = s.marathons.filter((x) => (s.data[x.id]?.namaz ?? []).includes(n.id)).length;
          return (
            <div key={n.id} style={{ display: 'grid', gridTemplateColumns: LIB_COLS, gap: 10, padding: '9px 14px', borderTop: '1px solid var(--line-soft)', fontSize: 13, alignItems: 'center', minWidth: 700 }}>
              <span>
                <span style={{ fontWeight: 600 }}>
                  {n.emoji} {n.nameKg}
                </span>{' '}
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{n.nameRu}</span>
              </span>
              <span style={{ color: 'var(--ink-3)' }}>{n.rule}</span>
              <span className="nums">{n.points}</span>
              <span>{n.mandatory ? 'да' : '—'}</span>
              <span className="sub">
                в {used} из {s.marathons.length} {plural(s.marathons.length, 'марафона', 'марафонов', 'марафонов')}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
