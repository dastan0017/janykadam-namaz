import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { BotModule } from '../bot/bot.module';
import { JobsModule } from '../jobs/jobs.module';
import { ServicesModule } from '../services/services.module';
import { ValidationService } from '../services/validation.service';
import { MarathonsController } from './admin/marathons.controller';
import { MiscController } from './admin/misc.controller';
import { ParticipantsController } from './admin/participants.controller';
import { TopicsController } from './admin/topics.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/guards';
import { ZodErrorFilter } from './zod-error.filter';

/**
 * Админ-API. Сессия проверяется глобальным guard-ом; публичные ручки помечены
 * декоратором Public, а управление пользователями — AdminOnly.
 */
@Module({
  imports: [ServicesModule, BotModule, JobsModule],
  controllers: [MarathonsController, TopicsController, ParticipantsController, MiscController],
  providers: [
    AuthService,
    ValidationService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ZodErrorFilter },
  ],
  exports: [AuthService],
})
export class ApiModule {}
