import { Module } from '@nestjs/common';
import { BotModule } from './bot/bot.module';
import { DrizzleModule } from './db/drizzle.module';
import { HealthController } from './api/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { ServicesModule } from './services/services.module';

@Module({
  imports: [DrizzleModule, ServicesModule, BotModule, JobsModule],
  controllers: [HealthController],
})
export class AppModule {}
