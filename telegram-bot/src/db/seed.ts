import { DateTime } from 'luxon';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NAMAZ_TOPICS, KAZA_QUESTION } from '../domain/namaz';
import { ZERO_TUNE, methodVersion } from '../domain/prayer';
import * as s from './schema';
import { BOT_TEXTS } from './seed-texts';
import { assertProjectDatabase, loadDotenv } from '../config/dotenv';

/**
 * Сид. Базовая часть нужна всегда, демо-данные — только при SEED_DEMO=true.
 */

const PRESETS = [
  { position: 0, labelRu: 'Бишкек', labelKg: 'Бишкек', lat: 42.87, lng: 74.59, tz: 'Asia/Bishkek' },
  { position: 1, labelRu: 'Ош', labelKg: 'Ош', lat: 40.53, lng: 72.8, tz: 'Asia/Bishkek' },
  { position: 2, labelRu: 'Алматы', labelKg: 'Алматы', lat: 43.24, lng: 76.89, tz: 'Asia/Almaty' },
  { position: 3, labelRu: 'Москва', labelKg: 'Москва', lat: 55.76, lng: 37.62, tz: 'Europe/Moscow' },
  { position: 4, labelRu: 'Стамбул', labelKg: 'Стамбул', lat: 41.01, lng: 28.98, tz: 'Europe/Istanbul' },
  { position: 5, labelRu: 'Сеул', labelKg: 'Сеул', lat: 37.57, lng: 126.98, tz: 'Asia/Seoul' },
  { position: 6, labelRu: 'Нью-Йорк', labelKg: 'Нью-Йорк', lat: 40.71, lng: -74.01, tz: 'America/New_York' },
];

const MENU_KG = ['🎥 Отчёт тапшыруу', '⭐ Баллдарым', '🕐 Убакыт алкагы', '❓ Жардам'];

const COMMANDS = [
  { command: 'otchet', description: 'Что можно сдать сейчас' },
  { command: 'ball', description: 'Мои баллы' },
  { command: 'zona', description: 'Место и время' },
  { command: 'marafon', description: 'Сменить марафон' },
  { command: 'pauza', description: 'Пауза' },
  { command: 'tahajjud', description: 'Напоминания о Тахаджуде' },
  { command: 'til', description: 'Язык' },
  { command: 'help', description: 'Помощь' },
];

async function main(): Promise<void> {
  loadDotenv();
  assertProjectDatabase();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Нужен DATABASE_URL');

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s });

  /* ───── фиксированные темы-намазы ───── */
  for (const [i, n] of NAMAZ_TOPICS.entries()) {
    await db
      .insert(s.namazTopics)
      .values({
        id: n.id, position: i, emoji: n.emoji, nameKg: n.nameKg, nameRu: n.nameRu,
        ruleKg: n.ruleKg, ruleRu: n.ruleRu, points: n.points, mandatory: n.mandatory, optIn: n.optIn ?? false,
      })
      .onConflictDoUpdate({
        target: s.namazTopics.id,
        set: {
          position: i, emoji: n.emoji, nameKg: n.nameKg, nameRu: n.nameRu,
          ruleKg: n.ruleKg, ruleRu: n.ruleRu, points: n.points, mandatory: n.mandatory, optIn: n.optIn ?? false,
        },
      });
  }

  // Единственный вопрос Каза намаза.
  const existingKaza = await db.query.questions.findFirst({ where: (q, { eq }) => eq(q.namazId, KAZA_QUESTION.namazId) });
  if (!existingKaza) {
    await db.insert(s.questions).values({
      namazId: KAZA_QUESTION.namazId,
      position: KAZA_QUESTION.position,
      textKg: KAZA_QUESTION.textKg,
      textRu: KAZA_QUESTION.textRu,
      type: KAZA_QUESTION.type,
      required: KAZA_QUESTION.required,
    });
  }

  /* ───── пресеты мест ───── */
  for (const p of PRESETS) {
    const exists = await db.query.locationPresets.findFirst({ where: (t, { eq }) => eq(t.labelRu, p.labelRu) });
    if (!exists) await db.insert(s.locationPresets).values(p);
  }

  /* ───── тексты ───── */
  for (const t of BOT_TEXTS) {
    await db
      .insert(s.botTexts)
      .values({ key: t.key, ru: t.ru, kg: t.kg, placeholders: t.placeholders })
      .onConflictDoNothing();
  }

  /* ───── настройки бота ───── */
  await db
    .insert(s.botSettings)
    .values({
      id: 1,
      quietFrom: '22:30',
      quietTo: '04:30',
      capPerDay: 6,
      menu: MENU_KG,
      commands: COMMANDS,
      description: 'Жаңы Кадам жамаатынын марафон боту. Күн сайын видеокружок менен отчёт тапшырыңыз.',
      shortDescription: 'Марафондор боту Janykadam',
      prayerTune: ZERO_TUNE,
      methodVersion: methodVersion(ZERO_TUNE),
    })
    .onConflictDoNothing();

  /* ───── первый админ ───── */
  const initialAdmin = process.env.INITIAL_ADMIN_TG_USERNAME?.replace(/^@/, '');
  if (initialAdmin) {
    const exists = await db.query.adminUsers.findFirst({
      where: (u, { sql }) => sql`lower(${u.tgUsername}) = lower(${initialAdmin})`,
    });
    if (!exists) {
      await db.insert(s.adminUsers).values({
        name: initialAdmin,
        tgUsername: initialAdmin,
        role: 'admin',
        status: 'invited',
      });
      console.log(`Первый админ: @${initialAdmin}`);
    }
  }

  if (process.env.SEED_DEMO === 'true') await seedDemo(db);

  await pool.end();
  console.log('Сид выполнен.');
}

async function seedDemo(db: ReturnType<typeof drizzle<typeof s>>): Promise<void> {
  const existing = await db.query.marathons.findFirst({ where: (m, { eq }) => eq(m.code, 'm5') });
  if (existing) {
    console.log('Демо-данные уже есть.');
    return;
  }

  const start = DateTime.utc().minus({ days: 19 });
  const end = start.plus({ days: 29 });

  const [m5] = await db
    .insert(s.marathons)
    .values({
      code: 'm5',
      name: 'Үммөттүн кызы',
      status: 'running',
      startDate: start.toFormat('yyyy-MM-dd'),
      endDate: end.toFormat('yyyy-MM-dd'),
      defaultLang: 'kg',
      regOpen: true,
      latePasses: 2,
      excusedDays: 3,
      streakBonus: 5,
      streakEvery: 7,
      remindMorning: '05:30',
      remindEvening: '21:00',
    })
    .returning();

  // Все семь намазов.
  for (const n of NAMAZ_TOPICS) {
    await db.insert(s.marathonNamaz).values({ marathonId: m5.id, namazId: n.id }).onConflictDoNothing();
  }

  const custom = [
    { position: 0, emoji: '📿', nameKg: 'Зикир', nameRu: 'Зикр', startLocal: '05:00', endLocal: '23:00', points: 5 },
    { position: 1, emoji: '📝', nameKg: 'Күндү пландоо', nameRu: 'Планирование дня', startLocal: '05:00', endLocal: '10:00', points: 5 },
    { position: 2, emoji: '🏃‍♀️', nameKg: 'Спорт', nameRu: 'Спорт', startLocal: '06:00', endLocal: '22:00', points: 10 },
    { position: 3, emoji: '📖', nameKg: 'Китеп окуу', nameRu: 'Чтение книги', startLocal: '05:00', endLocal: '23:00', points: 0 },
    { position: 4, emoji: '🌠', nameKg: 'Күндү анализдөө', nameRu: 'Анализ дня', startLocal: '20:00', endLocal: '23:59', points: 5 },
  ];

  const inserted = await db
    .insert(s.topics)
    .values(custom.map((c) => ({ ...c, marathonId: m5.id })))
    .returning();

  // «Китеп окуу»: один вопрос с разной ценой вариантов.
  const reading = inserted.find((t) => t.nameKg === 'Китеп окуу')!;
  const [q1] = await db
    .insert(s.questions)
    .values({
      topicId: reading.id, position: 0,
      textKg: 'Канча бет окудуңуз?', textRu: 'Сколько страниц прочитали?',
      type: 'single', required: true,
    })
    .returning();
  await db.insert(s.questionOptions).values([
    { questionId: q1.id, position: 0, labelKg: '1 бет', labelRu: '1 страница', points: 3 },
    { questionId: q1.id, position: 1, labelKg: '2–5 бет', labelRu: '2–5 страниц', points: 4 },
    { questionId: q1.id, position: 2, labelKg: '5+ бет', labelRu: '5+ страниц', points: 5 },
  ]);

  // «Күндү анализдөө»: шкала и необязательный текст.
  const analysis = inserted.find((t) => t.nameKg === 'Күндү анализдөө')!;
  const [q2] = await db
    .insert(s.questions)
    .values({
      topicId: analysis.id, position: 0,
      textKg: 'Бүгүнкү күнүңүздү кандай баалайсыз?', textRu: 'Как оцениваете свой день?',
      type: 'scale', required: true,
    })
    .returning();
  await db.insert(s.questionOptions).values(
    [1, 2, 3, 4, 5].map((n) => ({
      questionId: q2.id, position: n - 1, labelKg: String(n), labelRu: String(n), points: 1, locked: true,
    })),
  );
  await db.insert(s.questions).values({
    topicId: analysis.id, position: 1,
    textKg: 'Эртең эмнени жакшыртасыз?', textRu: 'Что улучшите завтра?',
    type: 'text', required: false,
  });

  // Второй марафон — черновик, только Багымдат.
  const [m6] = await db
    .insert(s.marathons)
    .values({
      code: 'm6',
      name: 'Кыш марафону',
      status: 'draft',
      startDate: DateTime.utc().plus({ days: 21 }).toFormat('yyyy-MM-dd'),
      endDate: DateTime.utc().plus({ days: 51 }).toFormat('yyyy-MM-dd'),
      defaultLang: 'kg',
      regOpen: false,
    })
    .returning();
  await db.insert(s.marathonNamaz).values({ marathonId: m6.id, namazId: 't2' });

  console.log('Демо-данные созданы: m5 (идёт) и m6 (черновик).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
