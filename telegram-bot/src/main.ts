import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  // Сессия админ-панели лежит в httpOnly-куке.
  await app.register(fastifyCookie, { secret: cfg.SESSION_SECRET });

  if (cfg.ADMIN_ORIGIN) {
    // Методы перечислены явно: по умолчанию в ответ на preflight уходит
    // `GET,HEAD,POST`, и браузер режет все правки из панели — PATCH, PUT и
    // DELETE. Снаружи это выглядит как «запрос не прошёл» без объяснений.
    app.enableCors({
      origin: cfg.ADMIN_ORIGIN,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type'],
    });
  }

  // /api/docs открыт без входа, поэтому в проде его по умолчанию нет:
  // иначе наружу уходит полный список ручек админки. ENABLE_DOCS=true включает.
  const withDocs = cfg.ENABLE_DOCS ?? cfg.NODE_ENV !== 'production';
  if (withDocs) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Janykadam — админ-API')
        .setDescription('Бэкенд панели марафонов. Вход через Telegram Login, сессия в httpOnly-куке.')
        .setVersion('0.1.0')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  } else {
    log.log('Swagger выключен: ENABLE_DOCS=true включит его обратно');
  }

  const bot = app.get(BotService);

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  log.log(`HTTP слушает ${cfg.HOST}:${cfg.PORT}`);

  // Неверный токен не должен ронять HTTP: админ-панель и /healthz обязаны
  // остаться доступными, чтобы было видно, что именно сломано.
  try {
    if (cfg.BOT_MODE === 'webhook') await bot.setupWebhook();
    else await bot.startPolling();
  } catch (err) {
    log.error(`Бот не запустился: ${String(err)}. HTTP продолжает работать.`);
  }

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
