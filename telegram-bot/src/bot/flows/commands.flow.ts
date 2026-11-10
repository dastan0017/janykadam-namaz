import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Composer } from 'grammy';
import { DateTime } from 'luxon';
import { Inject } from '@nestjs/common';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { enrollments } from '../../db/schema';
import { joinTopics } from '../../domain/text';
import { toLocalDate } from '../../domain/windows';
import { ParticipantsService } from '../../services/participants.service';
import { ReportsService } from '../../services/reports.service';
import { unpackId } from '../callback-data';
import type { Ctx } from '../context';
import { marathonSwitchKeyboard, pauseLengthKeyboard } from '../keyboards';

/** Команды участницы, кроме регистрации и приёма отчёта. */
@Injectable()
export class CommandsFlow {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly participants: ParticipantsService,
    private readonly reports: ReportsService,
  ) {}

  register(bot: Composer<Ctx>): void {
    bot.command('otchet', (ctx) => this.onOtchet(ctx));
    bot.command('ball', (ctx) => this.onBall(ctx));
    bot.command('marafon', (ctx) => this.onMarafon(ctx));
    bot.command('pauza', (ctx) => this.onPauza(ctx));
    bot.command('tahajjud', (ctx) => this.onTahajjud(ctx));
    bot.command('help', (ctx) => this.onHelp(ctx));

    bot.callbackQuery(/^mar:(.+)$/, (ctx) => this.onSwitchMarathon(ctx));
    bot.callbackQuery(/^sub:(.+)$/, (ctx) => this.onSubmitFor(ctx));
    bot.callbackQuery(/^pause:(.+)$/, (ctx) => this.onPauseChoice(ctx));
  }

  private name(w: { nameKg: string; nameRu: string }, lang: string): string {
    return lang === 'kg' ? w.nameKg || w.nameRu : w.nameRu || w.nameKg;
  }

  private hhmm(d: Date, tz: string): string {
    return DateTime.fromJSDate(d, { zone: tz }).toFormat('HH:mm');
  }

  /* ───────── /otchet ───────── */

  async onOtchet(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    const now = new Date();
    const { open } = await this.reports.candidates(active, now);
    const tz = ctx.participant.tz ?? 'UTC';

    if (open.length === 0) {
      const next = await this.reports.nextWindow(active, now);
      await ctx.reply(
        await ctx.t('open_now_none', {
          тема: next ? this.name(next, ctx.lang) : '—',
          время: next ? this.hhmm(next.opensAt, tz) : '—',
        }),
      );
      return;
    }

    const list = joinTopics(
      open.map((w) => ({ emoji: w.emoji, name: this.name(w, ctx.lang), until: this.hhmm(w.closesAt, tz) })),
    );
    await ctx.reply(`${list}\n\n${await ctx.t('record_hint')}`);
  }

  /* ───────── /ball ───────── */

  async onBall(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    const now = new Date();
    const tz = ctx.participant.tz ?? 'UTC';
    const status = await this.reports.todayStatus(active, now);
    const done = status.filter((s) => s.done).length;
    // Намазы в узур из знаменателя убираем: их сегодня не ждут.
    const asked = status.filter((s) => !s.uzur).length;

    const summary = await ctx.t('points_summary', {
      баллы: active.enrollment.points,
      серия: active.enrollment.streak,
      сдано: done,
      всего: asked,
    });

    // По каждой теме: сдано, узур, открыто, ещё откроется или упущено.
    const lines = status.map(({ window: w, done, uzur }) => {
      const icon = done
        ? '✅'
        : uzur
          ? '🤍'
          : now < w.opensAt
            ? `🕒 ${this.hhmm(w.opensAt, tz)}`
            : now < w.closesAt
              ? `⏳ ${this.hhmm(w.closesAt, tz)}`
              : '✖️';
      return `${icon} ${w.emoji} ${this.name(w, ctx.lang)}`;
    });

    await ctx.reply(`${summary}\n\n${lines.join('\n')}`);
  }

  /* ───────── /marafon ───────── */

  async onMarafon(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const list = await this.participants.switchableEnrollments(ctx.participant.id);

    if (list.length === 0) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }
    if (list.length === 1) {
      await ctx.reply(await ctx.t('no_marathons_to_switch'));
      return;
    }

    await ctx.reply(await ctx.t('choose_marathon', { марафон: list[0].marathon.name }), {
      reply_markup: marathonSwitchKeyboard(
        list.map((x) => ({ enrollmentId: x.enrollment.id, label: x.marathon.name })),
      ),
    });
  }

  private async onSwitchMarathon(ctx: Ctx): Promise<void> {
    const enrollmentId = unpackId(ctx.callbackQuery!.data!.split(':')[1]);
    await ctx.answerCallbackQuery();
    await this.switchTo(ctx, enrollmentId);
  }

  /** Кнопка «Сдать для «марафон»» в напоминании переключает контекст. */
  private async onSubmitFor(ctx: Ctx): Promise<void> {
    const enrollmentId = unpackId(ctx.callbackQuery!.data!.split(':')[1]);
    await ctx.answerCallbackQuery();
    await this.switchTo(ctx, enrollmentId);
    await this.onOtchet(ctx);
  }

  private async switchTo(ctx: Ctx, enrollmentId: string): Promise<void> {
    if (!ctx.participant) return;
    const mine = await this.participants.switchableEnrollments(ctx.participant.id);
    const picked = mine.find((x) => x.enrollment.id === enrollmentId);
    if (!picked) return;

    await this.participants.setActiveEnrollment(ctx.participant.id, enrollmentId);
    ctx.participant.activeEnrollmentId = enrollmentId;
    await ctx.reply(await ctx.t('marathon_switched', { марафон: picked.marathon.name }));
  }

  /* ───────── /pauza ───────── */

  async onPauza(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    if (!active.marathon.pauseAllowed) {
      await ctx.reply(await ctx.t('pause_not_allowed'));
      return;
    }

    // Повторный вызов снимает паузу.
    if (active.enrollment.status === 'paused') {
      await this.db
        .update(enrollments)
        .set({ status: 'active', pausedUntil: null })
        .where(eq(enrollments.id, active.enrollment.id));
      await ctx.reply(await ctx.t('resumed'));
      return;
    }

    ctx.session.step = 'pause_length';
    await ctx.reply(await ctx.t('pause_choose_length'), {
      reply_markup: pauseLengthKeyboard(
        await ctx.t('btn_pause_3d'),
        await ctx.t('btn_pause_week'),
        await ctx.t('btn_pause_until_cancel'),
      ),
    });
  }

  private async onPauseChoice(ctx: Ctx): Promise<void> {
    const choice = ctx.callbackQuery!.data!.split(':')[1];
    await ctx.answerCallbackQuery();
    if (!ctx.participant) return;

    const active = await this.participants.activeContext(ctx.participant);
    if (!active) return;

    if (choice === 'resume') {
      await this.db
        .update(enrollments)
        .set({ status: 'active', pausedUntil: null })
        .where(eq(enrollments.id, active.enrollment.id));
      await ctx.reply(await ctx.t('resumed'));
      return;
    }

    const days = Number(choice);
    const tz = ctx.participant.tz ?? 'UTC';
    const until = days > 0 ? DateTime.now().setZone(tz).plus({ days }).toFormat('yyyy-MM-dd') : null;

    await this.db
      .update(enrollments)
      .set({ status: 'paused', pausedUntil: until })
      .where(eq(enrollments.id, active.enrollment.id));

    ctx.session.step = undefined;
    await ctx.reply(
      await ctx.t('paused', { дата: until ?? (await ctx.t('btn_pause_until_cancel')) }),
    );
    void toLocalDate;
  }

  /* ───────── /tahajjud, /help ───────── */

  async onTahajjud(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const on = !ctx.participant.tahajjudReminders;
    await this.participants.setTahajjud(ctx.participant.id, on);
    ctx.participant.tahajjudReminders = on;
    await ctx.reply(await ctx.t(on ? 'tahajjud_on' : 'tahajjud_off'));
  }

  async onHelp(ctx: Ctx): Promise<void> {
    const help = await ctx.t('help');
    const credit = await ctx.t('geonames_credit');
    await ctx.reply(`${help}\n\n${credit}`);
  }
}
