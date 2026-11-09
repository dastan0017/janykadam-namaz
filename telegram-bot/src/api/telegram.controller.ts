import { Controller, Headers, HttpCode, Inject, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Update } from 'grammy/types';
import { BotService } from '../bot/bot.service';
import { env } from '../config/env';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { telegramUpdates } from '../db/schema';
import { Public } from './auth/guards';

/**
 * Приём вебхука.
 *
 * Проверяем секретный заголовок и отсеиваем повторные update_id: Telegram
 * переотправляет апдейт, если не дождался ответа, а отчёт дублировать нельзя.
 */
@Public()
@Controller('telegram')
export class TelegramController {
  private readonly log = new Logger(TelegramController.name);

  constructor(
    private readonly bots: BotService,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    if (!env().WEBHOOK_SECRET || secret !== env().WEBHOOK_SECRET) {
      throw new UnauthorizedException('Неверный секрет вебхука');
    }

    const update = req.body as Update;
    if (!update?.update_id) return { ok: true };

    const fresh = await this.remember(String(update.update_id));
    if (!fresh) {
      this.log.debug(`Повторный апдейт ${update.update_id} пропущен`);
      return { ok: true };
    }

    await this.bots.bot.handleUpdate(update);
    return { ok: true };
  }

  /** true, если такой update_id ещё не видели. Записи старше суток чистим. */
  private async remember(updateId: string): Promise<boolean> {
    const inserted = await this.db
      .insert(telegramUpdates)
      .values({ updateId })
      .onConflictDoNothing()
      .returning({ id: telegramUpdates.updateId });

    if (Math.random() < 0.01) {
      const dayAgo = new Date(Date.now() - 24 * 3600_000);
      await this.db.delete(telegramUpdates).where(lt(telegramUpdates.receivedAt, dayAgo));
    }
    void eq;
    return inserted.length > 0;
  }
}
