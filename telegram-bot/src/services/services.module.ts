import { Module } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { ChannelsService } from './channels.service';
import { LocationService } from './location.service';
import { ParticipantsService } from './participants.service';
import { PrayerService } from './prayer.service';
import { ReportsService } from './reports.service';
import { SettingsService } from './settings.service';
import { TopicsService } from './topics.service';

/** Прикладные сервисы: их делят бот, задания и админ-API. */
@Module({
  providers: [SettingsService, ChannelsService, PrayerService, LocationService, TopicsService, ParticipantsService, ReportsService, BroadcastService],
  exports: [SettingsService, ChannelsService, PrayerService, LocationService, TopicsService, ParticipantsService, ReportsService, BroadcastService],
})
export class ServicesModule {}
