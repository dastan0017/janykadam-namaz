import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://janykadam:janykadam@localhost:5432/janykadam',
  },
  casing: 'snake_case',
} satisfies Config;
