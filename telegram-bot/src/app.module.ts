import { Module } from '@nestjs/common';
import { BotModule } from './bot/bot.module';
import { DrizzleModule } from './db/drizzle.module';
import { HealthController } from './api/health.controller';
import { TelegramController } from './api/telegram.controller';
import { ServicesModule } from './services/services.module';

@Module({
  imports: [DrizzleModule, ServicesModule, BotModule],
  controllers: [HealthController, TelegramController],
})
export class AppModule {}
