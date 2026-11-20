import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Чтение `.env` и защита от чужой базы.
 *
 * Скрипты (`db:migrate`, `seed`, `import:geonames`) запускают руками, и
 * `DATABASE_URL` другого проекта, экспортированный в профиле разработчика,
 * однажды увёл миграции в постороннюю базу: там появились пустые таблицы этого
 * проекта. Поэтому мало прочитать `.env` — нужно ещё заметить расхождение.
 *
 * В образе `.env` нет (он в `.dockerignore`): в проде переменные приходят из
 * окружения контейнера, и оба вызова ничего не делают.
 */

/** Разбирает файл в пары ключ-значение, не трогая process.env. */
export function readDotenv(file = '.env'): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return out;
  }

  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Дополняет окружение значениями из `.env`, не перекрывая уже заданные:
 * `SEED_DEMO=true pnpm seed` должен работать так, как написано в README.
 */
export function loadDotenv(file = '.env'): void {
  for (const [key, value] of Object.entries(readDotenv(file))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Скрывает пароль в строке подключения, чтобы её можно было напечатать. */
function mask(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
}

/**
 * Останавливает скрипт, если `DATABASE_URL` из окружения не тот, что в `.env`.
 * Молчит, когда `.env` нет (прод) или значения совпадают.
 */
export function assertProjectDatabase(file = '.env'): void {
  const expected = readDotenv(file).DATABASE_URL;
  const actual = process.env.DATABASE_URL;
  if (!expected || !actual || expected === actual) return;

  throw new Error(
    [
      'DATABASE_URL из окружения не совпадает с .env проекта.',
      `  окружение: ${mask(actual)}`,
      `  .env:      ${mask(expected)}`,
      'Скрипт остановлен, чтобы не изменить постороннюю базу.',
      'Снимите переменную (unset DATABASE_URL) или приведите .env в соответствие.',
    ].join('\n'),
  );
}
