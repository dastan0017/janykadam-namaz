import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { NotifyService } from '../services/notify.service';
import { ServicesModule } from '../services/services.module';
import { BossService } from './boss.service';
import { BroadcastWorker } from './broadcast.worker';
import { ChannelWorker } from './channel.worker';
import { PlannerService } from './planner.service';
import { WorkersService } from './workers.service';

@Module({
  imports: [ServicesModule, BotModule],
  providers: [BossService, PlannerService, WorkersService, NotifyService, BroadcastWorker, ChannelWorker],
  exports: [BossService, PlannerService, NotifyService],
})
export class JobsModule {}
