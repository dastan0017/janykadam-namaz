import { Module } from '@nestjs/common';
import { TelegramController } from '../api/telegram.controller';
import { ServicesModule } from '../services/services.module';
import { BotService } from './bot.service';
import { CommandsFlow } from './flows/commands.flow';
import { RegistrationFlow } from './flows/registration.flow';
import { ReportFlow } from './flows/report.flow';

/** Вебхук объявлен здесь же: он часть бота, а не отдельного API. */
@Module({
  imports: [ServicesModule],
  controllers: [TelegramController],
  providers: [BotService, RegistrationFlow, ReportFlow, CommandsFlow],
  exports: [BotService],
})
export class BotModule {}
