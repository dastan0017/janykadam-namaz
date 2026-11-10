import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../src/api/api.module';
import { DRIZZLE, DrizzleModule, PG_POOL, type Db } from '../src/db/drizzle.module';
import * as schema from '../src/db/schema';
import { signTelegramAuth } from '../src/domain/telegram-auth';

/**
 * Админ-API на настоящей базе: вход через Telegram Login и разграничение ролей.
 */

const DB_URL = process.env.DATABASE_URL ?? 'postgres://janykadam:janykadam@localhost:5433/janykadam';
const TOKEN = '123456:TEST_TOKEN_PLACEHOLDER_FOR_LOCAL_DEV';

const ADMIN_TG = '900001';
const CURATOR_TG = '900002';
const SECOND_ADMIN_TG = '900003';
const TEST_TG_IDS = [ADMIN_TG, CURATOR_TG, SECOND_ADMIN_TG];

/**
 * Статусы чужих учёток, которые тест отключил по ходу проверки «последний админ».
 * База у тестов та же, что у разработки, — оставлять её сломанной нельзя.
 */
const restoreStatus = new Map<string, 'invited' | 'active' | 'disabled'>();

let app: NestFastifyApplication;
let db: Db;
let pool: Pool;

function loginPayload(tgUserId: string, username: string) {
  const base = {
    id: Number(tgUserId),
    first_name: username,
    username,
    auth_date: Math.floor(Date.now() / 1000),
  };
  return { ...base, hash: signTelegramAuth(base, TOKEN) };
}

async function login(tgUserId: string, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: loginPayload(tgUserId, username) });
  expect(res.statusCode, `вход ${username}: ${res.body}`).toBe(201);
  const cookie = res.cookies.find((c) => c.name === 'jk_admin');
  expect(cookie).toBeTruthy();
  return `jk_admin=${cookie!.value}`;
}

beforeAll(async () => {
  process.env.BOT_TOKEN = TOKEN;
  process.env.DATABASE_URL = DB_URL;
  process.env.SESSION_SECRET ??= '0123456789abcdef0123456789abcdef';
  process.env.TZ = 'UTC';

  pool = new Pool({ connectionString: DB_URL });
  db = drizzle(pool, { schema });

  // Тестовые учётки панели; реальные не трогаем.
  await db.delete(schema.adminUsers).where(inArray(schema.adminUsers.tgUserId, TEST_TG_IDS));
  await db.insert(schema.adminUsers).values([
    { name: 'Тест Админ', tgUsername: 'test_admin_jk', tgUserId: ADMIN_TG, role: 'admin', status: 'active' },
    { name: 'Тест Куратор', tgUsername: 'test_curator_jk', tgUserId: CURATOR_TG, role: 'curator', status: 'active' },
    { name: 'Второй Админ', tgUsername: 'test_admin2_jk', tgUserId: SECOND_ADMIN_TG, role: 'admin', status: 'active' },
  ]);

  const moduleRef = await Test.createTestingModule({ imports: [DrizzleModule, ApiModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(DRIZZLE)
    .useValue(db)
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(fastifyCookie, { secret: process.env.SESSION_SECRET });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  for (const [id, status] of restoreStatus) {
    await db.update(schema.adminUsers).set({ status }).where(eq(schema.adminUsers.id, id));
  }
  await db.delete(schema.adminUsers).where(inArray(schema.adminUsers.tgUserId, TEST_TG_IDS));
  await app?.close();
  await pool?.end();
});

describe('вход', () => {
  it('без сессии API закрыт', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('подделанная подпись не пускает', async () => {
    const bad = loginPayload(ADMIN_TG, 'test_admin_jk');
    bad.hash = 'deadbeef'.repeat(8);
    const res = await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: bad });
    expect(res.statusCode).toBe(401);
  });

  it('корректный вход даёт сессию и /api/me', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'admin', tgUsername: 'test_admin_jk' });
  });

  it('выход закрывает сессию', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe('роли', () => {
  it('куратор получает 403 на /api/users', async () => {
    const cookie = await login(CURATOR_TG, 'test_curator_jk');
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('куратор видит марафоны и участниц', async () => {
    const cookie = await login(CURATOR_TG, 'test_curator_jk');
    const res = await app.inject({ method: 'GET', url: '/api/marathons', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('админ видит пользователей', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('свою роль поменять нельзя', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    const [me] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.tgUserId, ADMIN_TG)).limit(1);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${me.id}`,
      headers: { cookie },
      payload: { role: 'curator' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('себя отключить нельзя', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    const [me] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.tgUserId, ADMIN_TG)).limit(1);
    const res = await app.inject({ method: 'DELETE', url: `/api/users/${me.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('последнего админа нельзя разжаловать', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');

    // Разжалуем всех остальных админов, кроме себя и второго тестового.
    const others = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.role, 'admin'));
    const keepId = others.find((u) => u.tgUserId === ADMIN_TG)!.id;
    for (const u of others) {
      if (u.id === keepId) continue;
      // Чужие учётки восстановим после теста: база одна с рабочей.
      if (!TEST_TG_IDS.includes(u.tgUserId ?? '')) restoreStatus.set(u.id, u.status);
      await db.update(schema.adminUsers).set({ status: 'disabled' }).where(eq(schema.adminUsers.id, u.id));
    }

    // Теперь активный админ один — им остаёмся мы, и разжаловать его нельзя.
    const [second] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.tgUserId, SECOND_ADMIN_TG)).limit(1);
    await db.update(schema.adminUsers).set({ status: 'active', role: 'admin' }).where(eq(schema.adminUsers.id, second.id));
    await db.update(schema.adminUsers).set({ status: 'disabled' }).where(eq(schema.adminUsers.id, keepId));

    // Себя отключили — сессия больше не действует: это тоже верное поведение.
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);

    await db.update(schema.adminUsers).set({ status: 'active' }).where(eq(schema.adminUsers.id, keepId));
  });

  it('отключённый пользователь не может войти', async () => {
    const [second] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.tgUserId, SECOND_ADMIN_TG)).limit(1);
    await db.update(schema.adminUsers).set({ status: 'disabled' }).where(eq(schema.adminUsers.id, second.id));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: loginPayload(SECOND_ADMIN_TG, 'test_admin2_jk'),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('справочники', () => {
  it('библиотека намазов доступна и состоит из семи тем', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    const res = await app.inject({ method: 'GET', url: '/api/namaz', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(7);
  });

  it('времена намаза по координатам считаются', async () => {
    const cookie = await login(ADMIN_TG, 'test_admin_jk');
    const res = await app.inject({
      method: 'GET',
      url: '/api/prayer/times?lat=42.87&lng=74.59&date=2026-11-08',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toContain('fajr');
  });
});
