import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { enrollments, excusedDays, marathons, participants } from '../db/schema';
import type { Location } from '../domain/location';
import { shortName, type Lang } from '../domain/text';

export type Participant = typeof participants.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;
export type Marathon = typeof marathons.$inferSelect;

export interface ActiveContext {
  participant: Participant;
  enrollment: Enrollment;
  marathon: Marathon;
}

export interface RatingRow {
  place: number;
  name: string;
  points: number;
  me: boolean;
}

export interface Rating {
  total: number;
  top: RatingRow[];
  me: RatingRow;
  /** Сколько участниц ниже в списке — «0 катышуучу артыңызда». */
  behind: number;
}

/** Цель участницы не должна превращаться в сочинение: столько влезает в карточку. */
export const GOAL_MAX_LENGTH = 200;

@Injectable()
export class ParticipantsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async byTgUserId(tgUserId: string): Promise<Participant | undefined> {
    const [row] = await this.db.select().from(participants).where(eq(participants.tgUserId, tgUserId)).limit(1);
    return row;
  }

  async ensure(input: { tgUserId: string; chatId: string; firstName: string; lastName?: string; username?: string }): Promise<Participant> {
    const existing = await this.byTgUserId(input.tgUserId);
    if (existing) {
      // Имя и username в Telegram меняются; держим их свежими.
      const [updated] = await this.db
        .update(participants)
        .set({
          chatId: input.chatId,
          firstName: input.firstName,
          lastName: input.lastName ?? '',
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
        lastName: input.lastName ?? '',
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

  /** Запись в конкретный марафон, если она уже есть. */
  async enrollmentOf(participantId: string, marathonId: string): Promise<Enrollment | undefined> {
    const [row] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.participantId, participantId), eq(enrollments.marathonId, marathonId)))
      .limit(1);
    return row;
  }

  /** Согласие с правилами. Повторное не трогаем: важна первая дата. */
  async markRulesAccepted(enrollmentId: string): Promise<void> {
    await this.db
      .update(enrollments)
      .set({ rulesAcceptedAt: new Date() })
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.rulesAcceptedAt)));
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

  /* ───────── цель участницы ───────── */

  /** Зачем пришла в марафон. Цель своя у каждого марафона — они разные. */
  async setGoal(enrollmentId: string, goal: string | null): Promise<void> {
    const value = goal?.trim().slice(0, GOAL_MAX_LENGTH) || null;
    await this.db.update(enrollments).set({ goal: value }).where(eq(enrollments.id, enrollmentId));
  }

  /* ───────── рейтинг ───────── */

  /**
   * Топ-5 марафона и место самой участницы.
   *
   * Место считается не выборкой всех строк, а подсчётом тех, кто выше: при
   * двух сотнях участниц это один `count`, а не список в память. Равные баллы
   * разводятся серией и временем входа — иначе номера скакали бы между вызовами.
   */
  async rating(marathonId: string, enrollmentId: string): Promise<Rating | null> {
    const [mine] = await this.db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).limit(1);
    if (!mine) return null;

    const inMarathon = and(eq(enrollments.marathonId, marathonId), ne(enrollments.status, 'left'));

    const [{ n: total }] = await this.db.select({ n: count() }).from(enrollments).where(inMarathon);

    const [{ n: above }] = await this.db
      .select({ n: count() })
      .from(enrollments)
      .where(
        and(
          inMarathon,
          or(
            gt(enrollments.points, mine.points),
            and(eq(enrollments.points, mine.points), gt(enrollments.streak, mine.streak)),
            and(
              eq(enrollments.points, mine.points),
              eq(enrollments.streak, mine.streak),
              lt(enrollments.joinedAt, mine.joinedAt),
            ),
          ),
        ),
      );

    const topRows = await this.db
      .select({ id: enrollments.id, points: enrollments.points, firstName: participants.firstName, lastName: participants.lastName })
      .from(enrollments)
      .innerJoin(participants, eq(participants.id, enrollments.participantId))
      .where(inMarathon)
      .orderBy(desc(enrollments.points), desc(enrollments.streak), asc(enrollments.joinedAt))
      .limit(5);

    const [me] = await this.db
      .select({ firstName: participants.firstName, lastName: participants.lastName })
      .from(participants)
      .where(eq(participants.id, mine.participantId))
      .limit(1);

    const place = above + 1;
    return {
      total,
      top: topRows.map((r, i) => ({
        place: i + 1,
        name: shortName(r.firstName, r.lastName),
        points: r.points,
        me: r.id === enrollmentId,
      })),
      me: { place, name: shortName(me?.firstName ?? '', me?.lastName), points: mine.points, me: true },
      behind: Math.max(0, total - place),
    };
  }

  /* ───────── узур ───────── */

  /**
   * Чем закрыт день: `day` — уважительный день от куратора, снимает всё;
   * `namaz` — узур, отмеченный самой участницей, снимает только намазы.
   */
  async excusedScopeOn(enrollmentId: string, dayKey: string): Promise<'day' | 'namaz' | null> {
    const [row] = await this.db
      .select({ scope: excusedDays.scope })
      .from(excusedDays)
      .where(and(eq(excusedDays.enrollmentId, enrollmentId), eq(excusedDays.dayKey, dayKey)))
      .limit(1);
    return row?.scope ?? null;
  }

  /** Узур-дни среди перечисленных — для фильтра намазов в списке и в оценке дня. */
  async namazExcusedDays(enrollmentId: string, dayKeys: string[]): Promise<Set<string>> {
    if (dayKeys.length === 0) return new Set();
    const rows = await this.db
      .select({ dayKey: excusedDays.dayKey })
      .from(excusedDays)
      .where(
        and(
          eq(excusedDays.enrollmentId, enrollmentId),
          eq(excusedDays.scope, 'namaz'),
          inArray(excusedDays.dayKey, dayKeys),
        ),
      );
    return new Set(rows.map((r) => r.dayKey));
  }

  /** Отметить или снять узур на день. Уважительный день куратора не трогаем. */
  async setNamazExcused(enrollmentId: string, dayKey: string, on: boolean): Promise<void> {
    if (on) {
      await this.db
        .insert(excusedDays)
        .values({ enrollmentId, dayKey, scope: 'namaz', markedBy: null })
        .onConflictDoNothing();
      return;
    }
    await this.db
      .delete(excusedDays)
      .where(
        and(
          eq(excusedDays.enrollmentId, enrollmentId),
          eq(excusedDays.dayKey, dayKey),
          eq(excusedDays.scope, 'namaz'),
        ),
      );
  }
}
