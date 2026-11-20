import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { botTexts, marathons, questionOptions, questions, topics } from '../db/schema';
import type { NamazId } from '../domain/namaz';
import { validateMarathon, type Issue, type TopicInput } from '../domain/validation';
import { toLocalDate } from '../domain/windows';
import { ChannelsService } from './channels.service';
import { TopicsService } from './topics.service';

/** Эталонный пояс для проверки дат — Бишкек. */
const REFERENCE_TZ = 'Asia/Bishkek';

@Injectable()
export class ValidationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly topicsSvc: TopicsService,
    private readonly channels: ChannelsService,
  ) {}

  async validate(marathonId: string): Promise<Issue[]> {
    const [marathon] = await this.db.select().from(marathons).where(eq(marathons.id, marathonId)).limit(1);
    if (!marathon) return [];

    const enabled = await this.topicsSvc.enabledFor(marathonId);
    const today = toLocalDate(new Date(), REFERENCE_TZ);

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

    const ch = await this.channels.summary(marathonId);

    return validateMarathon(
      {
        status: marathon.status,
        startDate: marathon.startDate,
        endDate: marathon.endDate,
        namaz: enabled.namaz as NamazId[],
        topics: topicInputs,
        channel: {
          link: !!ch.link,
          connected: !!ch.chatId,
          ready: ch.ready,
          isPrivate: ch.isPrivate,
          protectedContent: ch.protectedContent,
          canRestrict: ch.rights.restrict,
        },
      },
      { today, untranslatedTextKeys },
    );
  }
}
