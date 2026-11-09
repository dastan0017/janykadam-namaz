import { Injectable, Logger } from '@nestjs/common';
import type { Composer } from 'grammy';
import { DateTime } from 'luxon';
import { NAMAZ_BY_ID } from '../../domain/namaz';
import { latePassesLeft } from '../../domain/scoring';
import { joinTopics } from '../../domain/text';
import type { WindowInstance } from '../../domain/windows';
import { ParticipantsService, type ActiveContext } from '../../services/participants.service';
import { ReportsService, type Draft } from '../../services/reports.service';
import { TopicsService, type QuestionDef } from '../../services/topics.service';
import type { Ctx } from '../context';
import {
  autoAssignedKeyboard, confirmKeyboard, optionsKeyboard, resumeKeyboard, topicPickerKeyboard,
} from '../keyboards';

/** Сохранённый ответ на один вопрос. */
interface AnswerValue {
  optionIds?: string[];
  text?: string;
  number?: number;
  points: number;
}

/** Кнопка «Изменить» после авто-выбора живёт две минуты. */
const CHANGE_WINDOW_MS = 2 * 60_000;
const TEXT_ANSWER_LIMIT = 1000;

/**
 * Приём отчёта. Единственное доказательство — видеокружок; он не проверяется,
 * факт отправки в открытое окно и есть принятый отчёт.
 */
@Injectable()
export class ReportFlow {
  private readonly log = new Logger(ReportFlow.name);

  constructor(
    private readonly participants: ParticipantsService,
    private readonly reports: ReportsService,
    private readonly topics: TopicsService,
  ) {}

  register(bot: Composer<Ctx>): void {
    bot.on('message:video_note', (ctx) => this.onVideoNote(ctx));
    bot.callbackQuery(/^rp:([^:]+):(.+)$/, (ctx) => this.onPickTopic(ctx));
    bot.callbackQuery(/^rpp:([^:]+):(\d+)$/, (ctx) => this.onPickerPage(ctx));
    bot.callbackQuery(/^rpc:(.+)$/, (ctx) => this.onChangeTopic(ctx));
    bot.callbackQuery(/^late:(yes|no)$/, (ctx) => this.onLateAnswer(ctx));
    bot.callbackQuery(/^ans:([^:]+):(.+)$/, (ctx) => this.onAnswerOption(ctx));
    bot.callbackQuery(/^ansdone:(.+)$/, (ctx) => this.onAnswerDone(ctx));
    bot.callbackQuery(/^ansskip:(.+)$/, (ctx) => this.onAnswerSkip(ctx));
  }

  private name(w: { nameKg: string; nameRu: string }, lang: string): string {
    return lang === 'kg' ? w.nameKg || w.nameRu : w.nameRu || w.nameKg;
  }

  private hhmm(d: Date, tz: string): string {
    return DateTime.fromJSDate(d, { zone: tz }).toFormat('HH:mm');
  }

  /* ───────── приём видеокружка ───────── */

  private async onVideoNote(ctx: Ctx): Promise<void> {
    const msg = ctx.message;
    if (!msg?.video_note || !ctx.participant) return;

    // Пересланный кружок — не её собственный.
    if (msg.forward_origin) {
      await ctx.reply(await ctx.t('report_forwarded'));
      return;
    }

    const uniqueId = msg.video_note.file_unique_id;
    if (await this.reports.videoAlreadyUsed(uniqueId)) {
      await ctx.reply(await ctx.t('report_duplicate_video'));
      return;
    }

    const active = await this.participants.activeContext(ctx.participant);
    if (!active) {
      await ctx.reply(await ctx.t('not_enrolled'));
      return;
    }

    if (active.enrollment.status === 'paused') {
      await ctx.reply(await ctx.t('paused_hint'), { reply_markup: resumeKeyboard(await ctx.t('btn_resume')) });
      return;
    }

    // Время отправки, а не обработки: окно могло закрыться, пока шла очередь.
    const sentAt = new Date(msg.date * 1000);
    const { open, late } = await this.reports.candidates(active, sentAt);

    if (open.length === 0 && late.length === 0) {
      const next = await this.reports.nextWindow(active, sentAt);
      await ctx.reply(
        await ctx.t('open_now_none', {
          тема: next ? this.name(next, ctx.lang) : '—',
          время: next ? this.hhmm(next.opensAt, ctx.participant.tz!) : '—',
        }),
      );
      return;
    }

    const draft = await this.reports.createDraft({
      participantId: ctx.participant.id,
      enrollmentId: active.enrollment.id,
      videoFileId: msg.video_note.file_id,
      videoFileUniqueId: uniqueId,
      videoDurationSec: msg.video_note.duration,
      sentAt,
    });
    ctx.session.draftId = draft.id;

    // Ровно один кандидат и никаких поздних — не спрашиваем, а назначаем.
    if (open.length === 1 && late.length === 0) {
      const w = open[0];
      const assigned = await this.reports.assignTopic(draft.id, w, false);
      await ctx.reply(await ctx.t('auto_assigned', { тема: `${w.emoji} ${this.name(w, ctx.lang)}` }), {
        reply_markup: autoAssignedKeyboard(draft.id, await ctx.t('btn_change')),
      });
      await this.continueAfterTopic(ctx, assigned, active, w);
      return;
    }

    await this.showPicker(ctx, draft.id, open, late, 0);
  }

  private async showPicker(ctx: Ctx, draftId: string, open: WindowInstance[], late: WindowInstance[], page: number): Promise<void> {
    const tz = ctx.participant?.tz ?? 'UTC';
    const items = [
      ...open.map((w) => ({
        topicId: w.topicId,
        label: `${w.emoji} ${this.name(w, ctx.lang)} (${this.hhmm(w.closesAt, tz)})`,
        late: false,
      })),
      // Поздние — отдельной группой с часами.
      ...late.map((w) => ({ topicId: w.topicId, label: `⏰ ${w.emoji} ${this.name(w, ctx.lang)}`, late: true })),
    ];

    await ctx.reply(await ctx.t('topic_picker'), {
      reply_markup: topicPickerKeyboard(draftId, items, page, await ctx.t('btn_more')),
    });
  }

  /* ───────── выбор темы ───────── */

  private async onPickerPage(ctx: Ctx): Promise<void> {
    const [, draftId, pageStr] = ctx.callbackQuery!.data!.split(':');
    await ctx.answerCallbackQuery();

    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active) {
      await ctx.reply(await ctx.t('draft_expired'));
      return;
    }
    const { open, late } = await this.reports.candidates(active, draft.sentAt);
    await this.showPicker(ctx, draftId, open, late, Number(pageStr));
  }

  private async onChangeTopic(ctx: Ctx): Promise<void> {
    const draftId = ctx.callbackQuery!.data!.split(':')[1];
    await ctx.answerCallbackQuery();

    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active) {
      await ctx.reply(await ctx.t('draft_expired'));
      return;
    }
    // Передумать можно только сразу после автоматического выбора.
    if (Date.now() - draft.createdAt.getTime() > CHANGE_WINDOW_MS) return;

    const { open, late } = await this.reports.candidates(active, draft.sentAt);
    await ctx.reply(await ctx.t('choose_topic_again'));
    await this.showPicker(ctx, draftId, open, late, 0);
  }

  private async onPickTopic(ctx: Ctx): Promise<void> {
    const data = ctx.callbackQuery!.data!;
    const idx = data.indexOf(':', 3);
    const draftId = data.slice(3, idx);
    const topicId = data.slice(idx + 1);
    await ctx.answerCallbackQuery();

    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active) {
      await ctx.reply(await ctx.t('draft_expired'));
      return;
    }

    const { open, late } = await this.reports.candidates(active, draft.sentAt);
    const chosenOpen = open.find((w) => w.topicId === topicId);
    const chosenLate = late.find((w) => w.topicId === topicId);
    const w = chosenOpen ?? chosenLate;

    if (!w) {
      await ctx.reply(await ctx.t('report_duplicate', { тема: topicId }));
      return;
    }

    if (chosenLate) {
      // Поздняя сдача тратит попытку — спрашиваем явно.
      const left = latePassesLeft(active.marathon.latePasses, active.enrollment.latePassesUsed);
      await this.reports.assignTopic(draft.id, w, true);
      ctx.session.draftId = draft.id;
      await ctx.reply(await ctx.t('late_offer', { тема: this.name(w, ctx.lang), поздние: left }), {
        reply_markup: confirmKeyboard(await ctx.t('btn_yes'), await ctx.t('btn_no'), 'late'),
      });
      return;
    }

    const assigned = await this.reports.assignTopic(draft.id, w, false);
    await this.continueAfterTopic(ctx, assigned, active, w);
  }

  private async onLateAnswer(ctx: Ctx): Promise<void> {
    const yes = ctx.callbackQuery!.data!.endsWith(':yes');
    await ctx.answerCallbackQuery();

    const draftId = ctx.session.draftId;
    const draft = draftId ? await this.reports.findDraft(draftId) : undefined;
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active) {
      await ctx.reply(await ctx.t('draft_expired'));
      return;
    }

    if (!yes) {
      await this.reports.dropDraft(draft.id);
      ctx.session.draftId = undefined;
      return;
    }

    const w = await this.windowOfDraft(draft, active);
    if (w) await this.continueAfterTopic(ctx, draft, active, w);
  }

  /** Восстанавливает окно, записанное в черновик. */
  private async windowOfDraft(draft: Draft, active: ActiveContext): Promise<WindowInstance | null> {
    if (!draft.topicId || !draft.dayKey || !draft.windowOpensAt || !draft.windowClosesAt) return null;

    const enabled = await this.reports.enabledTopicsOf(active.marathon.id);
    const namaz = NAMAZ_BY_ID.get(draft.topicId as never);
    const custom = enabled.custom.find((c) => c.id === draft.topicId);
    const meta = namaz ?? custom;
    if (!meta) return null;

    return {
      topicKind: draft.topicKind!,
      topicId: draft.topicId,
      dayKey: draft.dayKey,
      opensAt: draft.windowOpensAt,
      closesAt: draft.windowClosesAt,
      mandatory: 'mandatory' in meta ? meta.mandatory : false,
      points: meta.points,
      emoji: meta.emoji,
      nameKg: meta.nameKg,
      nameRu: meta.nameRu,
      optIn: 'optIn' in meta ? !!meta.optIn : false,
      remindOffsetMin: 0,
    };
  }

  /* ───────── вопросы ───────── */

  private async continueAfterTopic(ctx: Ctx, draft: Draft, active: ActiveContext, w: WindowInstance): Promise<void> {
    const questions = await this.topics.questionsFor(w.topicKind, w.topicId);
    if (questions.length === 0) {
      await this.finish(ctx, draft, active, w, []);
      return;
    }
    ctx.session.step = 'answering';
    ctx.session.draftId = draft.id;
    await this.askQuestion(ctx, draft, questions, 0);
  }

  private async askQuestion(ctx: Ctx, draft: Draft, questions: QuestionDef[], index: number): Promise<void> {
    const q = questions[index];
    if (!q) return;

    const text = ctx.lang === 'kg' ? q.textKg || q.textRu : q.textRu || q.textKg;
    const skipLabel = q.required ? undefined : await ctx.t('btn_skip');

    if (q.type === 'text' || q.type === 'number') {
      await ctx.reply(text, skipLabel ? { reply_markup: optionsKeyboard(draft.id, q.id, [], { skipLabel }) } : undefined);
      return;
    }

    const answers = (draft.answers ?? {}) as Record<string, AnswerValue>;
    const chosen = new Set(answers[q.id]?.optionIds ?? []);

    await ctx.reply(text, {
      reply_markup: optionsKeyboard(
        draft.id,
        q.id,
        q.options.map((o) => ({
          id: o.id,
          label: ctx.lang === 'kg' ? o.labelKg || o.labelRu : o.labelRu || o.labelKg,
          checked: chosen.has(o.id),
        })),
        { multi: q.type === 'multi', doneLabel: q.type === 'multi' ? await ctx.t('btn_done') : undefined, skipLabel },
      ),
    });
  }

  private async onAnswerOption(ctx: Ctx): Promise<void> {
    const data = ctx.callbackQuery!.data!;
    const idx = data.indexOf(':', 4);
    const draftId = data.slice(4, idx);
    const optionId = data.slice(idx + 1);
    await ctx.answerCallbackQuery();

    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active || !draft.topicId) {
      await ctx.reply(await ctx.t('draft_expired'));
      return;
    }

    const questions = await this.topics.questionsFor(draft.topicKind!, draft.topicId);
    const q = questions[draft.questionIndex];
    if (!q) return;

    const option = q.options.find((o) => o.id === optionId);
    if (!option) return;

    const answers = { ...((draft.answers ?? {}) as Record<string, AnswerValue>) };

    if (q.type === 'multi') {
      const current = new Set(answers[q.id]?.optionIds ?? []);
      if (current.has(optionId)) current.delete(optionId);
      else current.add(optionId);
      const ids = [...current];
      answers[q.id] = { optionIds: ids, points: ids.reduce((s, id) => s + (q.options.find((o) => o.id === id)?.points ?? 0), 0) };
      const updated = await this.reports.setAnswers(draft.id, answers, draft.questionIndex);
      await this.askQuestion(ctx, updated, questions, draft.questionIndex);
      return;
    }

    answers[q.id] = { optionIds: [optionId], points: option.points };
    await this.advance(ctx, draft, active, questions, answers);
  }

  private async onAnswerDone(ctx: Ctx): Promise<void> {
    const draftId = ctx.callbackQuery!.data!.split(':')[1];
    await ctx.answerCallbackQuery();
    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active || !draft.topicId) return;

    const questions = await this.topics.questionsFor(draft.topicKind!, draft.topicId);
    await this.advance(ctx, draft, active, questions, (draft.answers ?? {}) as Record<string, AnswerValue>);
  }

  private async onAnswerSkip(ctx: Ctx): Promise<void> {
    const draftId = ctx.callbackQuery!.data!.split(':')[1];
    await ctx.answerCallbackQuery();
    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active || !draft.topicId) return;

    const questions = await this.topics.questionsFor(draft.topicKind!, draft.topicId);
    await this.advance(ctx, draft, active, questions, (draft.answers ?? {}) as Record<string, AnswerValue>);
  }

  /** Текстовый или числовой ответ. Возвращает true, если сообщение поглощено. */
  async onTextAnswer(ctx: Ctx, text: string): Promise<boolean> {
    const draftId = ctx.session.draftId;
    if (!draftId || ctx.session.step !== 'answering') return false;

    const draft = await this.reports.findDraft(draftId);
    const active = ctx.participant ? await this.participants.activeContext(ctx.participant) : null;
    if (!draft || !active || !draft.topicId) {
      ctx.session.step = undefined;
      ctx.session.draftId = undefined;
      return false;
    }

    const questions = await this.topics.questionsFor(draft.topicKind!, draft.topicId);
    const q = questions[draft.questionIndex];
    if (!q || (q.type !== 'text' && q.type !== 'number')) return false;

    const answers = { ...((draft.answers ?? {}) as Record<string, AnswerValue>) };

    if (q.type === 'number') {
      const n = Number(text.trim());
      if (!Number.isInteger(n) || n < 0 || n > 999) {
        await ctx.reply(await ctx.t('question_number_invalid'));
        return true;
      }
      answers[q.id] = { number: n, points: 0 };
    } else {
      if (text.length > TEXT_ANSWER_LIMIT) {
        await ctx.reply(await ctx.t('question_text_too_long'));
        return true;
      }
      answers[q.id] = { text, points: 0 };
    }

    await this.advance(ctx, draft, active, questions, answers);
    return true;
  }

  private async advance(
    ctx: Ctx,
    draft: Draft,
    active: ActiveContext,
    questions: QuestionDef[],
    answers: Record<string, AnswerValue>,
  ): Promise<void> {
    const nextIndex = draft.questionIndex + 1;
    const updated = await this.reports.setAnswers(draft.id, answers, nextIndex);

    if (nextIndex < questions.length) {
      await this.askQuestion(ctx, updated, questions, nextIndex);
      return;
    }

    const w = await this.windowOfDraft(updated, active);
    if (w) await this.finish(ctx, updated, active, w, Object.values(answers).map((a) => a.points));
  }

  /* ───────── сохранение ───────── */

  private async finish(
    ctx: Ctx,
    draft: Draft,
    active: ActiveContext,
    w: WindowInstance,
    optionPoints: number[],
  ): Promise<void> {
    const topicName = this.name(w, ctx.lang);

    const { awarded, total } = await this.reports.save({
      draft,
      topicPoints: w.points,
      optionPoints,
      topicName: w.nameKg || w.nameRu,
      consumesLatePass: draft.late,
    });

    ctx.session.step = undefined;
    ctx.session.draftId = undefined;

    await ctx.reply(await ctx.t('report_accepted', { тема: topicName, баллы: awarded, всего: total }));

    // Если что-то ещё открыто — одной строкой, чтобы не плодить сообщения.
    const { open } = await this.reports.candidates(active, new Date());
    if (open.length > 0) {
      const tz = ctx.participant?.tz ?? 'UTC';
      await ctx.reply(
        await ctx.t('still_open', {
          список: joinTopics(
            open.map((x) => ({ emoji: x.emoji, name: this.name(x, ctx.lang), until: this.hhmm(x.closesAt, tz) })),
          ),
        }),
      );
    }
  }
}
