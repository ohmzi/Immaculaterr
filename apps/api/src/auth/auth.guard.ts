import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const cookieName = this.authService.getSessionCookieName();
    const sid = (req as any).cookies?.[cookieName];
    if (typeof sid !== 'string' || !sid.trim()) {
      throw new UnauthorizedException('Not logged in');
    }

    const user = await this.authService.getUserForSession(sid);
    if (!user) {
      throw new UnauthorizedException('Session expired');
    }

    (req as any).user = user;
    return true;
  }
}


