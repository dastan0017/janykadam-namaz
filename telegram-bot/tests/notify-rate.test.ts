import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BISHKEK, makeHarness, makeParticipant, wipeParticipants, type Harness } from './helpers/bot-harness';

/**
 * Часть пункта 14.12: общий ограничитель отправки.
 *
 * Лимит у Telegram общий на бота, а не на чат, поэтому ограничитель в
 * NotifyService один на напоминания и рассылки. Здесь он проверяется по
 * настоящим часам, на штатных 25 сообщениях в секунду — рассылка на тысячу
 * получателей отсюда и занимает видимые ~40 секунд.
 */

const TG_PREFIX = '9150';
const PER_SECOND = 25;

let h: Harness;
let recipient: NonNullable<Awaited<ReturnType<Harness['notify']['recipientOf']>>>;

beforeAll(async () => {
  process.env.MAX_MSG_PER_SECOND = String(PER_SECOND);
  h = await makeHarness();

  await wipeParticipants(h.db, TG_PREFIX);
  const made = await makeParticipant(h.db, { tgUserId: `${TG_PREFIX}01`, place: BISHKEK });
  recipient = (await h.notify.recipientOf(made.enrollmentId))!;
  expect(recipient).toBeTruthy();
  h.reset();
});

afterAll(async () => {
  await wipeParticipants(h.db, TG_PREFIX);
  await h.close();
  delete process.env.MAX_MSG_PER_SECOND;
});

async function sendMany(n: number): Promise<{ elapsed: number; sent: number }> {
  h.reset();
  const started = Date.now();
  const outcomes = await Promise.all(
    Array.from({ length: n }, (_, i) => h.notify.send(recipient, `сообщение ${i}`)),
  );
  const elapsed = Date.now() - started;
  expect(outcomes.every((o) => o.status === 'sent')).toBe(true);
  return { elapsed, sent: h.sent.filter((c) => c.method === 'sendMessage').length };
}

describe('ограничитель отправки', () => {
  it('первые 25 сообщений уходят без паузы', async () => {
    const { elapsed, sent } = await sendMany(PER_SECOND);
    expect(sent).toBe(PER_SECOND);
    expect(elapsed, 'в пределах секунды пауз быть не должно').toBeLessThan(900);
  });

  it('следующие ждут окна и ни одно не теряется', async () => {
    const { elapsed, sent } = await sendMany(PER_SECOND + 5);
    expect(sent).toBe(PER_SECOND + 5);
    // Лимит уже исчерпан предыдущим тестом, поэтому пауза случается сразу.
    expect(elapsed, 'ограничитель обязан притормозить').toBeGreaterThanOrEqual(900);
    expect(elapsed, 'но не больше, чем на одно окно с запасом').toBeLessThan(4000);
  });
});
