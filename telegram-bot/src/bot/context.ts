import type { Context, SessionFlavor } from 'grammy';
import type { Lang } from '../domain/text';
import type { Participant } from '../services/participants.service';
import type { SessionData } from './session';

/**
 * Контекст бота. К стандартному добавлены сессия и уже загруженная участница:
 * её достаёт одно middleware, чтобы каждый обработчик не ходил в базу сам.
 */
export interface BotFlavor {
  participant?: Participant;
  /** Язык участницы; до регистрации — язык марафона или кыргызский. */
  lang: Lang;
  /** Короткий помощник: текст по ключу уже на нужном языке. */
  t(key: string, values?: Record<string, string | number | undefined>): Promise<string>;
}

export type Ctx = Context & SessionFlavor<SessionData> & BotFlavor;

/** Частные чаты: в группах бот не работает. */
export function isPrivate(ctx: Ctx): boolean {
  return ctx.chat?.type === 'private';
}

export function tgUserId(ctx: Ctx): string | undefined {
  return ctx.from ? String(ctx.from.id) : undefined;
}
