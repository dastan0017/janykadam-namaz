import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { BotService } from './bot.service';
import { CommandsFlow } from './flows/commands.flow';
import { RegistrationFlow } from './flows/registration.flow';
import { ReportFlow } from './flows/report.flow';

@Module({
  imports: [ServicesModule],
  providers: [BotService, RegistrationFlow, ReportFlow, CommandsFlow],
  exports: [BotService],
})
export class BotModule {}
