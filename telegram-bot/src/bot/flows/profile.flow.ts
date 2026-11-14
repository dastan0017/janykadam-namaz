import { Inject, Injectable } from '@nestjs/common';
import type { Composer } from 'grammy';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { toLocalDate } from '../../domain/windows';
import { ChannelsService } from '../../services/channels.service';
import { ParticipantsService, type ActiveContext } from '../../services/participants.service';
import type { Ctx } from '../context';
import { aboutKeyboard, goalKeyboard } from '../keyboards';

/**
 * Цель, рейтинг и узур — всё, что участница знает о себе.
 *
 * Цель спрашивается при записи в марафон и хранится у записи: марафоны разные,
 * и цель в каждом своя. Узур — день, когда намазы не требуются; остальные темы
 * марафона в этот день сдаются как обычно, поэтому это не уважительный день
 * целиком, который ставит куратор.
 */
@Injectable()
export class ProfileFlow {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly participants: ParticipantsService,
    private readonly channels: ChannelsService,
  ) {}

  register(bot: Composer<Ctx>): void {
    bot.callbackQuery(/^uzur:(on|off)$/, (ctx) => this.onUzur(ctx));
  }

  /* ───────── цель ───────── */

  /** Кнопка «Максаттарым»: цель и возможность её изменить. */
  async onGoals(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    const goal = active.enrollment.goal?.trim();
    await ctx.reply(goal ? await ctx.t('goal_mine', { максат: goal }) : await ctx.t('goal_none'), {
      reply_markup: goalKeyboard(await ctx.t(goal ? 'btn_goal_change' : 'btn_goal_write')),
    });
  }

  /* ───────── «Өзүм жөнүндө» ───────── */

  async onAbout(ctx: Ctx): Promise<void> {
    if (!ctx.participant) return;
    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    const rating = await this.participants.rating(active.marathon.id, active.enrollment.id);
    const goal = active.enrollment.goal?.trim();
    const dayKey = this.today(active);
    const scope = await this.participants.excusedScopeOn(active.enrollment.id, dayKey);

    const blocks: string[] = [];

    if (rating) {
      const lines = rating.top.map((r) => `${r.place}. ${r.me ? '👉 ' : ''}${r.name} — ${r.points}`);
      // Своё место показываем отдельной строкой, если в пятёрку не попали.
      if (!rating.top.some((r) => r.me)) {
        lines.push('...', `${rating.me.place}. 👉 ${rating.me.name} — ${rating.me.points}`);
      }
      blocks.push(
        [
          await ctx.t('rating_title', { всего: rating.total }),
          lines.join('\n'),
          '',
          await ctx.t('rating_you', { место: rating.me.place, позади: rating.behind }),
        ].join('\n'),
      );
    } else {
      blocks.push(await ctx.t('rating_empty'));
    }

    blocks.push(goal ? await ctx.t('goal_mine', { максат: goal }) : await ctx.t('goal_none'));

    const channelUrl = await this.channels.inviteLinkOf(active.marathon.id);
    await ctx.reply(blocks.join('\n\n'), {
      reply_markup: aboutKeyboard(
        await ctx.t(scope === 'namaz' ? 'btn_uzur_off' : 'btn_uzur_on'),
        scope === 'namaz',
        await ctx.t(goal ? 'btn_goal_change' : 'btn_goal_write'),
        channelUrl ? { label: await ctx.t('btn_channel_join'), url: channelUrl } : undefined,
      ),
    });
  }

  /* ───────── узур ───────── */

  private async onUzur(ctx: Ctx): Promise<void> {
    const on = ctx.callbackQuery?.data === 'uzur:on';
    await ctx.answerCallbackQuery();
    if (!ctx.participant) return;

    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    const dayKey = this.today(active);
    const scope = await this.participants.excusedScopeOn(active.enrollment.id, dayKey);

    // День уже уважительный от куратора — он снимает и так всё, трогать нечего.
    if (scope === 'day') {
      await ctx.reply(await ctx.t('uzur_curator_day'));
      return;
    }

    await this.participants.setNamazExcused(active.enrollment.id, dayKey, on);
    await ctx.reply(await ctx.t(on ? 'uzur_on' : 'uzur_off'));
  }

  /** Сегодня — по времени участницы: день кончается у неё, а не на сервере. */
  private today(active: ActiveContext): string {
    const tz = active.participant.tz ?? 'UTC';
    return toLocalDate(new Date(), tz);
  }
}
