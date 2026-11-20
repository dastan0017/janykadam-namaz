import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enrollments, participants, reports } from '../src/db/schema';
import {
  callbackUpdate, makeHarness, photoUpdate, TEST_TG_USER_ID, textUpdate,
  videoNoteUpdate, wipeTestParticipant, type Harness,
} from './helpers/bot-harness';

/**
 * Сквозные сценарии из чек-листа приёмки: настоящий Postgres, поддельный Telegram.
 * Требует применённых миграций и `pnpm seed` с SEED_DEMO=true.
 */

/** 2026-11-08, 09:40 по Бишкеку = 03:40 UTC. */
const AT_0940_BISHKEK = new Date('2026-11-08T03:40:00Z');

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});

afterEach(async () => {
  vi.useRealTimers();
  await wipeTestParticipant(h.db);
  h.reset();
});

/** Регистрация целиком. `goal: 'ask'` — оставить вопрос о цели открытым. */
async function registerInBishkek(goal: 'later' | 'ask' = 'later'): Promise<void> {
  await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
  await h.feed(callbackUpdate('lang:kg'));
  // Кнопка пресета приходит обычным текстом реплай-клавиатуры.
  await h.feed(textUpdate('Бишкек · UTC+6', AT_0940_BISHKEK));
  // Правила принимаются до записи — без этого марафона у неё нет.
  await h.feed(callbackUpdate('rules:yes'));
  if (goal === 'later') await h.feed(callbackUpdate('goal:later'));
}

describe('регистрация и первый отчёт', () => {
  it('новая участница выбирает язык и Бишкек, видит открытые темы без Багымдата', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();

    const all = h.texts().join('\n');

    // Место подтверждено с временами намаза.
    expect(all).toContain('Бишкек');
    expect(all).toContain('UTC+6');

    // Приветствие перечисляет открытые сейчас темы.
    expect(all).toMatch(/Зикир|Спорт|Китеп окуу/);
    // В 09:40 Багымдат (06:19–07:44) уже закрыт и в списке открытых его нет.
    const welcome = h.texts().find((t) => t.includes('марафонундасыз') || t.includes('марафоне'));
    expect(welcome, 'приветствие отправлено').toBeTruthy();
    expect(welcome).not.toContain('Багымдат');
  });

  it('место и запись сохранены в базе', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID)).limit(1);
    expect(p).toBeTruthy();
    expect(p.tz).toBe('Asia/Bishkek');
    expect(p.lang).toBe('kg');
    expect(p.activeEnrollmentId).toBeTruthy();

    const [e] = await h.db.select().from(enrollments).where(eq(enrollments.id, p.activeEnrollmentId!)).limit(1);
    expect(e.status).toBe('active');
  });

  it('видеокружок принимается: выбор темы, затем отчёт с баллами', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_first', at: AT_0940_BISHKEK }));

    // Открытых тем несколько, поэтому бот спрашивает, к какой теме кружок.
    expect(h.lastText()).toMatch(/кайсы темага|К какой теме/);

    // Выбираем «Зикир» — 5 баллов, вопросов нет.
    const picker = h.sent.filter((c) => c.method === 'sendMessage').at(-1)!;
    const kb = picker.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    const zikr = kb.inline_keyboard.flat().find((b) => b.text.includes('Зикир'));
    expect(zikr, 'Зикир есть среди кандидатов').toBeTruthy();

    h.reset();
    await h.feed(callbackUpdate(zikr!.callback_data));

    const accepted = h.texts().join('\n');
    expect(accepted).toMatch(/кабыл алынды|отчёт принят/);
    expect(accepted).toContain('5');

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID)).limit(1);
    const [e] = await h.db.select().from(enrollments).where(eq(enrollments.id, p.activeEnrollmentId!)).limit(1);
    expect(e.points).toBe(5);

    const rows = await h.db.select().from(reports).where(eq(reports.enrollmentId, e.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].dayKey).toBe('2026-11-08');
    expect(rows[0].pointsAwarded).toBe(5);
    // Видео не скачиваем — храним только идентификаторы.
    expect(rows[0].videoFileUniqueId).toBe('vu_first');
  });
});

describe('отказы', () => {
  it('пересланный видеокружок не засчитывается', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_fwd', at: AT_0940_BISHKEK, forwarded: true }));
    expect(h.lastText()).toMatch(/башкадан жөнөтүлгөнү|пересланные/);
  });

  it('повторная отправка того же файла отклоняется', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();

    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_dup', at: AT_0940_BISHKEK }));
    const picker = h.sent.filter((c) => c.method === 'sendMessage').at(-1)!;
    const kb = picker.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    // «Зикир» без вопросов — отчёт сохраняется сразу, файл становится использованным.
    const zikr = kb.inline_keyboard.flat().find((b) => b.text.includes('Зикир'))!;
    await h.feed(callbackUpdate(zikr.callback_data));

    h.reset();
    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_dup', at: AT_0940_BISHKEK }));
    expect(h.lastText()).toMatch(/мурун эсептелген|уже засчитан/);
  });

  it('одна и та же тема второй раз за день недоступна', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();

    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_a', at: AT_0940_BISHKEK }));
    const first = h.sent.filter((c) => c.method === 'sendMessage').at(-1)!;
    const kb1 = first.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    const zikr = kb1.inline_keyboard.flat().find((b) => b.text.includes('Зикир'))!;
    await h.feed(callbackUpdate(zikr.callback_data));

    // Второй кружок: Зикир уже сдан и среди кандидатов его быть не должно.
    h.reset();
    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_b', at: AT_0940_BISHKEK }));
    const second = h.sent.filter((c) => c.method === 'sendMessage').at(-1)!;
    const kb2 = second.payload.reply_markup as { inline_keyboard?: { text: string }[][] };
    const labels = (kb2.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(labels.some((l) => l.includes('Зикир'))).toBe(false);
  });

  it('фотография вместо кружка получает «только видеокружок»', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(photoUpdate(AT_0940_BISHKEK));
    expect(h.lastText()).toMatch(/видеокружок менен гана|только видеокружком/);
  });

  it('произвольный текст тоже получает «только видеокружок»', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(textUpdate('салам', AT_0940_BISHKEK));
    expect(h.lastText()).toMatch(/видеокружок менен гана|только видеокружком/);
  });

  it('цель спрашивается при записи и сохраняется', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek('ask');
    expect(h.lastText()).toMatch(/максат|цель/i);

    await h.feed(textUpdate('Намазды калтырбоо', AT_0940_BISHKEK));
    expect(h.texts().join('\n')).toContain('Намазды калтырбоо');

    // «Максаттарым» показывает её же.
    h.reset();
    await h.feed(textUpdate('🤲 Максаттарым', AT_0940_BISHKEK));
    expect(h.lastText()).toContain('Намазды калтырбоо');
  });

  it('нажатая кнопка меню не записывается в цель', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek('ask');
    // Вопрос о цели открыт, но участница жмёт кнопку — это кнопка, а не цель.
    h.reset();
    await h.feed(textUpdate('😎 Өзүм жөнүндө', AT_0940_BISHKEK));
    expect(h.lastText()).not.toMatch(/сакталды|сохранена/i);
    expect(h.lastText()).toMatch(/Рейтинг|рейтинг/);
  });

  it('без марафона кружок не принимается', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    // Регистрируемся без кода марафона: /start без аргумента не записывает.
    await h.feed(textUpdate('/start', AT_0940_BISHKEK));
    h.reset();

    await h.feed(videoNoteUpdate({ fileUniqueId: 'vu_noenroll', at: AT_0940_BISHKEK }));
    expect(h.lastText()).toMatch(/марафондо эмессиз|не в марафоне/);
  });
});

describe('команды', () => {
  it('/help содержит атрибуцию GeoNames', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(textUpdate('/help', AT_0940_BISHKEK));
    const text = h.texts().join('\n');
    expect(text).toContain('GeoNames');
    expect(text).toContain('CC BY 4.0');
  });

  it('/otchet перечисляет открытые темы со временем закрытия', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(textUpdate('/otchet', AT_0940_BISHKEK));
    const text = h.texts().join('\n');
    expect(text).toMatch(/Зикир|Спорт/);
    expect(text).toMatch(/\d{2}:\d{2}/);
  });

  it('/ball показывает баллы и статус тем', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(textUpdate('/ball', AT_0940_BISHKEK));
    const text = h.texts().join('\n');
    expect(text).toMatch(/Баллдар|Баллы/);

    // У каждой темы окно целиком — и у упущенных тоже: Багымдат в 09:40 уже
    // закрыт, но видно, когда его надо было сдать.
    const lines = text.split('\n').filter((l) => /^(✅|🤍|🕒|⏳|✖️)/.test(l));
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(l, l).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
    expect(lines.find((l) => l.includes('Багымдат'))).toMatch(/^✖️ \d{2}:\d{2}–\d{2}:\d{2}/);
  });

  it('/tahajjud переключает напоминания', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(textUpdate('/tahajjud', AT_0940_BISHKEK));
    expect(h.lastText()).toMatch(/күйгүзүлдү|включены/);

    const [p1] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID)).limit(1);
    expect(p1.tahajjudReminders).toBe(true);

    await h.feed(textUpdate('/tahajjud', AT_0940_BISHKEK));
    expect(h.lastText()).toMatch(/өчүрүлдү|выключены/);
  });

  it('/til переключает язык на русский', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await registerInBishkek();
    h.reset();

    await h.feed(textUpdate('/til', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:ru'));

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID)).limit(1);
    expect(p.lang).toBe('ru');
  });
});

describe('место определяет окна', () => {
  it('поиск города находит Талас и ставит Asia/Bishkek', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:kg'));

    await h.feed(textUpdate('🔎 Башка шаар', AT_0940_BISHKEK));
    await h.feed(textUpdate('талас', AT_0940_BISHKEK));

    const results = h.sent.filter((c) => c.method === 'sendMessage').at(-1)!;
    const kb = results.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    const first = kb.inline_keyboard.flat().find((b) => b.callback_data.startsWith('geo:') && b.callback_data !== 'geo:none');
    expect(first?.text).toContain('Талас');

    await h.feed(callbackUpdate(first!.callback_data));

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID)).limit(1);
    expect(p.tz).toBe('Asia/Bishkek');
  });

  it('геолокация Манхэттена даёт America/New_York', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:kg'));

    await h.feed({
      message: {
        message_id: 42,
        date: Math.floor(AT_0940_BISHKEK.getTime() / 1000),
        chat: { id: 777001, type: 'private', first_name: 'Айсулуу' },
        from: { id: 777001, is_bot: false, first_name: 'Айсулуу' },
        location: { latitude: 40.7549, longitude: -73.984 },
      },
    } as never);

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID)).limit(1);
    expect(p.tz).toBe('America/New_York');
  });
});
