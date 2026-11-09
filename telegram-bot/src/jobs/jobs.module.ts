import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { NotifyService } from '../services/notify.service';
import { ServicesModule } from '../services/services.module';
import { BossService } from './boss.service';
import { PlannerService } from './planner.service';
import { WorkersService } from './workers.service';

@Module({
  imports: [ServicesModule, BotModule],
  providers: [BossService, PlannerService, WorkersService, NotifyService],
  exports: [BossService, PlannerService, NotifyService],
})
export class JobsModule {}
