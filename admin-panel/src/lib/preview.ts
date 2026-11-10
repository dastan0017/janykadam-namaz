import { FALLBACK_TZ, PRESETS } from '../data/constants';
import type { AnyTopic, AppState, Preview, PreviewButton, PreviewStep } from '../types';
import { activeTopics, currentData, currentMarathon, currentQuestion, currentTopic, fillPlaceholders, segments } from './derive';
import { plural } from './format';
import { fmt, localNow, openNow, placeLabel, win, winStr } from './time';

/**
 * Карточка «Что получит участница» для текущего экрана.
 * Это компонент дизайн-системы панели, а не имитация телефона: она про структуру и
 * лимиты Telegram (4096 символов, 64 байта callback_data, ~8 кнопок), не про пиксели.
 */
export function buildPreview(s: AppState): Preview | null {
  const m = currentMarathon(s);
  if (!m) return null;

  const kg = s.pvLang === 'kg';
  const nm = (x: { nameKg: string; nameRu: string }) => (kg ? x.nameKg || x.nameRu : x.nameRu || x.nameKg);

  let text = '';
  let title = '';
  let when = '';
  let buttons: PreviewButton[] = [];
  const steps: PreviewStep[] = [];
  const warns: string[] = [];

  if (s.screen === 'topicEditor') {
    const t = currentTopic(s);
    if (!t) return null;
    const w = winStr(t);
    const [wStart, wEnd] = w.split('–');
    const name = nm(t);

    if (s.pvDone) {
      title = `Подтверждение приёма — ${t.nameKg}`;
      text = kg
        ? `${t.emoji} ${name} — отчёт кабыл алынды. +${t.points} балл.`
        : `${t.emoji} ${name} — отчёт принят. +${t.points} баллов.`;
      when = 'Сразу после видеокружка. Напоминание по этой теме сегодня больше не придёт.';
    } else {
      title = `Напоминание — ${t.nameKg}`;
      text = kg
        ? `${t.emoji} ${name}: терезе ${wEnd} чейин ачык. Видеокружок жөнөтүңүз.`
        : `${t.emoji} ${name}: окно открыто до ${wEnd}. Отправьте видеокружок.`;
      when = `Уходит в ${wStart}${t.remind ? ' + ' + t.remind + ' мин' : ''} по местному времени каждой участницы — всем активным, кто ещё не сдал «${t.nameKg}». Сдавшим — не уходит.`;
    }

    const open = activeTopics(s).filter((x) => openNow(x));
    let n = 1;
    steps.push({ k: 'step', text: `${n++}. Участница записывает видеокружок (до 60 сек) — он не проверяется, только фиксируется` });
    steps.push({ k: 'step', text: `${n++}. Бот спрашивает тему — только открытые сейчас по её времени. В Бишкеке в ${fmt(localNow(FALLBACK_TZ))} это ${open.length} ${plural(open.length, 'кнопка', 'кнопки', 'кнопок')}:` });
    open.forEach((x) => steps.push({ k: 'btn', text: `${x.emoji} ${nm(x)}`, hot: x.id === t.id }));

    if (!open.some((x) => x.id === t.id)) {
      steps.push({ k: 'hint', text: t.active ? `«${name}» сейчас закрыта — кнопка появится в ${wStart}` : `«${name}» выключена — в списке её нет` });
    }
    if (open.length > 8) {
      warns.push(`Сейчас открыто ${open.length} тем — больше 8 кнопок, список станет стеной. Сузьте окна или выключите часть тем.`);
    }

    t.questions.forEach((q, i) => {
      steps.push({ k: 'step', text: `${n++}. Вопрос ${i + 1}: ${kg ? q.textKg || q.textRu : q.textRu || q.textKg}${q.required ? '' : ' (можно пропустить)'}` });
      if (q.options.length) {
        q.options.forEach((o) => steps.push({ k: 'btn', text: kg ? o.kg : o.ru || o.kg, pts: o.pts }));
      } else {
        steps.push({ k: 'hint', text: q.type === 'number' ? 'Ожидается число' : 'Ожидается текст' });
      }
    });
    steps.push({ k: 'step', text: `${n}. Бот: «${name} — ${kg ? 'отчёт кабыл алынды' : 'отчёт принят'}» — засчитывается по факту отправки` });

    if (!t.nameRu || !t.nameKg) warns.push('Нет перевода названия — участницы с русским языком увидят кыргызское (или пустое).');
  } else if (s.screen === 'questionEditor') {
    const q = currentQuestion(s);
    const t = currentTopic(s);
    if (!q || !t) return null;

    text = kg ? q.textKg || q.textRu : q.textRu || q.textKg;
    title = `Вопрос ${t.questions.indexOf(q) + 1} — ${t.nameKg}`;
    buttons = q.options.map((o) => ({
      text: (kg ? o.kg || o.ru : o.ru || o.kg) || '— пусто —',
      pts: o.pts,
      cb: `${m.code}:${t.id}:${q.id}:${o.id}`,
    }));
    when = `Задаётся после видеокружка и выбора темы «${t.nameKg}», ${t.questions.indexOf(q) + 1}-й из ${t.questions.length}. ${q.required ? 'Без ответа отчёт не засчитается.' : 'Можно пропустить кнопкой «Өткөрүү».'}`;

    if (buttons.length > 8) warns.push(`${buttons.length} кнопок — больше восьми. Клавиатура не помещается на экран, участница листает.`);
    if ((q.type === 'single' || q.type === 'multi') && buttons.length < 2) warns.push('Меньше двух вариантов — вопрос без выбора. Бот не покажет его.');
    if (!q.textRu || !q.textKg) warns.push(`Нет перевода вопроса ${!q.textKg ? 'на кыргызский' : 'на русский'}.`);
    if (q.options.some((o) => !o.kg || !o.ru)) warns.push('Есть варианты без перевода — кнопка покажется на другом языке.');
    if (q.options.some((o) => (o.kg || '').length > 64 || (o.ru || '').length > 64)) warns.push('Надпись кнопки длиннее 64 символов — Telegram обрежет её.');
    if (q.type === 'number') buttons = [{ hint: 'Ожидается число — без кнопок' }];
    if (q.type === 'text') buttons = [{ hint: 'Ожидается текст — без кнопок' }];
  } else if (s.screen === 'broadcasts') {
    const segs = segments(s);
    const seg = segs.find((x) => x.id === s.bc.seg) ?? segs[0];
    const p = seg?.list[0] ?? currentData(s).participants[0];
    text = p ? fillPlaceholders(s.bc.text, p, m.name) : s.bc.text;
    title = p ? `Рассылка — как увидит ${p.name.split(' ')[0]}` : 'Рассылка';
    const n = seg ? seg.list.length : 0;
    when = `${s.bc.when === 'now' ? 'Сразу после подтверждения' : 'Завтра в 09:00 по местному времени каждой участницы'} · ${seg?.name}: ${n} ${plural(n, 'получатель', 'получателя', 'получателей')}. Тихие часы ${s.bot.quietFrom}–${s.bot.quietTo} сдвинут отправку.`;
    if (!s.bc.text.trim()) warns.push('Пустое сообщение.');
  } else if (s.screen === 'texts') {
    const t = s.texts.find((x) => x.key === s.textKey) ?? s.texts[0];
    text = kg ? t.kg : t.ru;
    title = `Текст «${t.key}»`;
    when = 'Плейсхолдеры подставляются при отправке: ' + (t.ph || 'нет');
    if (!t.kg) warns.push('Нет кыргызской версии — бот отправит русскую.');
  } else if (s.screen === 'settings') {
    const open = activeTopics(s).filter((x) => openNow(x, 'bishkek'));
    const list = open.map((x) => x.emoji + ' ' + nm(x)).join(', ');
    const tpl = s.texts.find((x) => x.key === 'start_welcome') ?? { kg: '', ru: '' };
    text = ((kg ? tpl.kg : tpl.ru) || tpl.ru)
      .replace(/\{имя\}/g, 'Айсулуу')
      .replace(/\{марафон\}/g, m.name)
      .replace(/\{открыто_сейчас\}/g, list || (kg ? 'азыр ачык тема жок' : 'сейчас открытых тем нет'));
    title = 'Регистрация — что видит участница';

    steps.push({ k: 'step', text: '1. Переходит по ссылке и нажимает «Старт». Бот: «Тилди тандаңыз / Выберите язык»' });
    steps.push({ k: 'btn', text: 'Кыргызча' });
    steps.push({ k: 'btn', text: 'Русский' });
    steps.push({ k: 'step', text: kg ? '2. «Азыр кайдасыз? Убакыт алкагын тандаңыз»' : '2. «Где вы сейчас? Выберите часовой пояс»' });
    // Кнопки места — ровно те, что показывает бот: у Бишкека и Оша одна зона,
    // но кнопки разные, потому что время намаза у них расходится.
    PRESETS.forEach((p) => steps.push({ k: 'btn', text: placeLabel(p.label, p.tz) }));
    steps.push({ k: 'step', text: `3. Сразу — приветствие (текст выше) и кнопки тем, открытых сейчас. Для Бишкека в ${fmt(localNow(FALLBACK_TZ))}:` });
    open.forEach((x) => steps.push({ k: 'btn', text: `${x.emoji} ${nm(x)}`, hot: true }));

    // Напоминание, что окна у всех разные: в Москве сейчас открыто другое.
    const mos = activeTopics(s).filter((x: AnyTopic) => openNow(x, 'moscow') && !open.some((o) => o.id === x.id));
    if (mos.length) {
      steps.push({
        k: 'hint',
        text: `В Москве сейчас ${fmt(localNow('moscow'))} — там откроется ещё ${mos.map((x) => x.emoji + ' ' + nm(x) + ' (до ' + fmt(win(x, 'moscow').e) + ')').join(', ')}`,
      });
    }
    steps.push({ k: 'step', text: '4. Первый видеокружок засчитывается сразу — серия и баллы начинаются с него' });
    when = 'Сразу после выбора часового пояса. Ждать следующего дня или начала марафонного дня не нужно.';
    if (!m.regOpen) warns.push('Регистрация сейчас закрыта — по ссылке участница увидит «Набор закрыт». Включите «Регистрация открыта» выше.');
  } else {
    return null;
  }

  const len = (text || '').length;
  if (len > 4096) warns.push(`Текст ${len} символов — больше 4096. Бот разобьёт его на части по абзацам, кнопки прикрепятся к последней.`);

  return {
    title,
    text: text || '—',
    len,
    lenLabel: `${len} / 4096`,
    over: len > 4096,
    buttons,
    steps,
    when,
    warns,
    twoPrefix: `Участница в двух марафонах видит перед текстом метку [${m.name}] — так различаются напоминания в одном чате.`,
    ugly: buttons.length > 8,
  };
}
