import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import '@fastify/cookie';
import type { FastifyRequest } from 'fastify';
import { AuthService, SESSION_COOKIE, type AdminUser } from './auth.service';

export interface AuthedRequest extends FastifyRequest {
  admin?: AdminUser;
}

/** Помечает публичные маршруты: вход и проверка живости. */
export const PUBLIC = 'public_route';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC, true);

/** Требует роль admin. Куратор получает 403. */
export const ADMIN_ONLY = 'admin_only';
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY, true);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];

    const user = await this.auth.userByToken(token);
    if (!user) throw new UnauthorizedException('Нужен вход');

    req.admin = user;

    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [context.getHandler(), context.getClass()]);
    // Куратор умеет всё, кроме управления пользователями панели.
    if (adminOnly && user.role !== 'admin') {
      throw new ForbiddenException('Доступно только админам');
    }
    return true;
  }
}
