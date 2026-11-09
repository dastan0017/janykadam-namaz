import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

export type Db = NodePgDatabase<typeof schema>;

/**
 * Единый пул соединений на процесс. Бот, задания и админ-API ходят в базу
 * через него же: отдельные пулы только размножают коннекты.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => new Pool({ connectionString: env().DATABASE_URL, max: 10 }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor() {}

  async onApplicationShutdown(): Promise<void> {
    // Пул закрывается в main.ts через app.close(); здесь только хук для Nest.
  }
}
