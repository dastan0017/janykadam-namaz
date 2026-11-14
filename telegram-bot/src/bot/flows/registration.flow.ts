import { Injectable, Logger } from '@nestjs/common';
import type { Composer } from 'grammy';
import { DateTime } from 'luxon';
import { utcOffsetLabel, type Location } from '../../domain/location';
import { joinTopics } from '../../domain/text';
import { toLocalDate } from '../../domain/windows';
import { ChannelsService } from '../../services/channels.service';
import { LocationService } from '../../services/location.service';
import { GOAL_MAX_LENGTH, ParticipantsService } from '../../services/participants.service';
import { PrayerService } from '../../services/prayer.service';
import { ReportsService } from '../../services/reports.service';
import { SettingsService } from '../../services/settings.service';
import { unpackId } from '../callback-data';
import type { Ctx } from '../context';
import {
  changeLocationKeyboard, channelKeyboard, goalAskKeyboard, languageKeyboard, locationKeyboard, mainKeyboard,
  notifyNextKeyboard, rulesKeyboard, searchResultsKeyboard,
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
    private readonly channels: ChannelsService,
  ) {}

  register(bot: Composer<Ctx>): void {
    bot.command('start', (ctx) => this.onStart(ctx));
    bot.command('zona', (ctx) => this.askLocation(ctx));
    bot.command('til', (ctx) => this.askLanguage(ctx));

    bot.callbackQuery(/^lang:(kg|ru)$/, (ctx) => this.onLanguage(ctx));
    bot.callbackQuery('zona:change', (ctx) => this.askLocation(ctx));
    bot.callbackQuery(/^geo:(.+)$/, (ctx) => this.onSearchPick(ctx));
    bot.callbackQuery('next:yes', (ctx) => this.onNotifyNext(ctx));
    bot.callbackQuery('rules:yes', (ctx) => this.onRulesAccept(ctx));
    bot.callbackQuery('rules:no', (ctx) => this.onRulesDecline(ctx));
    bot.callbackQuery('goal:write', (ctx) => this.onGoalWrite(ctx));
    bot.callbackQuery('goal:keep', (ctx) => this.onGoalKeep(ctx));
    bot.callbackQuery('goal:later', (ctx) => this.onGoalLater(ctx));

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

    // Язык и место спрашиваем при каждом входе по ссылке: за месяцы между
    // марафонами участница могла переехать, а место задаёт время намазов.
    // Вернувшейся это два нажатия: её город стоит первой кнопкой.
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
    const keep = this.currentLocation(ctx);

    await ctx.reply(await ctx.t('choose_location'), {
      reply_markup: locationKeyboard(
        await ctx.t('btn_send_location'),
        presets.map((p) => ({ id: p.id, label: p.label })),
        await ctx.t('btn_other_city'),
        keep ? await ctx.t('btn_keep_location', { место: keep.placeLabel }) : undefined,
      ),
    });
  }

  /** Место, которое у участницы уже есть. `null` — впервые. */
  private currentLocation(ctx: Ctx): Location | null {
    const p = ctx.participant;
    if (!p?.tz || p.lat === null || p.lng === null) return null;
    return {
      lat: p.lat,
      lng: p.lng,
      tz: p.tz,
      placeLabel: p.placeLabel || p.tz,
      countryCode: p.countryCode ?? '',
      source: p.locationSource ?? 'preset',
    };
  }

  /** Нажата кнопка города-пресета или введено название для поиска. */
  async onLocationText(ctx: Ctx, text: string): Promise<boolean> {
    if (!ctx.participant) return false;

    // «Оставить: Бишкек» — то же место, но дальше по флоу, как после выбора.
    const keep = this.currentLocation(ctx);
    if (keep && text === (await ctx.t('btn_keep_location', { место: keep.placeLabel }))) {
      await this.applyLocation(ctx, keep);
      return true;
    }

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
    await this.applyLocation(ctx, await this.location.fromCoords(loc.latitude, loc.longitude));
  }

  /** Сохраняет место, показывает подтверждение с намазами и продолжает регистрацию. */
  private async applyLocation(ctx: Ctx, location: Location): Promise<void> {
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

  /* ───────── правила марафона ───────── */

  /**
   * Правила показываются до записи: участница берёт на себя обязательства,
   * и отказ не должен оставлять её в марафоне. Текст — свой у марафона, а
   * если его нет, общий из текстов бота.
   */
  private async askRules(ctx: Ctx, marathon: { id: string; name: string; rulesKg: string | null; rulesRu: string | null }): Promise<void> {
    const own = ctx.lang === 'kg' ? marathon.rulesKg : marathon.rulesRu;
    const other = ctx.lang === 'kg' ? marathon.rulesRu : marathon.rulesKg;
    const rules = own?.trim() || other?.trim() || (await ctx.t('marathon_rules'));

    ctx.session.pendingMarathonId = marathon.id;
    await ctx.reply(`${await ctx.t('rules_ask', { марафон: marathon.name })}\n\n${rules}`, {
      reply_markup: rulesKeyboard(await ctx.t('btn_rules_accept'), await ctx.t('btn_rules_decline')),
    });
  }

  private async onRulesAccept(ctx: Ctx): Promise<void> {
    await ctx.answerCallbackQuery();
    const marathonId = ctx.session.pendingMarathonId;
    if (!marathonId || !ctx.participant) return;

    const marathon = await this.participants.marathonById(marathonId);
    if (!marathon) return;

    await ctx.reply(await ctx.t('rules_accepted'));
    await this.finishEnroll(ctx, marathon);
  }

  private async onRulesDecline(ctx: Ctx): Promise<void> {
    await ctx.answerCallbackQuery();
    ctx.session.pendingMarathonId = undefined;
    await ctx.reply(await ctx.t('rules_declined'));
  }

  /* ───────── запись в марафон ───────── */

  private async enrollAndWelcome(ctx: Ctx, marathonId: string): Promise<void> {
    if (!ctx.participant) return;

    const marathon = await this.participants.marathonById(marathonId);
    if (!marathon) return;

    // Уже согласившуюся повторно не спрашиваем: она возвращается в свой марафон.
    const existing = await this.participants.enrollmentOf(ctx.participant.id, marathonId);
    if (!existing?.rulesAcceptedAt) {
      await this.askRules(ctx, marathon);
      return;
    }

    await this.finishEnroll(ctx, marathon);
  }

  private async finishEnroll(ctx: Ctx, marathon: { id: string; name: string; status: string; startDate: string }): Promise<void> {
    if (!ctx.participant) return;

    const marathonId = marathon.id;
    const enrollment = await this.participants.enroll(ctx.participant.id, marathonId);
    await this.participants.markRulesAccepted(enrollment.id);
    await this.participants.setActiveEnrollment(ctx.participant.id, enrollment.id);
    ctx.participant.activeEnrollmentId = enrollment.id;
    ctx.session.pendingMarathonId = undefined;

    // Цель спрашиваем до приветствия: сначала вопросы, потом «вы записаны».
    ctx.session.welcomeMarathonId = marathon.id;
    await this.askGoal(ctx, enrollment.goal);
  }

  /* ───────── цель марафона ───────── */

  /**
   * Вопрос о цели. Спрашивается при каждом входе по ссылке: цель у марафона
   * своя, и за месяцы она меняется. Прежнюю видно в вопросе — её можно
   * оставить одной кнопкой.
   */
  async askGoal(ctx: Ctx, current?: string | null): Promise<void> {
    const goal = current?.trim();
    ctx.session.step = 'goal';

    await ctx.reply(goal ? await ctx.t('goal_ask_again', { максат: goal }) : await ctx.t('goal_ask'), {
      reply_markup: goal
        ? goalAskKeyboard(await ctx.t('btn_goal_keep'), 'goal:keep')
        : goalAskKeyboard(await ctx.t('btn_goal_later'), 'goal:later'),
    });
  }

  /** Ответ на вопрос о цели. `true` — сообщение разобрано здесь. */
  async onGoalText(ctx: Ctx, text: string): Promise<boolean> {
    if (ctx.session.step !== 'goal' || !ctx.participant) return false;

    if (text.length > GOAL_MAX_LENGTH) {
      await ctx.reply(await ctx.t('goal_too_long', { предел: GOAL_MAX_LENGTH }));
      return true;
    }

    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      ctx.session.step = undefined;
      await ctx.reply(await ctx.t('not_enrolled'));
      return true;
    }

    await this.participants.setGoal(active.enrollment.id, text);
    await ctx.reply(await ctx.t('goal_saved', { максат: text.trim() }));
    await this.afterGoal(ctx);
    return true;
  }

  private async onGoalWrite(ctx: Ctx): Promise<void> {
    await ctx.answerCallbackQuery();
    if (!ctx.participant) return;
    const active = await this.participants.activeContext(ctx.participant);
    await this.askGoal(ctx, active?.enrollment.goal);
  }

  private async onGoalKeep(ctx: Ctx): Promise<void> {
    await ctx.answerCallbackQuery();
    await ctx.reply(await ctx.t('goal_kept'));
    await this.afterGoal(ctx);
  }

  private async onGoalLater(ctx: Ctx): Promise<void> {
    await ctx.answerCallbackQuery();
    await ctx.reply(await ctx.t('goal_skipped'));
    await this.afterGoal(ctx);
  }

  /**
   * После ответа о цели. Если вопрос был частью записи — показываем
   * приветствие; если цель меняли из меню, показывать нечего.
   */
  private async afterGoal(ctx: Ctx): Promise<void> {
    ctx.session.step = undefined;
    const marathonId = ctx.session.welcomeMarathonId;
    ctx.session.welcomeMarathonId = undefined;
    if (!marathonId || !ctx.participant) return;

    const marathon = await this.participants.marathonById(marathonId);
    if (!marathon) return;
    await this.welcome(ctx, marathon);
    await this.inviteToChannel(ctx, marathon);
  }

  /** Кнопка в канал марафона — последним сообщением записи, чтобы не потерялась. */
  private async inviteToChannel(ctx: Ctx, marathon: { id: string; name: string }): Promise<void> {
    if (!ctx.participant) return;
    const url = await this.channels.inviteLinkOf(marathon.id);
    if (!url) return;

    await ctx.reply(await ctx.t('channel_invite', { марафон: marathon.name }), {
      reply_markup: channelKeyboard(await ctx.t('btn_channel_join'), url),
    });
    const enrollment = await this.participants.enrollmentOf(ctx.participant.id, marathon.id);
    if (enrollment) await this.channels.markInvited(enrollment.id);
  }

  /* ───────── приветствие ───────── */

  private async welcome(ctx: Ctx, marathon: { name: string; status: string; startDate: string }): Promise<void> {
    if (!ctx.participant) return;

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
    await ctx.reply(await ctx.t('record_hint'), { reply_markup: mainKeyboard(await this.settings.menu(ctx.lang)) });
  }
}
