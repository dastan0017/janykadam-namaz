import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AddBotGuide, ChannelLinkField, CheckRow, CreateChannelSteps, LinkStatus } from '../components/ChannelGuide';
import { addBotToChannelUrl, channelLinkError } from '../lib/channel';
import { currentMarathon } from '../lib/derive';
import { useLinkCheck } from '../lib/useLinkCheck';
import { plural } from '../lib/format';
import { useActions, useAppState } from '../store/context';
import type { ChannelSummary, LinkCheck } from '../types';

/** Пока канал не настроен, проверяем часто: админ как раз жмёт кнопки в Telegram. */
const POLL_SETUP_MS = 4_000;
const POLL_DONE_MS = 30_000;

type StepState = 'done' | 'current' | 'todo';

/**
 * «Канал отчётов»: пошаговая настройка с живой проверкой каждого шага.
 *
 * Бот не умеет создавать каналы и добавлять туда людей — это делает админ, а
 * страница ведёт по шагам и сама видит, что уже сделано: опрашивает бэкенд,
 * а тот спрашивает у Telegram права бота и настройки канала.
 */
export function Channel() {
  const s = useAppState();
  const { loadChannel, saveChannelLink, connectChannel, disconnectChannel, go, toast } = useActions();
  const m = currentMarathon(s);
  const status = m ? s.channelStatus[m.id] : undefined;
  const ch: ChannelSummary | undefined = status ?? m?.channel;

  const [link, setLink] = useState(m?.channel.link ?? '');
  const [editing, setEditing] = useState(!m?.channel.link);
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [linkRes, setLinkRes] = useState<LinkCheck | null>(null);

  // Сохранённую ссылку тоже проверяем, пока бота в канале нет: вдруг это группа
  // или ссылку отозвали — тогда шаг 1 не пройден, и кнопка «добавить бота»
  // канала не покажет.
  const savedLink = m?.channel.link ?? '';
  const saved = useLinkCheck(savedLink, !!savedLink && !m?.channel.chatId && !editing);

  // Свежая функция загрузки без перезапуска опроса на каждом рендере.
  const load = useRef(loadChannel);
  load.current = loadChannel;

  const mid = m?.id;
  const allDone = !!ch?.ready && !!ch.protectedContent && !!ch.isPrivate;

  useEffect(() => {
    setLink(m?.channel.link ?? '');
    setEditing(!m?.channel.link);
    setTouched(false);
    // Только при смене марафона: дальше поле ведёт сам админ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mid]);

  useEffect(() => {
    if (!mid) return;
    let alive = true;
    const tick = async () => {
      setChecking(true);
      await load.current(mid).catch(() => undefined);
      if (alive) setChecking(false);
    };
    void tick();
    const timer = window.setInterval(tick, allDone ? POLL_DONE_MS : POLL_SETUP_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [mid, allDone]);

  if (!m || !ch) return <div className="empty">Марафон не выбран.</div>;

  const bot = s.bot.username;
  const finished = m.status === 'finished' || m.status === 'archive';
  const s2 = !!ch.chatId;
  const savedBad = !s2 && !!saved.res && !saved.res.ok;
  const s1 = !!ch.link && !savedBad;
  const s3 = ch.ready;
  const stateOf = (done: boolean, prevDone: boolean): StepState => (done ? 'done' : prevDone ? 'current' : 'todo');
  const doneCount = [s1, s2, s3].filter(Boolean).length;
  const linkErr = touched ? channelLinkError(link) || (linkRes && !linkRes.ok ? linkRes.message : '') : '';

  const save = async () => {
    setTouched(true);
    if (channelLinkError(link) || (linkRes && !linkRes.ok)) return;
    if (await saveChannelLink(link)) setEditing(false);
  };

  const copyBot = () => {
    void navigator.clipboard?.writeText(`@${bot}`).catch(() => {});
    toast(`Скопировано: @${bot}`);
  };

  const recheck = async () => {
    setChecking(true);
    await loadChannel(m.id).catch(() => undefined);
    setChecking(false);
  };

  return (
    <div className="channel-page">
      {/* Итог сверху: готово или сколько шагов осталось */}
      {s3 ? (
        <section className="card channel-hero channel-hero-ok">
          <div className="channel-hero-icon" aria-hidden="true">
            ✓
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="h-card">Канал «{ch.title || 'без названия'}» подключён</div>
            <div className="hint">
              Бот сам выкладывает туда каждый принятый видеоотчёт и впускает только участниц этого марафона.
              {status ? (
                <>
                  {' '}
                  В канале {status.counts.joined} из {status.counts.total}{' '}
                  {plural(status.counts.total, 'участницы', 'участниц', 'участниц')}, кнопку получили {status.counts.invited}.
                </>
              ) : null}
            </div>
          </div>
          <div className="channel-hero-actions">
            {ch.link ? (
              <a className="btn-secondary btn-sm" href={ch.link} target="_blank" rel="noreferrer">
                Открыть канал ↗
              </a>
            ) : null}
            <button type="button" className="btn-secondary btn-sm" style={{ color: 'var(--danger)' }} onClick={disconnectChannel}>
              Отвязать
            </button>
          </div>
        </section>
      ) : (
        <section className="card channel-hero channel-hero-todo">
          <div className="channel-hero-icon" aria-hidden="true">
            📺
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="h-card">
              {finished ? 'Канал не подключён' : 'Подключите канал отчётов — без него марафон не запустить'}
            </div>
            <div className="hint">
              В канале участницы видят видеоотчёты друг друга. Бот не может сам создать канал и добавить туда людей — это
              ограничение Telegram. Вы создаёте канал и добавляете бота, остальное он делает сам. Около двух минут.
            </div>
          </div>
          <div className="channel-progress" aria-label={`Готово шагов: ${doneCount} из 3`}>
            {[s1, s2, s3].map((d, i) => (
              <span key={i} className={'channel-progress-dot' + (d ? ' on' : '')} />
            ))}
            <span className="hint-sm">{doneCount} из 3</span>
          </div>
        </section>
      )}

      <ol className="steps">
        {/* ───────── 1. канал ───────── */}
        <Step n={1} state={stateOf(s1, true)} title="Создайте закрытый канал в Telegram — канал, не группу">
          {editing ? (
            <>
              {!ch.link || savedBad ? (
                <div className="guide-box">
                  <CreateChannelSteps />
                </div>
              ) : null}
              <ChannelLinkField value={link} onChange={setLink} onEnter={() => void save()} onResult={setLinkRes} />
              {linkErr && (!linkRes || linkRes.ok) ? <div className="err-text">{linkErr}</div> : null}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={() => void save()} disabled={!!linkRes && !linkRes.ok}>
                  Сохранить ссылку
                </button>
                {ch.link ? (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setLink(ch.link);
                      setEditing(false);
                      setTouched(false);
                    }}
                  >
                    Отмена
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="step-line">
                <span className="mono ellipsis" style={{ minWidth: 0 }}>
                  {ch.link}
                </span>
                {s2 ? (
                  <span className="hint-sm">Канал подключён — чтобы сменить его, сначала отвяжите.</span>
                ) : (
                  <button type="button" className="btn-link" onClick={() => setEditing(true)}>
                    {savedBad ? 'Вставить ссылку на канал' : 'Изменить'}
                  </button>
                )}
              </div>
              {!s2 ? <LinkStatus res={saved.res} busy={saved.busy} /> : null}
              {savedBad ? (
                <div className="guide-box">
                  <CreateChannelSteps />
                </div>
              ) : null}
            </>
          )}
        </Step>

        {/* ───────── 2. бот ───────── */}
        <Step n={2} state={stateOf(s2, s1)} title={`Добавьте бота @${bot || '…'} в канал администратором`}>
          {s2 ? (
            <div className="step-line">
              Бот в канале <b>«{ch.title || 'без названия'}»</b> — он уже написал туда первое сообщение.
            </div>
          ) : s1 ? (
            <>
              <AddBotGuide bot={bot} addUrl={bot ? addBotToChannelUrl(bot) : null} onCopy={copyBot} />

              {status?.candidates.length ? (
                <div className="candidate-box">
                  <div style={{ fontWeight: 600 }}>Бот уже добавлен, но ссылка не совпала</div>
                  <div className="hint">Так бывает, если вставлена не основная ссылка канала. Это ваш канал?</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {status.candidates.map((c) => (
                      <button key={c.chatId} type="button" className="btn btn-sm" onClick={() => connectChannel(c.chatId)}>
                        Да, подключить «{c.title || c.username || c.chatId}»
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <Waiting checking={checking} onCheck={recheck} text="Ждём бота в канале — страница проверяет сама каждые несколько секунд." />
              )}
            </>
          ) : (
            <div className="hint">Сначала вставьте ссылку на канал — именно канал, не группу.</div>
          )}
        </Step>

        {/* ───────── 3. права ───────── */}
        <Step n={3} state={stateOf(s3, s2)} title="Проверьте права бота">
          {s2 ? (
            <>
              <div className="checks">
                <CheckRow ok={ch.rights.admin} title="Бот — администратор канала" hint="Без этого бот ничего не может сделать в канале." />
                <CheckRow ok={ch.rights.post} title="Может публиковать сообщения" hint="Чтобы выкладывать видеоотчёты участниц." />
                <CheckRow ok={ch.rights.invite} title="Может приглашать подписчиков" hint="Чтобы впускать участниц по их заявкам." />
                {ch.rights.invite ? (
                  <CheckRow ok={!!ch.inviteLink} title="Ссылка для участниц создана" hint="Бот делает её сам сразу после прав. Подождите несколько секунд." />
                ) : null}
                <CheckRow
                  ok={ch.rights.restrict}
                  soft
                  title="Может удалять подписчиков"
                  hint="Чтобы убирать из канала тех, кого исключили из марафона."
                />
              </div>
              {!s3 ? (
                <div className="fix-box">
                  Как исправить: откройте канал → <b>✏️ Изменить</b> → <b>«Администраторы»</b> → <b>@{bot || 'бот'}</b> → включите права с
                  крестиком → <b>«Сохранить»</b>. Страница обновится сама.
                </div>
              ) : null}
            </>
          ) : (
            <div className="hint">Появится, когда бот будет в канале.</div>
          )}
        </Step>

        {/* ───────── 4. приватность ───────── */}
        <Step n={4} state={s3 ? (ch.protectedContent && ch.isPrivate ? 'done' : 'current') : 'todo'} title="Закройте видео от посторонних" optional>
          {s3 ? (
            <div className="checks">
              <CheckRow
                ok={ch.isPrivate}
                soft
                title="Канал частный"
                hint="Публичный канал найдёт и откроет кто угодно. ✏️ Изменить → «Тип канала» → «Частный»."
              />
              <CheckRow
                ok={ch.protectedContent}
                soft
                title="Копирование запрещено"
                hint="Видео участниц нельзя будет сохранить или переслать. ✏️ Изменить → «Тип канала» → включите «Запретить копирование»."
              />
            </div>
          ) : (
            <div className="hint">Сделаете после подключения бота — займёт полминуты.</div>
          )}
        </Step>

        {/* ───────── 5. что дальше ───────── */}
        <Step n={5} state={s3 ? 'done' : 'todo'} title="Готово — дальше всё делает бот">
          <div className="after-grid">
            <ul className="after-list">
              <li>
                Каждая участница после записи получит кнопку <b>«📺 Марафондун каналы»</b>. Кто записался раньше — получит её в течение
                минуты после подключения.
              </li>
              <li>Бот впускает в канал только участниц этого марафона. Остальным — вежливый отказ.</li>
              <li>Каждый принятый видеоотчёт появляется в канале с подписью — примерно так, как справа.</li>
              <li>Кого исключили из марафона, бот уберёт из канала.</li>
            </ul>
            <PostPreview lang={m.lang} />
          </div>
          <button
            type="button"
            className="btn-link"
            onClick={() => go('texts', { textKey: 'channel_report_caption', textQ: '', textUntr: false })}
          >
            Изменить подпись под видео →
          </button>
        </Step>
      </ol>

      {status ? (
        <div className="hint-sm" style={{ textAlign: 'right' }}>
          Проверено в {new Date(status.checkedAt).toLocaleTimeString('ru-RU')}
          {checking ? ' · проверяю…' : ''}
        </div>
      ) : null}
    </div>
  );
}

function Step({
  n,
  state,
  title,
  optional,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <div className="step-num" aria-hidden="true">
        {state === 'done' ? '✓' : n}
      </div>
      <div className="step-body">
        <div className="step-title">
          {title}
          {optional ? <span className="tag-outline">рекомендуется</span> : null}
          {state === 'done' ? <span className="sr-only"> — готово</span> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function Waiting({ checking, onCheck, text }: { checking: boolean; onCheck: () => void; text: string }) {
  return (
    <div className="waiting" role="status">
      <span className={'waiting-dot' + (checking ? ' on' : '')} aria-hidden="true" />
      <span style={{ flex: 1 }}>{text}</span>
      <button type="button" className="btn-secondary btn-xs" onClick={onCheck} disabled={checking}>
        {checking ? 'Проверяю…' : 'Проверить сейчас'}
      </button>
    </div>
  );
}

/** Как будет выглядеть пост в канале: видео и подпись из текстов бота. */
function PostPreview({ lang }: { lang: 'kg' | 'ru' }) {
  const s = useAppState();
  const row = s.texts.find((t) => t.key === 'channel_report_caption');
  const tpl = (lang === 'ru' ? row?.ru || row?.kg : row?.kg || row?.ru) ?? '🎥 {тема}\n👤 {имя}\n📍 {город}';
  const caption = tpl
    .replace(/\{тема\}/g, '🌅 Багымдат')
    .replace(/\{имя\}/g, 'Айгүл Бейшенова')
    .replace(/\{город\}/g, 'Бишкек')
    .replace(/\{день\}/g, '3');

  return (
    <figure className="tg-post" aria-label="Пример поста в канале">
      <div className="tg-post-video" aria-hidden="true">
        <span className="tg-post-circle">
          <span className="tg-post-play">▶</span>
        </span>
        <span className="tg-post-dur">0:24</span>
      </div>
      <figcaption className="tg-post-caption">{caption}</figcaption>
    </figure>
  );
}
