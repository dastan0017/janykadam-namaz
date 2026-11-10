import { Injectable, Logger } from '@nestjs/common';
import type { Composer } from 'grammy';
import { DateTime } from 'luxon';
import { utcOffsetLabel } from '../../domain/location';
import { joinTopics } from '../../domain/text';
import { toLocalDate } from '../../domain/windows';
import { LocationService } from '../../services/location.service';
import { ParticipantsService } from '../../services/participants.service';
import { PrayerService } from '../../services/prayer.service';
import { ReportsService } from '../../services/reports.service';
import { SettingsService } from '../../services/settings.service';
import { unpackId } from '../callback-data';
import type { Ctx } from '../context';
import {
  changeLocationKeyboard, languageKeyboard, locationKeyboard, mainKeyboard,
  notifyNextKeyboard, searchResultsKeyboard,
} from '../keyboards';

const PRAYER_LABELS_RU: Record<string, string> = {
  fajr: 'Багымдат', sunrise: 'Восход', dhuhr: 'Пешим', asr: 'Аср', maghrib: 'Шам', isha: 'Куптан',
};

/**
 * Регистрация и выбор места: /start с кодом марафона, язык, место, /zona, /til.
 */
@Injectable()
export class RegistrationFlow {
  private readonly log = new Logger(RegistrationFlow.name);

  constructor(
    private readonly participants: ParticipantsService,
    private readonly location: LocationService,
    private readonly prayer: PrayerService,
    private readonly reports: ReportsService,
    private readonly settings: SettingsService,
  ) {}

  register(bot: Composer<Ctx>): void {
    bot.command('start', (ctx) => this.onStart(ctx));
    bot.command('zona', (ctx) => this.askLocation(ctx));
    bot.command('til', (ctx) => this.askLanguage(ctx));

    bot.callbackQuery(/^lang:(kg|ru)$/, (ctx) => this.onLanguage(ctx));
    bot.callbackQuery('zona:change', (ctx) => this.askLocation(ctx));
    bot.callbackQuery(/^geo:(.+)$/, (ctx) => this.onSearchPick(ctx));
    bot.callbackQuery('next:yes', (ctx) => this.onNotifyNext(ctx));

    // Геолокация принимается в любой момент, не только через кнопку.
    bot.on('message:location', (ctx) => this.onLocationMessage(ctx));
  }

  /* ───────── /start ───────── */

  private async onStart(ctx: Ctx): Promise<void> {
    const code = (ctx.match as string | undefined)?.trim();
    const participant = ctx.participant;
    if (!participant) return;

    if (!code) {
      const live = await this.participants.liveEnrollments(participant.id);
      await ctx.reply(live.length ? await ctx.t('help') : await ctx.t('not_enrolled'));
      return;
    }

    const marathon = await this.participants.marathonByCode(code);
    if (!marathon) {
      await ctx.reply(await ctx.t('link_invalid'));
      return;
    }

    const closed = !marathon.regOpen || ['draft', 'finished', 'archive'].includes(marathon.status);
    if (closed) {
      await ctx.reply(await ctx.t('reg_closed', { марафон: marathon.name }), {
        reply_markup: notifyNextKeyboard(await ctx.t('btn_notify_next')),
      });
      return;
    }

    // Место уже известно — записываем сразу, спрашивать заново не нужно.
    if (participant.tz && participant.lat !== null && participant.lng !== null) {
      await this.enrollAndWelcome(ctx, marathon.id);
      return;
    }

    ctx.session.pendingMarathonId = marathon.id;
    await this.askLanguage(ctx, marathon.defaultLang);
  }

  private async askLanguage(ctx: Ctx, _preferred?: string): Promise<void> {
    ctx.session.step = 'choose_lang';
    await ctx.reply(await ctx.t('choose_language'), { reply_markup: languageKeyboard() });
  }

  private async onLanguage(ctx: Ctx): Promise<void> {
    const lang = ctx.callbackQuery?.data?.split(':')[1] === 'ru' ? 'ru' : 'kg';
    if (ctx.participant) {
      await this.participants.setLang(ctx.participant.id, lang);
      ctx.participant.lang = lang;
      ctx.lang = lang;
    }
    await ctx.answerCallbackQuery();

    // Язык меняли из /til — место уже есть, продолжать регистрацию не нужно.
    if (ctx.participant?.tz && !ctx.session.pendingMarathonId) {
      await ctx.reply(await ctx.t('language_changed'));
      await this.showMainKeyboard(ctx);
      return;
    }
    await this.askLocation(ctx);
  }

  /* ───────── место ───────── */

  /** Публичный: вызывается и по /zona, и с кнопки главной клавиатуры. */
  async askLocation(ctx: Ctx): Promise<void> {
    ctx.session.step = 'choose_location';
    const presets = await this.location.presets(ctx.lang);
    await ctx.reply(await ctx.t('choose_location'), {
      reply_markup: locationKeyboard(
        await ctx.t('btn_send_location'),
        presets.map((p) => ({ id: p.id, label: p.label })),
        await ctx.t('btn_other_city'),
      ),
    });
  }

  /** Нажата кнопка города-пресета или введено название для поиска. */
  async onLocationText(ctx: Ctx, text: string): Promise<boolean> {
    if (!ctx.participant) return false;

    const otherCity = await ctx.t('btn_other_city');
    if (text === otherCity) {
      ctx.session.step = 'location_search';
      await ctx.reply(await ctx.t('location_search_prompt'));
      return true;
    }

    const preset = await this.location.presetByLabel(text, ctx.lang);
    if (preset) {
      await this.applyLocation(ctx, this.location.fromPreset(preset, ctx.lang));
      return true;
    }

    if (ctx.session.step === 'location_search') {
      await this.runSearch(ctx, text);
      return true;
    }
    return false;
  }

  private async runSearch(ctx: Ctx, query: string): Promise<void> {
    const hits = await this.location.search(query, 6);
    if (hits.length === 0) {
      await ctx.reply(await ctx.t('location_not_found'));
      return;
    }

    // Запоминаем выдачу: в callback_data помещается только короткий ключ.
    const map: Record<string, { lat: number; lng: number; label: string; cc: string; tz: string }> = {};
    const buttons = hits.map((h, i) => {
      const id = String(i);
      // Показываем кириллицу, если она доказуемо то же название, что и запрос.
      const name = this.location.displayName(h, query);
      map[id] = { lat: h.lat, lng: h.lng, label: name, cc: h.countryCode, tz: h.timezone };
      return { id, label: this.location.hitLabel(h, ctx.lang, new Date(), query) };
    });
    ctx.session.searchHits = map;

    await ctx.reply(await ctx.t('location_search_results'), {
      reply_markup: searchResultsKeyboard(buttons, await ctx.t('btn_not_found_send_location')),
    });
  }

  private async onSearchPick(ctx: Ctx): Promise<void> {
    const raw = ctx.callbackQuery?.data?.split(':')[1];
    const id = raw === undefined ? undefined : unpackId(raw);
    await ctx.answerCallbackQuery();

    if (id === 'none') {
      await this.askLocation(ctx);
      return;
    }

    const hit = id ? ctx.session.searchHits?.[id] : undefined;
    if (!hit) {
      await ctx.reply(await ctx.t('location_not_found'));
      return;
    }

    await this.applyLocation(
      ctx,
      this.location.fromHit({
        geonameid: 0, name: hit.label, alternatenames: '', lat: hit.lat, lng: hit.lng,
        countryCode: hit.cc, timezone: hit.tz, population: 0, similarity: 1,
      }),
    );
  }

  private async onLocationMessage(ctx: Ctx): Promise<void> {
    const loc = ctx.message?.location;
    if (!loc || !ctx.participant) return;
    await this.applyLocation(ctx, this.location.fromCoords(loc.latitude, loc.longitude, await ctx.t('btn_send_location')));
  }

  /** Сохраняет место, показывает подтверждение с намазами и продолжает регистрацию. */
  private async applyLocation(ctx: Ctx, location: ReturnType<LocationService['fromCoords']>): Promise<void> {
    if (!ctx.participant) return;

    await this.participants.setLocation(ctx.participant.id, location);
    Object.assign(ctx.participant, {
      lat: location.lat, lng: location.lng, tz: location.tz,
      placeLabel: location.placeLabel, countryCode: location.countryCode, locationSource: location.source,
    });

    ctx.session.step = undefined;
    ctx.session.searchHits = undefined;

    const today = toLocalDate(new Date(), location.tz);
    const namazLine = await this.prayer.formatDay(location.lat, location.lng, today, location.tz, PRAYER_LABELS_RU);

    await ctx.reply(
      await ctx.t('location_confirmed', {
        место: location.placeLabel,
        пояс: utcOffsetLabel(location.tz),
        намазы: namazLine,
      }),
      { reply_markup: changeLocationKeyboard(await ctx.t('btn_change')) },
    );

    const pending = ctx.session.pendingMarathonId;
    if (pending) {
      ctx.session.pendingMarathonId = undefined;
      await this.enrollAndWelcome(ctx, pending);
    } else {
      await this.showMainKeyboard(ctx);
    }
  }

  /* ───────── запись в марафон ───────── */

  private async enrollAndWelcome(ctx: Ctx, marathonId: string): Promise<void> {
    if (!ctx.participant) return;

    const marathon = await this.participants.marathonById(marathonId);
    if (!marathon) return;

    const enrollment = await this.participants.enroll(ctx.participant.id, marathonId);
    await this.participants.setActiveEnrollment(ctx.participant.id, enrollment.id);
    ctx.participant.activeEnrollmentId = enrollment.id;

    if (marathon.status === 'recruiting') {
      const date = DateTime.fromISO(marathon.startDate).setLocale(ctx.lang === 'kg' ? 'ky' : 'ru').toFormat('d MMMM');
      await ctx.reply(await ctx.t('marathon_not_started', { марафон: marathon.name, дата: date }));
      await this.showMainKeyboard(ctx);
      return;
    }

    const ctxActive = await this.participants.activeContext(ctx.participant);
    const now = new Date();
    const open = ctxActive ? (await this.reports.candidates(ctxActive, now)).open : [];

    if (open.length === 0) {
      const next = ctxActive ? await this.reports.nextWindow(ctxActive, now) : null;
      await ctx.reply(
        next
          ? await ctx.t('open_now_none', {
              тема: this.nameOf(next, ctx.lang),
              время: DateTime.fromJSDate(next.opensAt, { zone: ctx.participant.tz! }).toFormat('HH:mm'),
            })
          : await ctx.t('open_now_none', { тема: '—', время: '—' }),
      );
    } else {
      await ctx.reply(
        await ctx.t('start_welcome', {
          имя: ctx.participant.firstName,
          марафон: marathon.name,
          открыто_сейчас: joinTopics(
            open.map((w) => ({
              emoji: w.emoji,
              name: this.nameOf(w, ctx.lang),
              until: DateTime.fromJSDate(w.closesAt, { zone: ctx.participant!.tz! }).toFormat('HH:mm'),
            })),
          ),
        }),
      );
    }
    await this.showMainKeyboard(ctx);
  }

  private async onNotifyNext(ctx: Ctx): Promise<void> {
    if (ctx.participant) await this.participants.setNextMarathonInterest(ctx.participant.id, true);
    await ctx.answerCallbackQuery();
  }

  private nameOf(w: { nameKg: string; nameRu: string }, lang: string): string {
    return lang === 'kg' ? w.nameKg || w.nameRu : w.nameRu || w.nameKg;
  }

  async showMainKeyboard(ctx: Ctx): Promise<void> {
    const { menu } = await this.settings.getSettings();
    const labels = menu.length ? menu : ['🎥', '⭐', '🕐', '❓'];
    await ctx.reply(await ctx.t('record_hint'), { reply_markup: mainKeyboard(labels) });
  }
}
