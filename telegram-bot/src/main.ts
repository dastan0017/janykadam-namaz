import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { BotService } from './bot/bot.service';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Падаем сразу, если окружение не то: весь расчёт времени держится на TZ=UTC.
  const cfg = loadEnv();
  const log = new Logger('bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
    logger: ['error', 'warn', 'log'],
  });

  if (cfg.ADMIN_ORIGIN) {
    app.enableCors({ origin: cfg.ADMIN_ORIGIN, credentials: true });
  }

  const bot = app.get(BotService);

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  log.log(`HTTP слушает ${cfg.HOST}:${cfg.PORT}`);

  if (cfg.BOT_MODE === 'webhook') await bot.setupWebhook();
  else await bot.startPolling();

  const shutdown = async (signal: string): Promise<void> => {
    log.log(`${signal}: останавливаюсь`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
