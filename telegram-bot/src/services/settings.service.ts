import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { botSettings, botTexts } from '../db/schema';
import { ZERO_TUNE, methodVersion, type PrayerTune } from '../domain/prayer';
import { pick, render, type Lang, type TextRow } from '../domain/text';

export interface BotSettingsRow {
  quietFrom: string;
  quietTo: string;
  capPerDay: number;
  menu: string[];
  commands: { command: string; description: string }[];
  description: string;
  shortDescription: string;
  prayerTune: PrayerTune;
  methodVersion: string;
}

const CACHE_TTL_MS = 30_000;

/**
 * Настройки бота и тексты. И то и другое правится из панели и читается на
 * каждое сообщение, поэтому держим короткий кэш: правка доезжает за полминуты,
 * а база не получает запрос на каждый апдейт.
 */
@Injectable()
export class SettingsService {
  private readonly log = new Logger(SettingsService.name);

  private settings: BotSettingsRow | null = null;
  private settingsAt = 0;

  private texts = new Map<string, TextRow>();
  private textsAt = 0;

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async getSettings(): Promise<BotSettingsRow> {
    if (this.settings && Date.now() - this.settingsAt < CACHE_TTL_MS) return this.settings;

    const [row] = await this.db.select().from(botSettings).where(eq(botSettings.id, 1)).limit(1);
    const tune = { ...ZERO_TUNE, ...(row?.prayerTune ?? {}) } as PrayerTune;

    this.settings = {
      quietFrom: row?.quietFrom ?? '22:30',
      quietTo: row?.quietTo ?? '04:30',
      capPerDay: row?.capPerDay ?? 6,
      menu: row?.menu ?? [],
      commands: row?.commands ?? [],
      description: row?.description ?? '',
      shortDescription: row?.shortDescription ?? '',
      prayerTune: tune,
      // Если в базе версия не записана, считаем её из поправок.
      methodVersion: row?.methodVersion?.trim() ? row.methodVersion : methodVersion(tune),
    };
    this.settingsAt = Date.now();
    return this.settings;
  }

  private async loadTexts(): Promise<Map<string, TextRow>> {
    if (this.texts.size > 0 && Date.now() - this.textsAt < CACHE_TTL_MS) return this.texts;

    const rows = await this.db.select().from(botTexts);
    this.texts = new Map(rows.map((r) => [r.key, { key: r.key, ru: r.ru, kg: r.kg }]));
    this.textsAt = Date.now();
    return this.texts;
  }

  /** Текст по ключу с подстановкой. Отсутствующий ключ виден в логах и в ответе. */
  async t(key: string, lang: Lang, values: Record<string, string | number | undefined> = {}): Promise<string> {
    const texts = await this.loadTexts();
    const row = texts.get(key);
    if (!row) {
      this.log.warn(`Нет текста с ключом ${key}`);
      return `[${key}]`;
    }
    return render(pick(row, lang), values);
  }

  /** Сбрасывает кэш — вызывается после правки из панели. */
  invalidate(): void {
    this.settings = null;
    this.settingsAt = 0;
    this.texts.clear();
    this.textsAt = 0;
  }
}
