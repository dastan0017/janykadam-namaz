import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Пункт 13 чек-листа: удалённых сущностей не должно быть нигде — ни в коде,
 * ни в таблицах, ни в текстах, ни в меню.
 *
 * Нет команд, кодов команд, капитанов и кураторов-на-команду. Нет «Кадамдар» и
 * «Командам». Нет модерации и очереди проверки. Нет типов отчёта кроме
 * видеокружка: ни фото, ни обычного видео, ни «без подтверждения».
 */

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['src', 'drizzle'];
const SKIP = new Set(['node_modules', 'dist', 'data', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|sql|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

/**
 * Убирает комментарии: объяснение, почему сущности нет, не должно считаться
 * её наличием. Проверяем код и данные, а не прозу о них.
 */
function stripComments(text: string): string[] {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return withoutBlocks.split('\n').map((line) => line.replace(/\/\/.*$|--.*$/g, ''));
}

/** Ищет шаблон и возвращает места, где он встретился. */
function find(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (file.endsWith('removed-features.test.ts')) continue;
    for (const [i, line] of stripComments(readFileSync(file, 'utf8')).entries()) {
      if (pattern.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

describe('удалённые возможности отсутствуют', () => {
  it('нет команд и кодов команд', () => {
    expect(find(/\bteam(s)?\b|team_code|teamId|invite_code/i)).toEqual([]);
  });

  it('нет капитанов', () => {
    expect(find(/\bcaptain/i)).toEqual([]);
  });

  it('нет «Кадамдар» и «Командам»', () => {
    expect(find(/кадамдар|кадам\b|командам/i)).toEqual([]);
  });

  it('нет модерации и очереди проверки', () => {
    expect(find(/moderat|модерац|review_queue|approve_report|reject_report/i)).toEqual([]);
  });

  it('нет типов подтверждения кроме видеокружка', () => {
    // proof_type, photo-отчёты и «без подтверждения» не должны существовать.
    expect(find(/proof_type|proofType|'photo'\s*\|\s*'video'|no_proof/i)).toEqual([]);
  });

  it('отчёт хранит только видеокружок', () => {
    const schema = readFileSync(join(ROOT, 'src/db/schema.ts'), 'utf8');
    expect(schema).toContain('videoFileId');
    expect(schema).toContain('videoFileUniqueId');
    // Файл не скачиваем — путей к файлам в схеме нет.
    expect(schema).not.toMatch(/file_path|filePath|downloaded/i);
  });

  it('в меню бота ровно четыре кнопки и в них нет удалённых пунктов', () => {
    const seed = readFileSync(join(ROOT, 'src/db/seed.ts'), 'utf8');
    const match = /const MENU_KG = \[([^\]]+)\]/.exec(seed);
    expect(match, 'меню найдено в сиде').toBeTruthy();
    const items = match![1].split(',').filter((s) => s.trim());
    expect(items).toHaveLength(4);
    expect(match![1]).not.toMatch(/кадам|командам/i);
  });
});
