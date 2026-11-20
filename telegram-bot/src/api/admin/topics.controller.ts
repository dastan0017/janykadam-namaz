import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { questionOptions, questions, topics } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import type { AuthedRequest } from '../auth/guards';

const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const topicBody = z.object({
  emoji: z.string().optional(),
  nameKg: z.string().optional(),
  nameRu: z.string().optional(),
  active: z.boolean().optional(),
  startLocal: hhmm.optional(),
  endLocal: hhmm.optional(),
  points: z.number().int().min(0).optional(),
  freq: z.enum(['daily', 'weekly']).optional(),
  mandatory: z.boolean().optional(),
  remindOffsetMin: z.union([z.literal(0), z.literal(30), z.literal(-30)]).optional(),
});

const questionBody = z.object({
  textKg: z.string().optional(),
  textRu: z.string().optional(),
  type: z.enum(['single', 'multi', 'text', 'number', 'scale', 'yesno']).optional(),
  required: z.boolean().optional(),
});

const optionBody = z.object({
  labelKg: z.string().optional(),
  labelRu: z.string().optional(),
  points: z.number().int().optional(),
});

/** Свои темы марафона, их вопросы и варианты ответа. Намазы не редактируются. */
@Controller('api')
export class TopicsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  @Get('marathons/:id/topics')
  async list(@Param('id') marathonId: string) {
    const rows = await this.db.select().from(topics).where(eq(topics.marathonId, marathonId)).orderBy(asc(topics.position));
    return Promise.all(
      rows.map(async (t) => ({
        ...t,
        questions: await this.questionsOf(t.id),
      })),
    );
  }

  @Post('marathons/:id/topics')
  async create(@Param('id') marathonId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const data = topicBody.parse(body);
    const existing = await this.db.select({ id: topics.id }).from(topics).where(eq(topics.marathonId, marathonId));
    const [row] = await this.db
      .insert(topics)
      .values({ ...data, marathonId, position: existing.length })
      .returning();
    await this.auth.audit(req.admin ?? null, 'create', 'topic', row.id, { marathonId });
    return row;
  }

  @Patch('topics/:id')
  async patch(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const data = topicBody.parse(body);
    const [row] = await this.db.update(topics).set(data).where(eq(topics.id, id)).returning();
    if (!row) throw new NotFoundException('Тема не найдена');
    await this.auth.audit(req.admin ?? null, 'update', 'topic', id, data as Record<string, unknown>);
    return row;
  }

  @Delete('topics/:id')
  async remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.db.delete(topics).where(eq(topics.id, id));
    await this.auth.audit(req.admin ?? null, 'delete', 'topic', id, {});
    return { ok: true };
  }

  @Post('marathons/:id/topics/reorder')
  async reorder(@Param('id') marathonId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(body);
    await this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx.update(topics).set({ position: i }).where(eq(topics.id, id));
      }
    });
    await this.auth.audit(req.admin ?? null, 'reorder', 'topic', marathonId, { ids });
    return { ids };
  }

  /* ───────── вопросы ───────── */

  @Post('topics/:id/questions')
  async addQuestion(@Param('id') topicId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const data = questionBody.parse(body);
    const existing = await this.db.select({ id: questions.id }).from(questions).where(eq(questions.topicId, topicId));
    const [row] = await this.db
      .insert(questions)
      .values({ ...data, topicId, position: existing.length })
      .returning();

    // У шкалы и да/нет надписи заданы типом — создаём их сразу.
    await this.seedLockedOptions(row.id, data.type ?? 'single');
    await this.auth.audit(req.admin ?? null, 'create', 'question', row.id, { topicId });
    return row;
  }

  @Patch('questions/:id')
  async patchQuestion(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const data = questionBody.parse(body);
    const [row] = await this.db.update(questions).set(data).where(eq(questions.id, id)).returning();
    if (!row) throw new NotFoundException('Вопрос не найден');

    if (data.type) {
      // Смена типа переписывает варианты, иначе останутся чужие надписи.
      await this.db.delete(questionOptions).where(eq(questionOptions.questionId, id));
      await this.seedLockedOptions(id, data.type);
    }
    await this.auth.audit(req.admin ?? null, 'update', 'question', id, data as Record<string, unknown>);
    return row;
  }

  @Delete('questions/:id')
  async removeQuestion(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.db.delete(questions).where(eq(questions.id, id));
    await this.auth.audit(req.admin ?? null, 'delete', 'question', id, {});
    return { ok: true };
  }

  @Post('topics/:id/questions/reorder')
  async reorderQuestions(@Param('id') topicId: string, @Body() body: unknown) {
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(body);
    await this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(questions).set({ position: i }).where(eq(questions.id, id));
    });
    void topicId;
    return { ids };
  }

  /* ───────── варианты ответа ───────── */

  @Post('questions/:id/options')
  async addOption(@Param('id') questionId: string, @Body() body: unknown) {
    const data = optionBody.parse(body);
    const existing = await this.db.select({ id: questionOptions.id }).from(questionOptions).where(eq(questionOptions.questionId, questionId));
    const [row] = await this.db
      .insert(questionOptions)
      .values({ ...data, questionId, position: existing.length })
      .returning();
    return row;
  }

  @Patch('options/:id')
  async patchOption(@Param('id') id: string, @Body() body: unknown) {
    const data = optionBody.parse(body);
    const [row] = await this.db.update(questionOptions).set(data).where(eq(questionOptions.id, id)).returning();
    if (!row) throw new NotFoundException('Вариант не найден');
    return row;
  }

  @Delete('options/:id')
  async removeOption(@Param('id') id: string) {
    await this.db.delete(questionOptions).where(eq(questionOptions.id, id));
    return { ok: true };
  }

  @Post('questions/:id/options/reorder')
  async reorderOptions(@Param('id') questionId: string, @Body() body: unknown) {
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(body);
    await this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(questionOptions).set({ position: i }).where(eq(questionOptions.id, id));
    });
    void questionId;
    return { ids };
  }

  /* ───────── общее ───────── */

  private async questionsOf(topicId: string) {
    const qs = await this.db.select().from(questions).where(eq(questions.topicId, topicId)).orderBy(asc(questions.position));
    return Promise.all(
      qs.map(async (q) => ({
        ...q,
        options: await this.db
          .select()
          .from(questionOptions)
          .where(eq(questionOptions.questionId, q.id))
          .orderBy(asc(questionOptions.position)),
      })),
    );
  }

  private async seedLockedOptions(questionId: string, type: string): Promise<void> {
    if (type === 'scale') {
      await this.db.insert(questionOptions).values(
        [1, 2, 3, 4, 5].map((n) => ({
          questionId, position: n - 1, labelKg: String(n), labelRu: String(n), points: 1, locked: true,
        })),
      );
    } else if (type === 'yesno') {
      await this.db.insert(questionOptions).values([
        { questionId, position: 0, labelKg: 'Ооба', labelRu: 'Да', points: 5, locked: true },
        { questionId, position: 1, labelKg: 'Жок', labelRu: 'Нет', points: 0, locked: true },
      ]);
    }
  }
}
