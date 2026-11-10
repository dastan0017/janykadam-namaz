import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { botSettings, botTexts } from '../db/schema';
import { BOT_TEXTS } from '../db/seed-texts';
import { MENU, matchMenu, type MenuAction } from '../domain/menu';
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
export class SettingsService implements OnModuleInit {
  private readonly log = new Logger(SettingsService.name);

  private settings: BotSettingsRow | null = null;
  private settingsAt = 0;

  private texts = new Map<string, TextRow>();
  private textsAt = 0;

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Добавляет тексты, появившиеся в коде после последнего сида. Правленые из
   * панели не трогает. Без этого после выката новый ключ отвечал бы «[ключ]».
   */
  async onModuleInit(): Promise<void> {
    const have = new Set((await this.db.select({ key: botTexts.key }).from(botTexts)).map((r) => r.key));
    const missing = BOT_TEXTS.filter((x) => !have.has(x.key));
    if (missing.length === 0) return;

    await this.db
      .insert(botTexts)
      .values(missing.map((x) => ({ key: x.key, ru: x.ru, kg: x.kg, placeholders: x.placeholders })))
      .onConflictDoNothing();
    this.invalidate();
    this.log.log(`Добавлены тексты бота: ${missing.map((x) => x.key).join(', ')}`);
  }

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

  /* ───────── главное меню ───────── */

  /** Надписи кнопок главного меню на языке участницы. */
  async menu(lang: Lang): Promise<string[]> {
    return Promise.all(MENU.map((m) => this.t(m.textKey, lang)));
  }

  /**
   * Что нажали в меню. Сравниваем с обоими языками: участница могла сменить
   * язык, а клавиатура у неё осталась прежней, пока не придёт новая.
   */
  async menuAction(text: string): Promise<MenuAction | null> {
    const labels = await Promise.all(
      MENU.map(async (m) => ({ action: m.action, labels: [await this.t(m.textKey, 'kg'), await this.t(m.textKey, 'ru')] })),
    );
    return matchMenu(text, labels);
  }

  /** Сбрасывает кэш — вызывается после правки из панели. */
  invalidate(): void {
    this.settings = null;
    this.settingsAt = 0;
    this.texts.clear();
    this.textsAt = 0;
  }
}
