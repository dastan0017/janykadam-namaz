import type { NamazId } from './namaz';
import { parseHHMM } from './windows';

/**
 * Проверка конфигурации марафона. Одни и те же правила использует и API,
 * и проверка перед запуском: ошибки запуск блокируют, предупреждения — нет.
 */

export type IssueLevel = 'error' | 'warn';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  /** Где чинить: тема, вопрос, настройки. */
  entity?: { kind: 'topic' | 'question' | 'option' | 'marathon' | 'texts'; id?: string };
}

export interface QuestionInput {
  id: string;
  textKg: string;
  textRu: string;
  type: 'single' | 'multi' | 'text' | 'number' | 'scale' | 'yesno';
  options: { id: string; labelKg: string; labelRu: string; points: number }[];
}

export interface TopicInput {
  id: string;
  nameKg: string;
  nameRu: string;
  active: boolean;
  startLocal: string;
  endLocal: string;
  points: number | null;
  mandatory: boolean;
  freq: 'daily' | 'weekly';
  questions: QuestionInput[];
}

export interface MarathonInput {
  status: 'draft' | 'recruiting' | 'running' | 'finished' | 'archive';
  startDate: string;
  endDate: string;
  namaz: NamazId[];
  topics: TopicInput[];
  /** Канал отчётов: есть ли ссылка и готов ли бот в нём работать. */
  channel?: {
    link: boolean;
    connected: boolean;
    ready: boolean;
    isPrivate: boolean;
    protectedContent: boolean;
    canRestrict: boolean;
  };
}

export interface ValidationContext {
  /** Сегодняшняя дата по Бишкеку — эталон для проверки дат. */
  today: string;
  /** Непереведённые ключи текстов бота. */
  untranslatedTextKeys: string[];
}

export function validateMarathon(m: MarathonInput, ctx: ValidationContext): Issue[] {
  const out: Issue[] = [];
  const err = (code: string, message: string, entity?: Issue['entity']) => out.push({ level: 'error', code, message, entity });
  const warn = (code: string, message: string, entity?: Issue['entity']) => out.push({ level: 'warn', code, message, entity });

  const activeTopics = m.topics.filter((t) => t.active);

  if (m.namaz.length === 0 && activeTopics.length === 0) {
    err('no_topics', 'В марафоне нет ни одной темы — участнице нечего сдавать', { kind: 'marathon' });
  }

  for (const t of activeTopics) {
    if (!t.nameKg.trim()) {
      err('topic_no_name_kg', 'Тема без названия на кыргызском', { kind: 'topic', id: t.id });
    }
    if (!t.nameRu.trim()) {
      warn('topic_no_name_ru', `Тема «${t.nameKg || t.id}»: нет русского названия`, { kind: 'topic', id: t.id });
    }
    if (t.points === null || Number.isNaN(Number(t.points)) || Number(t.points) < 0) {
      err('topic_points', `Тема «${t.nameKg || t.id}»: баллы не заданы или отрицательные`, { kind: 'topic', id: t.id });
    }
    if (parseHHMM(t.endLocal.slice(0, 5)) <= parseHHMM(t.startLocal.slice(0, 5))) {
      err('topic_window', `Тема «${t.nameKg || t.id}»: окно закрывается раньше, чем открывается`, { kind: 'topic', id: t.id });
    }
    // Недельная обязательная тема ломала бы «полный день» во все прочие дни.
    if (t.freq === 'weekly' && t.mandatory) {
      warn('weekly_mandatory', `Тема «${t.nameKg || t.id}»: недельная и обязательная одновременно`, { kind: 'topic', id: t.id });
    }

    for (const [i, q] of t.questions.entries()) {
      const where: Issue['entity'] = { kind: 'question', id: q.id };
      if (!q.textKg.trim() && !q.textRu.trim()) {
        err('question_empty', `«${t.nameKg}», вопрос ${i + 1}: пустой текст`, where);
      } else if (!q.textKg.trim() || !q.textRu.trim()) {
        warn('question_untranslated', `«${t.nameKg}», вопрос ${i + 1}: нет перевода ${!q.textKg.trim() ? 'на кыргызский' : 'на русский'}`, where);
      }

      if ((q.type === 'single' || q.type === 'multi') && q.options.length < 2) {
        err('question_options', `«${t.nameKg}», вопрос ${i + 1}: вариантов ответа меньше двух`, where);
      }
      if (q.options.length > 8) {
        warn('too_many_options', `«${t.nameKg}», вопрос ${i + 1}: ${q.options.length} кнопок — клавиатура станет стеной`, where);
      }
      for (const o of q.options) {
        if (!o.labelKg.trim() || !o.labelRu.trim()) {
          warn('option_untranslated', `«${t.nameKg}», вопрос ${i + 1}: вариант без перевода`, { kind: 'option', id: o.id });
        }
        if (o.labelKg.length > 64 || o.labelRu.length > 64) {
          warn('option_too_long', `«${t.nameKg}», вопрос ${i + 1}: надпись длиннее 64 символов`, { kind: 'option', id: o.id });
        }
      }
    }
  }

  // Пересечение окон — не ошибка: «Зикир» на весь день идёт поверх намазов,
  // а отчёт участница сдаёт по каждой теме отдельно, кнопкой с её id.

  // Канал отчётов обязателен: туда бот выкладывает видео и туда впускает участниц.
  // Завершённым и архивным он уже ни к чему.
  const ch = m.channel;
  if (ch && m.status !== 'finished' && m.status !== 'archive') {
    if (!ch.link) {
      err('channel_link_missing', 'Нет ссылки на канал отчётов', { kind: 'marathon' });
    } else if (!ch.connected) {
      err('channel_not_connected', 'Канал отчётов не подключён: добавьте бота в канал админом', { kind: 'marathon' });
    } else if (!ch.ready) {
      err('channel_rights', 'У бота в канале не хватает прав: нужно публиковать и приглашать по ссылке', { kind: 'marathon' });
    } else {
      if (!ch.isPrivate) warn('channel_public', 'Канал отчётов публичный: видео участниц может увидеть кто угодно', { kind: 'marathon' });
      if (!ch.protectedContent) warn('channel_copying', 'В канале не запрещено копирование: видео можно сохранить и переслать', { kind: 'marathon' });
      if (!ch.canRestrict) warn('channel_restrict', 'Бот не может удалять из канала: исключённые из марафона останутся в нём', { kind: 'marathon' });
    }
  }

  if (m.status === 'draft' && m.startDate < ctx.today) {
    err('start_in_past', `Дата начала ${m.startDate} уже прошла`, { kind: 'marathon' });
  }
  if (m.endDate < m.startDate) {
    err('end_before_start', 'Дата окончания раньше начала', { kind: 'marathon' });
  }

  for (const key of ctx.untranslatedTextKeys) {
    warn('text_untranslated', `Текст бота «${key}» не переведён`, { kind: 'texts', id: key });
  }

  return out;
}

export function hasBlockingErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
