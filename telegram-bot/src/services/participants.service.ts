import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { enrollments, marathons, participants } from '../db/schema';
import type { Location } from '../domain/location';
import type { Lang } from '../domain/text';

export type Participant = typeof participants.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;
export type Marathon = typeof marathons.$inferSelect;

export interface ActiveContext {
  participant: Participant;
  enrollment: Enrollment;
  marathon: Marathon;
}

@Injectable()
export class ParticipantsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async byTgUserId(tgUserId: string): Promise<Participant | undefined> {
    const [row] = await this.db.select().from(participants).where(eq(participants.tgUserId, tgUserId)).limit(1);
    return row;
  }

  async ensure(input: { tgUserId: string; chatId: string; firstName: string; username?: string }): Promise<Participant> {
    const existing = await this.byTgUserId(input.tgUserId);
    if (existing) {
      // Имя и username в Telegram меняются; держим их свежими.
      const [updated] = await this.db
        .update(participants)
        .set({
          chatId: input.chatId,
          firstName: input.firstName,
          username: input.username ?? null,
          lastSeenAt: new Date(),
          // Любое входящее сообщение означает, что бот не заблокирован.
          blocked: false,
        })
        .where(eq(participants.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(participants)
      .values({
        tgUserId: input.tgUserId,
        chatId: input.chatId,
        firstName: input.firstName,
        username: input.username ?? null,
      })
      .returning();
    return created;
  }

  async setLang(participantId: string, lang: Lang): Promise<void> {
    await this.db.update(participants).set({ lang }).where(eq(participants.id, participantId));
  }

  async setLocation(participantId: string, loc: Location): Promise<void> {
    await this.db
      .update(participants)
      .set({
        lat: loc.lat,
        lng: loc.lng,
        tz: loc.tz,
        placeLabel: loc.placeLabel,
        countryCode: loc.countryCode,
        locationSource: loc.source,
      })
      .where(eq(participants.id, participantId));
  }

  async setBlocked(participantId: string, blocked: boolean): Promise<void> {
    await this.db.update(participants).set({ blocked }).where(eq(participants.id, participantId));
  }

  async setTahajjud(participantId: string, on: boolean): Promise<void> {
    await this.db.update(participants).set({ tahajjudReminders: on }).where(eq(participants.id, participantId));
  }

  async setNextMarathonInterest(participantId: string, on: boolean): Promise<void> {
    await this.db.update(participants).set({ nextMarathonInterest: on }).where(eq(participants.id, participantId));
  }

  /** Марафон по коду из deep link. */
  async marathonByCode(code: string): Promise<Marathon | undefined> {
    const [row] = await this.db.select().from(marathons).where(eq(marathons.code, code)).limit(1);
    return row;
  }

  async marathonById(id: string): Promise<Marathon | undefined> {
    const [row] = await this.db.select().from(marathons).where(eq(marathons.id, id)).limit(1);
    return row;
  }

  /**
   * Записывает в марафон или возвращает существующую запись.
   * Вышедшую ранее участницу возвращаем в строй, а не плодим вторую запись.
   */
  async enroll(participantId: string, marathonId: string): Promise<Enrollment> {
    const [existing] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.participantId, participantId), eq(enrollments.marathonId, marathonId)))
      .limit(1);

    if (existing) {
      if (existing.status === 'left') {
        const [revived] = await this.db
          .update(enrollments)
          .set({ status: 'active', joinedAt: new Date() })
          .where(eq(enrollments.id, existing.id))
          .returning();
        return revived;
      }
      return existing;
    }

    const [created] = await this.db.insert(enrollments).values({ participantId, marathonId }).returning();
    return created;
  }

  async setActiveEnrollment(participantId: string, enrollmentId: string): Promise<void> {
    await this.db.update(participants).set({ activeEnrollmentId: enrollmentId }).where(eq(participants.id, participantId));
  }

  /** Контекст активного марафона: по нему идут все отчёты. */
  async activeContext(participant: Participant): Promise<ActiveContext | null> {
    let enrollment: Enrollment | undefined;

    if (participant.activeEnrollmentId) {
      [enrollment] = await this.db
        .select()
        .from(enrollments)
        .where(eq(enrollments.id, participant.activeEnrollmentId))
        .limit(1);
    }

    // Активная запись потерялась или завершилась — берём любую живую.
    if (!enrollment || enrollment.status === 'finished' || enrollment.status === 'left') {
      const live = await this.liveEnrollments(participant.id);
      enrollment = live[0];
      if (enrollment) await this.setActiveEnrollment(participant.id, enrollment.id);
    }

    if (!enrollment) return null;

    const marathon = await this.marathonById(enrollment.marathonId);
    if (!marathon) return null;

    return { participant, enrollment, marathon };
  }

  /** Записи, которые ещё идут: активные и на паузе. */
  async liveEnrollments(participantId: string): Promise<Enrollment[]> {
    return this.db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.participantId, participantId),
          inArray(enrollments.status, ['active', 'paused']),
        ),
      );
  }

  /** Все незавершённые — для /marafon. */
  async switchableEnrollments(participantId: string): Promise<{ enrollment: Enrollment; marathon: Marathon }[]> {
    const rows = await this.db
      .select({ enrollment: enrollments, marathon: marathons })
      .from(enrollments)
      .innerJoin(marathons, eq(marathons.id, enrollments.marathonId))
      .where(and(eq(enrollments.participantId, participantId), ne(enrollments.status, 'finished')));
    return rows;
  }

  async countActiveEnrollments(participantId: string): Promise<number> {
    const live = await this.liveEnrollments(participantId);
    return live.length;
  }
}
