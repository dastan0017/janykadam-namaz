/**
 * Как создать канал отчётов — один и тот же текст в форме нового марафона и
 * на странице «Канал отчётов». Названия кнопок — как в русском Telegram.
 */
export function CreateChannelSteps() {
  return (
    <ol className="guide-list">
      <li>
        В Telegram нажмите <b>✏️</b> (на телефоне) или <b>«Новое сообщение»</b> → <b>«Создать канал»</b>.
      </li>
      <li>
        Название — например <b>«Үммөттүн кызы — отчёттор»</b>. Описание и фото можно пропустить.
      </li>
      <li>
        Тип канала — <b>«Частный»</b>. Telegram покажет ссылку вида <span className="mono">t.me/+AbCd…</span> — <b>скопируйте её</b>.
      </li>
      <li>
        На шаге «Добавить подписчиков» нажмите <b>«Пропустить»</b>: участниц впустит бот.
      </li>
      <li>Вставьте ссылку сюда.</li>
    </ol>
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
