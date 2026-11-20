import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Читает `.env` проекта. Без этого тесты зависели бы от окружения оболочки:
 * чужой `DATABASE_URL` увёл бы их в чужую базу, и падение выглядело бы как
 * «нет таблицы participants».
 */
function dotenv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // .env может отсутствовать: тогда работают значения по умолчанию.
  }
  return out;
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Весь расчёт времени предполагает TZ=UTC — как и в проде.
    env: { ...dotenv(), TZ: 'UTC' },
    // База одна на все файлы, и часть тестов заводит в ней одну и ту же
    // участницу. Параллельные файлы мешали бы друг другу.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
