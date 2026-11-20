import { useEffect, useRef } from 'react';
import { useLinkCheck } from '../lib/useLinkCheck';
import type { LinkCheck } from '../types';

/**
 * Инструкции и поле ссылки для канала отчётов — общие для формы нового
 * марафона и страницы «Канал отчётов».
 *
 * Названия кнопок Telegram даны по-русски и в скобках по-английски: админы
 * пользуются обеими версиями, а кнопку ищут по тому, что видят на экране.
 */

/** Канал, а не группа: ссылки у них одинаковые, а бот работает только с каналом. */
export function ChannelVsGroup() {
  return (
    <div className="cvg" role="note" aria-label="Нужен канал, а не группа">
      <div className="cvg-card cvg-yes">
        <div className="cvg-head">
          <span className="cvg-mark" aria-hidden="true">
            ✓
          </span>
          Нужен канал
        </div>
        <ul>
          <li>
            ✏️ → <b>«Новый канал»</b> <span className="cvg-en">(New Channel)</span>
          </li>
          <li>
            люди в нём — <b>«подписчики»</b> <span className="cvg-en">(subscribers)</span>
          </li>
          <li>
            в списке чатов: <i>«Канал создан»</i> <span className="cvg-en">(Channel created)</span>
          </li>
        </ul>
      </div>
      <div className="cvg-card cvg-no">
        <div className="cvg-head">
          <span className="cvg-mark" aria-hidden="true">
            ✕
          </span>
          Не группа
        </div>
        <ul>
          <li>
            «Новая группа» <span className="cvg-en">(New Group)</span> не подойдёт
          </li>
          <li>
            люди в ней — «участники» <span className="cvg-en">(members)</span>
          </li>
          <li>
            в списке чатов: <i>«Вы создали группу»</i> <span className="cvg-en">(You created the group)</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Как создать канал — по шагам. */
export function CreateChannelSteps() {
  return (
    <>
      <ChannelVsGroup />
      <ol className="guide-list">
        <li>
          В Telegram нажмите <b>✏️</b> (кнопка над списком чатов) → <b>«Новый канал»</b> <span className="cvg-en">(New Channel)</span>. Не «Новая
          группа»!
        </li>
        <li>
          Название — например <b>«Үммөттүн кызы — отчёттор»</b>. Описание и фото можно пропустить.
        </li>
        <li>
          Тип канала — <b>«Частный»</b> <span className="cvg-en">(Private)</span>. Telegram покажет ссылку вида{' '}
          <span className="mono">t.me/+AbCd…</span> — <b>скопируйте её</b>.
        </li>
        <li>
          На шаге «Добавить подписчиков» <span className="cvg-en">(Add Subscribers)</span> нажмите <b>«Пропустить»</b>{' '}
          <span className="cvg-en">(Skip)</span>: участниц впустит бот.
        </li>
        <li>Вставьте ссылку сюда — панель сразу проверит, что это канал, и покажет его название.</li>
      </ol>
      <div className="hint">
        Потеряли ссылку? Откройте канал → нажмите на его название → ссылка вида <span className="mono">t.me/+…</span> в карточке канала
        <span className="cvg-en"> (Invite Link)</span>.
      </div>
    </>
  );
}

/* ───────── проверка ссылки на лету ───────── */

/** Строка под полем: «проверяю», «✓ канал», «✕ группа». */
export function LinkStatus({ res, busy }: { res: LinkCheck | null; busy: boolean }) {
  if (busy) {
    return (
      <div className="link-status link-status-busy" role="status">
        <span className="waiting-dot on" aria-hidden="true" /> Проверяю ссылку…
      </div>
    );
  }
  if (!res) return null;
  if (res.kind === 'channel') {
    return (
      <div className="link-status link-status-ok" role="status">
        <span className="check-mark" aria-hidden="true">
          ✓
        </span>
        <span>
          Канал <b>«{res.title}»</b>
          {res.extra ? <span className="hint"> · {res.extra}</span> : null}
        </span>
      </div>
    );
  }
  if (res.kind === 'unknown') {
    return (
      <div className="link-status" role="status">
        {res.message}
      </div>
    );
  }
  return (
    <div className="link-status link-status-bad" role="alert">
      <span className="check-mark" aria-hidden="true">
        ✕
      </span>
      <span>{res.message}</span>
    </div>
  );
}

/** Поле ссылки с проверкой. Итог проверки отдаёт наверх — кнопка «Создать» по нему решает. */
export function ChannelLinkField({
  value,
  onChange,
  onEnter,
  onResult,
  label = 'Ссылка на канал',
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onResult?: (r: LinkCheck | null) => void;
  label?: string;
  required?: boolean;
}) {
  const { res, busy } = useLinkCheck(value);
  const report = useRef(onResult);
  report.current = onResult;
  useEffect(() => {
    report.current?.(busy ? null : res);
  }, [res, busy]);

  const bad = !busy && !!res && !res.ok;
  return (
    <div className="link-field">
      <label className="label">
        <span className="label-text">
          {label}
          {required ? <span className="req">обязательно</span> : null}
        </span>
        <input
          type="url"
          inputMode="url"
          className={'input mono' + (bad ? ' input-bad' : res?.kind === 'channel' ? ' input-ok' : '')}
          value={value}
          placeholder="https://t.me/+AbCdEf…"
          aria-invalid={bad}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter?.();
          }}
        />
      </label>
      <LinkStatus res={res} busy={busy} />
    </div>
  );
}

/* ───────── бот в канал ───────── */

/** Как добавить бота админом: кнопкой или вручную. */
export function AddBotGuide({ bot, addUrl, onCopy }: { bot: string; addUrl: string | null; onCopy: () => void }) {
  return (
    <div className="addbot">
      <section className="addbot-way">
        <div className="addbot-head">
          <span className="addbot-badge">Способ 1</span>
          <b>Одной кнопкой</b>
          <span className="hint">лучше всего с телефона или в приложении Telegram Desktop</span>
        </div>
        {addUrl ? (
          <a className="btn btn-big" href={addUrl} target="_blank" rel="noreferrer">
            Открыть Telegram и добавить @{bot}
          </a>
        ) : (
          <div className="err-text">Имя бота неизвестно: бот ещё не запустился. Обновите страницу через минуту.</div>
        )}
        <ol className="guide-list">
          <li>
            Telegram покажет ваши каналы. Заголовок может быть «Выберите группу» <span className="cvg-en">(Select a Group)</span> — это
            нормально. Нажмите на канал из шага 1.
          </li>
          <li>
            Откроются права бота — нужные уже включены. Нажмите <b>«Сохранить»</b> или <b>«Готово»</b>{' '}
            <span className="cvg-en">(Save / Done)</span>.
          </li>
          <li>Вернитесь сюда — страница сама увидит бота.</li>
        </ol>
        <div className="note-warn">
          <b>Канал не нажимается или его нет в списке?</b> В веб-версии Telegram только что созданный канал иногда виден, но не
          выбирается. Откройте кнопку на телефоне или добавьте бота вручную — способ 2. Канала нет совсем — значит, создана группа: вернитесь
          к шагу 1.
        </div>
      </section>

      <section className="addbot-way">
        <div className="addbot-head">
          <span className="addbot-badge">Способ 2</span>
          <b>Вручную</b>
          <span className="hint">работает везде, 1 минута</span>
        </div>
        <ol className="guide-list">
          <li>Откройте канал в Telegram и нажмите на его название вверху.</li>
          <li>
            Нажмите <b>✏️ «Изменить»</b> <span className="cvg-en">(Edit)</span> → <b>«Администраторы»</b>{' '}
            <span className="cvg-en">(Administrators)</span>.
          </li>
          <li>
            <b>«Добавить администратора»</b> <span className="cvg-en">(Add Admin)</span> → в поиске вставьте имя бота:
            <span className="bot-copy">
              <span className="mono">@{bot || 'имя_бота'}</span>
              <button type="button" className="btn-secondary btn-xs" onClick={onCopy} disabled={!bot}>
                Скопировать
              </button>
            </span>
          </li>
          <li>
            Выберите бота, включите права, как на картинке, и нажмите <b>«Сохранить»</b> <span className="cvg-en">(Save)</span>.
          </li>
        </ol>
        <RightsPicture bot={bot} />
      </section>
    </div>
  );
}

/** Экран прав администратора в Telegram — что включить. */
function RightsPicture({ bot }: { bot: string }) {
  const rows: { ru: string; en: string; on: boolean; why: string }[] = [
    { ru: 'Публикация сообщений', en: 'Post Messages', on: true, why: 'нужно — выкладывать отчёты' },
    {
      ru: 'Добавление подписчиков',
      en: 'Invite Users via Link · Add Subscribers',
      on: true,
      why: 'нужно — впускать участниц',
    },
    { ru: 'Блокировка пользователей', en: 'Ban Users — если есть', on: true, why: 'желательно — убирать исключённых' },
    { ru: 'Остальные права', en: 'Edit, Delete, Stories…', on: false, why: 'можно не трогать' },
  ];
  return (
    <figure className="rights-pic" aria-label="Какие права включить боту">
      <figcaption className="rights-pic-title">Права администратора · @{bot || 'бот'}</figcaption>
      {rows.map((r) => (
        <div key={r.ru} className={'rights-row' + (r.on ? ' on' : '')}>
          <span>
            <span className="rights-name">{r.ru}</span>
            <span className="rights-en">{r.en}</span>
          </span>
          <span className="rights-why">{r.why}</span>
          <span className={'toggle' + (r.on ? ' on' : '')} aria-label={r.on ? 'включить' : 'не нужно'} role="img" />
        </div>
      ))}
    </figure>
  );
}

/** Строка проверки: галочка, крестик или «желательно». */
export function CheckRow({
  ok,
  soft,
  title,
  hint,
}: {
  ok: boolean;
  /** Не блокирует запуск — только предупреждение. */
  soft?: boolean;
  title: string;
  hint: string;
}) {
  const tone = ok ? 'ok' : soft ? 'warn' : 'bad';
  return (
    <div className={`check-row check-row-${tone}`}>
      <span className="check-mark" aria-hidden="true">
        {ok ? '✓' : soft ? '!' : '✕'}
      </span>
      <span>
        <span style={{ fontWeight: 600 }}>{title}</span>
        {!ok && soft ? <span className="check-soft"> · желательно</span> : null}
        <br />
        <span className="hint">{hint}</span>
      </span>
      <span className="sr-only">{ok ? 'готово' : soft ? 'желательно исправить' : 'не готово'}</span>
    </div>
  );
}
