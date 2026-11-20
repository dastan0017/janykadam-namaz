import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * Неверное тело запроса — это 400 с понятным текстом, а не 500.
 *
 * Ручки разбирают тело через `schema.parse()`, и без этого фильтра ошибка
 * разбора долетала до Nest как необработанная: панель показывала «Ошибка 500»
 * вместо «Это не ссылка на канал».
 */
@Catch(ZodError)
export class ZodErrorFilter implements ExceptionFilter {
  catch(err: ZodError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    void reply.status(400).send({
      statusCode: 400,
      message: err.issues[0]?.message ?? 'Неверные данные',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}
