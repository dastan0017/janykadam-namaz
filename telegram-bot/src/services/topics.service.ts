import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { marathonNamaz, questionOptions, questions, topics } from '../db/schema';
import { NAMAZ_IDS, type NamazId } from '../domain/namaz';
import type { CustomTopicDef, EnabledTopics } from '../domain/windows';

export interface QuestionOptionDef {
  id: string;
  position: number;
  labelKg: string;
  labelRu: string;
  points: number;
  locked: boolean;
}

export interface QuestionDef {
  id: string;
  position: number;
  textKg: string;
  textRu: string;
  type: 'single' | 'multi' | 'text' | 'number' | 'scale' | 'yesno';
  required: boolean;
  options: QuestionOptionDef[];
}

@Injectable()
export class TopicsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Темы, включённые в марафоне: выбранные намазы и активные свои темы.
   * Порядок намазов — канонический (по времени суток), своих тем — по position.
   */
  async enabledFor(marathonId: string): Promise<EnabledTopics> {
    const [namazRows, customRows] = await Promise.all([
      this.db.select({ namazId: marathonNamaz.namazId }).from(marathonNamaz).where(eq(marathonNamaz.marathonId, marathonId)),
      this.db
        .select()
        .from(topics)
        .where(and(eq(topics.marathonId, marathonId), eq(topics.active, true)))
        .orderBy(asc(topics.position)),
    ]);

    const selected = new Set(namazRows.map((r) => r.namazId));
    const namaz = NAMAZ_IDS.filter((id) => selected.has(id)) as NamazId[];

    const custom: CustomTopicDef[] = customRows.map((t) => ({
      id: t.id,
      position: t.position,
      emoji: t.emoji,
      nameKg: t.nameKg,
      nameRu: t.nameRu,
      startLocal: t.startLocal.slice(0, 5),
      endLocal: t.endLocal.slice(0, 5),
      points: t.points,
      freq: t.freq,
      mandatory: t.mandatory,
      remindOffsetMin: t.remindOffsetMin,
    }));

    return { namaz, custom };
  }

  /** Вопросы темы по порядку, вместе с вариантами ответов. */
  async questionsFor(topicKind: 'namaz' | 'custom', topicId: string): Promise<QuestionDef[]> {
    const where = topicKind === 'namaz' ? eq(questions.namazId, topicId) : eq(questions.topicId, topicId);

    const qs = await this.db.select().from(questions).where(where).orderBy(asc(questions.position));
    if (qs.length === 0) return [];

    const opts = await this.db
      .select()
      .from(questionOptions)
      .orderBy(asc(questionOptions.position));

    const byQuestion = new Map<string, QuestionOptionDef[]>();
    for (const o of opts) {
      const list = byQuestion.get(o.questionId) ?? [];
      list.push({
        id: o.id,
        position: o.position,
        labelKg: o.labelKg,
        labelRu: o.labelRu,
        points: o.points,
        locked: o.locked,
      });
      byQuestion.set(o.questionId, list);
    }

    return qs.map((q) => ({
      id: q.id,
      position: q.position,
      textKg: q.textKg,
      textRu: q.textRu,
      type: q.type,
      required: q.required,
      options: byQuestion.get(q.id) ?? [],
    }));
  }
}
