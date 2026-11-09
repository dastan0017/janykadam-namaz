import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { botTexts, marathons, questionOptions, questions, topics } from '../db/schema';
import type { NamazId } from '../domain/namaz';
import { validateMarathon, type Issue, type TopicInput } from '../domain/validation';
import { localDateShift, toLocalDate, windowsForDay } from '../domain/windows';
import { PrayerService } from './prayer.service';
import { TopicsService } from './topics.service';

/** Эталонное место для проверки пересечений — Бишкек. */
const REFERENCE = { lat: 42.87, lng: 74.59, tz: 'Asia/Bishkek' };

@Injectable()
export class ValidationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly topicsSvc: TopicsService,
    private readonly prayer: PrayerService,
  ) {}

  async validate(marathonId: string): Promise<Issue[]> {
    const [marathon] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);
    if (!marathon) return [];

    const enabled = await this.topicsSvc.enabledFor(marathonId);
    const today = toLocalDate(new Date(), REFERENCE.tz);

    const lookup = await this.prayer.lookupFor(REFERENCE.lat, REFERENCE.lng, [
      localDateShift(today, -1), today, localDateShift(today, 1),
    ]);
    const mandatoryWindows = windowsForDay(enabled, today, REFERENCE.tz, lookup).filter((w) => w.mandatory);

    // Все темы марафона, включая выключенные: правила смотрят только активные.
    const topicRows = await this.db
      .select()
      .from(topics)
      .where(eq(topics.marathonId, marathonId))
      .orderBy(asc(topics.position));

    const topicInputs: TopicInput[] = [];
    for (const t of topicRows) {
      const qs = await this.db
        .select()
        .from(questions)
        .where(eq(questions.topicId, t.id))
        .orderBy(asc(questions.position));

      const withOptions = [];
      for (const q of qs) {
        const opts = await this.db
          .select()
          .from(questionOptions)
          .where(eq(questionOptions.questionId, q.id))
          .orderBy(asc(questionOptions.position));
        withOptions.push({
          id: q.id, textKg: q.textKg, textRu: q.textRu, type: q.type,
          options: opts.map((o) => ({ id: o.id, labelKg: o.labelKg, labelRu: o.labelRu, points: o.points })),
        });
      }

      topicInputs.push({
        id: t.id, nameKg: t.nameKg, nameRu: t.nameRu, active: t.active,
        startLocal: t.startLocal, endLocal: t.endLocal, points: t.points,
        mandatory: t.mandatory, freq: t.freq, questions: withOptions,
      });
    }

    const texts = await this.db.select().from(botTexts);
    const untranslatedTextKeys = texts.filter((t) => !t.ru.trim() || !t.kg.trim()).map((t) => t.key);

    return validateMarathon(
      {
        status: marathon.status,
        startDate: marathon.startDate,
        endDate: marathon.endDate,
        namaz: enabled.namaz as NamazId[],
        topics: topicInputs,
      },
      { today, mandatoryWindows, untranslatedTextKeys },
    );
  }
}
