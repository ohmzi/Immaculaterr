import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable()
export class SessionRollingInterceptor implements NestInterceptor {
  constructor(private readonly authService: AuthService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const http = context.switchToHttp();
        const req = http.getRequest<
          Request & { user?: unknown; sessionId?: string }
        >();
        if (!req.user || !req.sessionId) return;

        const res = http.getResponse<Response>();
        if (res.headersSent) return;

        const cookieValue = this.authService.encodeSessionIdForCookie(
          req.sessionId,
        );
        res.cookie(this.authService.getSessionCookieName(), cookieValue, {
          httpOnly: true,
          sameSite: 'lax',
          secure: this.resolveCookieSecure(req),
          path: '/',
          maxAge: this.authService.getSessionMaxAgeMs(),
        });
      }),
    );
  }

  private resolveCookieSecure(req: Request): boolean {
    const raw = process.env.COOKIE_SECURE?.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return Boolean(req.secure);
  }
}
