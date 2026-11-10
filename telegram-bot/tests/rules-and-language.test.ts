import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enrollments, marathons, participants } from '../src/db/schema';
import {
  callbackUpdate, lastButtons, makeHarness, TEST_TG_USER_ID, textUpdate, wipeTestParticipant, type Harness,
} from './helpers/bot-harness';

/**
 * Согласие с правилами перед записью и язык клавиатуры.
 *
 * Правила — обязательства со штрафом, поэтому без «Согласна» записи в марафон
 * быть не должно. Клавиатура же должна говорить на выбранном языке: надписи
 * кнопок лежат в текстах бота и берутся по языку участницы.
 */

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
  // Свои правила марафона, если тест их ставил, убираем.
  await h.db.update(marathons).set({ rulesKg: null, rulesRu: null }).where(eq(marathons.code, 'm5'));
  h.reset();
});

/** Последняя отправленная обычная клавиатура (кнопки под полем ввода). */
function lastMenu(): string[] {
  const last = h.sent
    .filter((c) => c.method === 'sendMessage' && (c.payload.reply_markup as { keyboard?: unknown })?.keyboard)
    .at(-1);
  const kb = last?.payload.reply_markup as { keyboard?: { text: string }[][] } | undefined;
  return (kb?.keyboard ?? []).flat().map((b) => b.text);
}

async function startAndChooseBishkek(): Promise<void> {
  await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
  await h.feed(callbackUpdate('lang:kg'));
  await h.feed(textUpdate('Бишкек · UTC+6', AT_0940_BISHKEK));
}

describe('правила марафона', () => {
  it('до согласия записи нет, после согласия появляется', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();

    // Показаны правила, а не приветствие.
    expect(h.lastText()).toMatch(/ЭРЕЖЕЛЕРИ|ПРАВИЛА/);
    expect(lastButtons(h).map((b) => b.callback_data)).toEqual(['rules:yes', 'rules:no']);

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID));
    expect(await h.db.select().from(enrollments).where(eq(enrollments.participantId, p.id))).toHaveLength(0);

    await h.feed(callbackUpdate('rules:yes'));
    const [e] = await h.db.select().from(enrollments).where(eq(enrollments.participantId, p.id));
    expect(e, 'запись появилась').toBeTruthy();
    expect(e.rulesAcceptedAt).toBeInstanceOf(Date);
  });

  it('отказ не записывает в марафон', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();

    await h.feed(callbackUpdate('rules:no'));
    expect(h.lastText()).toMatch(/кабыл албай|Без согласия/);

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID));
    expect(await h.db.select().from(enrollments).where(eq(enrollments.participantId, p.id))).toHaveLength(0);
  });

  it('свои правила марафона показываются вместо общих', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await h.db.update(marathons).set({ rulesKg: 'Бул марафондун өзүнүн эрежелери.' }).where(eq(marathons.code, 'm5'));

    await startAndChooseBishkek();
    expect(h.lastText()).toContain('Бул марафондун өзүнүн эрежелери.');
    expect(h.lastText()).not.toContain('ЭРЕЖЕЛЕРИ');
  });

  it('вернувшуюся участницу правилами не мучаем', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();
    await h.feed(callbackUpdate('rules:yes'));

    h.reset();
    await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
    expect(h.texts().join('\n')).not.toMatch(/ЭРЕЖЕЛЕРИ|ПРАВИЛА/);
  });
});

describe('повторный вход по ссылке', () => {
  it('язык и место спрашиваются снова, нынешний город — первой кнопкой', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();
    await h.feed(callbackUpdate('rules:yes'));

    h.reset();
    await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));

    // Снова язык, а не сразу приветствие.
    expect(lastButtons(h).map((b) => b.callback_data)).toEqual(['lang:kg', 'lang:ru']);

    await h.feed(callbackUpdate('lang:kg'));
    const keep = lastMenu().find((b) => b.includes('Бишкек'));
    expect(keep, 'кнопка «оставить место» первой').toBe(lastMenu()[0]);

    // Нажали «оставить» — место то же, запись на месте, правил снова нет.
    h.reset();
    await h.feed(textUpdate(keep!, AT_0940_BISHKEK));

    const all = h.texts().join('\n');
    expect(all).toContain('Бишкек');
    expect(all).not.toMatch(/ЭРЕЖЕЛЕРИ|ПРАВИЛА/);

    const [p] = await h.db.select().from(participants).where(eq(participants.tgUserId, TEST_TG_USER_ID));
    expect(p.placeLabel).toBe('Бишкек');
    expect(await h.db.select().from(enrollments).where(eq(enrollments.participantId, p.id))).toHaveLength(1);
  });

  it('первой участнице кнопки «оставить» нет', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await h.feed(textUpdate('/start m5', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:kg'));

    expect(lastMenu().some((b) => b.includes('Оставить') || b.includes('Калтыруу'))).toBe(false);
  });
});

describe('старая клавиатура', () => {
  it('кнопка прошлой версии работает и заменяется новой', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();
    await h.feed(callbackUpdate('rules:yes'));

    h.reset();
    // «⭐ Баллдарым» в новом меню нет, но у давно записанных она висит в чате.
    await h.feed(textUpdate('⭐ Баллдарым', AT_0940_BISHKEK));

    // Ответ по делу: это «Отчётторум», а не «только видеокружок».
    expect(h.texts().join('\n')).toMatch(/Баллдар:|Баллы:/);
    expect(h.texts().join('\n')).not.toMatch(/видеокружок менен гана|только видеокружком/);
    // И вместе с ответом пришла новая клавиатура.
    expect(lastMenu()).toContain('✅ Отчётторум');
  });
});

describe('язык клавиатуры', () => {
  it('после выбора русского кнопки становятся русскими', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();
    await h.feed(callbackUpdate('rules:yes'));

    expect(lastMenu(), 'кыргызская клавиатура').toContain('🎥 Отчёт тапшыруу');

    h.reset();
    await h.feed(textUpdate('/til', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:ru'));

    const menu = lastMenu();
    expect(menu).toContain('🎥 Отправить отчёт');
    expect(menu).toContain('😎 Обо мне');
    expect(menu).not.toContain('🎥 Отчёт тапшыруу');
  });

  it('нажатие русской кнопки работает так же, как кыргызской', async () => {
    vi.useFakeTimers({ now: AT_0940_BISHKEK, toFake: ['Date'] });
    await startAndChooseBishkek();
    await h.feed(callbackUpdate('rules:yes'));
    await h.feed(textUpdate('/til', AT_0940_BISHKEK));
    await h.feed(callbackUpdate('lang:ru'));

    h.reset();
    await h.feed(textUpdate('😎 Обо мне', AT_0940_BISHKEK));
    expect(h.lastText()).toMatch(/Рейтинг/);
  });
});
