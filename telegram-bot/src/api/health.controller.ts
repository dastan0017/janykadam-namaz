import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.module';

@Controller()
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get('healthz')
  async health(): Promise<{ ok: true; db: 'up' }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('База недоступна');
    }
    return { ok: true, db: 'up' };
  }
}
