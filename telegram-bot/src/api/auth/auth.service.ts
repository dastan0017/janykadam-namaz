import { ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { adminSessions, adminUsers, auditLog } from '../../db/schema';
import { verifyTelegramAuth, type TelegramAuthPayload } from '../../domain/telegram-auth';

export type AdminUser = typeof adminUsers.$inferSelect;

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'jk_admin';

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** В базе лежит только хэш токена: утечка таблицы не даёт войти. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Вход через Telegram Login Widget.
   * Первый вход связывает запись по username и переводит её в active.
   */
  async loginWithTelegram(payload: TelegramAuthPayload): Promise<{ token: string; user: AdminUser }> {
    const result = verifyTelegramAuth(payload, env().BOT_TOKEN);
    if (!result.ok) throw new UnauthorizedException(`Проверка Telegram не пройдена: ${result.reason}`);

    const tgUserId = result.tgUserId!;
    let [user] = await this.db.select().from(adminUsers).where(eq(adminUsers.tgUserId, tgUserId)).limit(1);

    if (!user && result.username) {
      // Первый вход: ищем по username без учёта регистра и запоминаем id.
      [user] = await this.db
        .select()
        .from(adminUsers)
        .where(sql`lower(${adminUsers.tgUsername}) = lower(${result.username})`)
        .limit(1);
      if (user) {
        [user] = await this.db
          .update(adminUsers)
          .set({ tgUserId })
          .where(eq(adminUsers.id, user.id))
          .returning();
      }
    }

    if (!user) throw new ForbiddenException('Нет доступа в панель');
    if (user.status === 'disabled') throw new ForbiddenException('Доступ отключён');

    [user] = await this.db
      .update(adminUsers)
      .set({ status: 'active', lastLoginAt: new Date() })
      .where(eq(adminUsers.id, user.id))
      .returning();

    const token = randomBytes(32).toString('hex');
    await this.db.insert(adminSessions).values({
      adminUserId: user.id,
      tokenHash: this.hash(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    });

    await this.audit(user, 'login', 'admin_user', user.id, {});
    return { token, user };
  }

  async userByToken(token: string | undefined): Promise<AdminUser | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({ user: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
      .where(and(eq(adminSessions.tokenHash, this.hash(token)), gt(adminSessions.expiresAt, new Date())))
      .limit(1);

    if (!row) return null;
    if (row.user.status === 'disabled') return null;
    return row.user;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.delete(adminSessions).where(eq(adminSessions.tokenHash, this.hash(token)));
  }

  /** Каждое изменяющее действие попадает в журнал. */
  async audit(
    actor: AdminUser | null,
    action: string,
    entity: string,
    entityId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(auditLog).values({
      actorAdminId: actor?.id ?? null,
      actorLabel: actor ? `${actor.name} (${actor.tgUsername})` : 'система',
      action,
      entity,
      entityId,
      details,
    });
  }

  /** В панели всегда остаётся хотя бы один активный админ. */
  async activeAdminCount(): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(adminUsers)
      .where(and(eq(adminUsers.role, 'admin'), sql`${adminUsers.status} <> 'disabled'`));
    return row?.n ?? 0;
  }
}
