import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { broadcastDeliveries, enrollments, participants } from '../src/db/schema';
import {
  BISHKEK, makeHarness, marathonIdByCode, wipeParticipants, type Harness,
} from './helpers/bot-harness';

/**
 * Пункт 14.12 чек-листа: рассылка на тысячу получателей.
 *
 * Проверяется путь целиком: снимок получателей в момент создания, подстановка
 * плейсхолдеров, разбор доставок по сто за заход, видимый прогресс, 403 как
 * «заблокировала бота» и 429 с повтором по retry_after.
 *
 * Ограничитель здесь поднят через MAX_MSG_PER_SECOND: иначе тысяча сообщений
 * по 25 в секунду заняла бы сорок секунд. Сам ограничитель проверяется
 * отдельно, в `notify-rate.test.ts`.
 */

const TG_PREFIX = '9140';
const RECIPIENTS = 1000;

/** Участница, которая заблокировала бота до создания рассылки. */
const BLOCKED_BEFORE = 0;
/** Участница, чей чат отвечает 403 во время отправки. */
const FORBIDDEN = 1;
/** Участница, чей чат один раз отвечает 429 с retry_after. */
const RATE_LIMITED = 2;
/** Участница, чей чат отвечает 429 всегда: повторы не помогут. */
const ALWAYS_LIMITED = 3;

let h: Harness;
let marathonId: string;
let chatIds: string[] = [];
let ourIds: string[] = [];

const chatOf = (i: number) => `${TG_PREFIX}${String(i).padStart(5, '0')}`;

beforeAll(async () => {
  // Поддельный Telegram не жалуется на скорость, поэтому лимитер не мешает.
  process.env.MAX_MSG_PER_SECOND = '2000';
  h = await makeHarness();
  marathonId = await marathonIdByCode(h.db, 'm5');

  await wipeParticipants(h.db, TG_PREFIX);

  const rows = Array.from({ length: RECIPIENTS }, (_, i) => ({
    tgUserId: chatOf(i),
    chatId: chatOf(i),
    firstName: `Участница№${i}`,
    lang: 'kg' as const,
    lat: BISHKEK.lat,
    lng: BISHKEK.lng,
    tz: BISHKEK.tz,
    blocked: i === BLOCKED_BEFORE,
  }));

  const inserted = await h.db.insert(participants).values(rows).returning({ id: participants.id });
  await h.db.insert(enrollments).values(
    inserted.map((p) => ({ participantId: p.id, marathonId, status: 'active' as const })),
  );
  chatIds = rows.map((r) => r.chatId);
  ourIds = inserted.map((p) => p.id);
}, 120_000);

afterAll(async () => {
  await wipeParticipants(h.db, TG_PREFIX);
  await h.close();
  delete process.env.MAX_MSG_PER_SECOND;
});

describe('рассылка на тысячу', () => {
  it(
    'снимок, прогресс, 403 и 429 — всё на настоящей тысяче получателей',
    async () => {
      // 429 с retry_after отдаём один раз: дальше autoRetry должен справиться сам.
      let rateLimitedOnce = false;
      h.setIntercept((call) => {
        if (call.method !== 'sendMessage') return undefined;
        const chat = String(call.payload.chat_id ?? '');

        if (chat === chatOf(FORBIDDEN)) {
          return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
        }
        if (chat === chatOf(RATE_LIMITED) && !rateLimitedOnce) {
          rateLimitedOnce = true;
          return {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 1',
            parameters: { retry_after: 1 },
          };
        }
        if (chat === chatOf(ALWAYS_LIMITED)) {
          return {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 1',
            parameters: { retry_after: 1 },
          };
        }
        return undefined;
      });

      // Сегмент «все активные» резолвится по всей базе, поэтому счётчики
      // рассылки зависели бы от чужих строк. Проверяем его отдельно, а саму
      // отправку гоняем по явному списку — тогда итоги принадлежат только нам.
      const preview = await h.broadcastSvc.resolveSegment(marathonId, { kind: 'all_active' });
      expect(preview.length).toBeGreaterThanOrEqual(RECIPIENTS - 1);

      const { id, count } = await h.broadcastSvc.create({
        marathonId,
        text: 'Салам, {имя}! Баллдарыңыз: {баллы}.',
        segment: { kind: 'selected', participantIds: ourIds },
        schedule: { kind: 'now' },
      });

      // Заблокировавшая бота в снимок не попадает вовсе.
      expect(count).toBe(RECIPIENTS - 1);

      const ours = await h.db
        .select({ participantId: broadcastDeliveries.participantId })
        .from(broadcastDeliveries)
        .innerJoin(participants, eq(participants.id, broadcastDeliveries.participantId))
        .where(like(participants.tgUserId, `${TG_PREFIX}%`));
      expect(ours).toHaveLength(RECIPIENTS - 1);

      // Разбор идёт порциями по сто, поэтому прогресс виден между заходами.
      const seen: number[] = [];
      for (let tick = 0; tick < 80; tick++) {
        await h.broadcasts.tick();
        const p = await h.broadcastSvc.progress(id);
        expect(p).toBeTruthy();
        if ((p!.totals.pending ?? 0) === 0) break;
        seen.push(p!.totals.sent);
      }

      expect(seen.length, 'рассылка не уложилась в один заход').toBeGreaterThan(1);
      expect(seen[0], 'после первого захода часть уже отправлена').toBeGreaterThan(0);
      expect(seen[0], 'но не вся рассылка').toBeLessThan(RECIPIENTS - 1);

      const done = await h.broadcastSvc.progress(id);
      expect(done!.status).toBe('done');
      expect(done!.totals.pending ?? 0).toBe(0);
      // Заблокировала бота ровно одна — та, что ответила 403. Неудача по
      // другой причине (429, который не вылечили повторы) считается отдельно:
      // в панели это не её решение, а наша проблема.
      expect(done!.totals.blocked).toBe(1);
      expect(done!.totals.failed).toBe(1);
      expect(done!.totals.sent).toBe(RECIPIENTS - 3);
      expect(done!.totals.count).toBe(RECIPIENTS - 1);

      // 403 помечает участницу заблокировавшей — больше ей не пишем.
      const [forbidden] = await h.db
        .select()
        .from(participants)
        .where(eq(participants.tgUserId, chatOf(FORBIDDEN)))
        .limit(1);
      expect(forbidden.blocked).toBe(true);

      // 429 не потерял сообщение: после повтора доставка отмечена отправленной.
      const [retried] = await h.db
        .select({ status: broadcastDeliveries.status })
        .from(broadcastDeliveries)
        .innerJoin(participants, eq(participants.id, broadcastDeliveries.participantId))
        .where(eq(participants.tgUserId, chatOf(RATE_LIMITED)))
        .limit(1);
      expect(rateLimitedOnce, '429 действительно был отдан').toBe(true);
      expect(retried.status).toBe('sent');

      // А безнадёжный 429 отмечен неудачей, и причина записана.
      const [failed] = await h.db
        .select({ status: broadcastDeliveries.status, error: broadcastDeliveries.error })
        .from(broadcastDeliveries)
        .innerJoin(participants, eq(participants.id, broadcastDeliveries.participantId))
        .where(eq(participants.tgUserId, chatOf(ALWAYS_LIMITED)))
        .limit(1);
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('429');

      // И такую участницу не помечаем заблокировавшей бота.
      const [stillHere] = await h.db
        .select()
        .from(participants)
        .where(eq(participants.tgUserId, chatOf(ALWAYS_LIMITED)))
        .limit(1);
      expect(stillHere.blocked).toBe(false);

      // Плейсхолдеры подставлены под конкретную участницу.
      const toFifth = h.sent.find(
        (c) => c.method === 'sendMessage' && String(c.payload.chat_id) === chatOf(5),
      );
      expect(String(toFifth?.payload.text)).toBe('Салам, Участница№5! Баллдарыңыз: 0.');

      // Заблокировавшей до создания не ушло ничего.
      expect(
        h.sent.some((c) => String(c.payload.chat_id) === chatOf(BLOCKED_BEFORE)),
      ).toBe(false);
      expect(chatIds).toHaveLength(RECIPIENTS);
    },
    120_000,
  );
});
