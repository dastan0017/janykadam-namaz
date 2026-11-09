import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

/**
 * Накатывает миграции drizzle-kit, а потом доустраивает то, что генератор не умеет:
 * расширение pg_trgm и триграммный индекс для поиска городов.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Нужен DATABASE_URL');

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // pg_trgm должен существовать до того, как мы создадим по нему индекс.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await migrate(db, { migrationsFolder: './drizzle' });

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS geonames_search_trgm_idx
    ON geonames USING gin (search_text gin_trgm_ops)
  `);

  // Одна строка настроек: держим инвариант на уровне БД.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bot_settings_singleton_idx
    ON bot_settings ((id IS NOT NULL))
  `);

  await pool.end();
  console.log('Миграции применены.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
