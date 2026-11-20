import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';
import { BossService } from '../jobs/boss.service';
import { Public } from './auth/guards';

/** Проверяет и базу, и очередь: без pg-boss напоминания молча не уходят. */
@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly boss: BossService,
  ) {}

  @Get('healthz')
  async health(): Promise<{ ok: true; db: 'up'; queue: 'up' }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('База недоступна');
    }
    if (!(await this.boss.healthy())) {
      throw new ServiceUnavailableException('Очередь заданий недоступна');
    }
    return { ok: true, db: 'up', queue: 'up' };
  }
}
