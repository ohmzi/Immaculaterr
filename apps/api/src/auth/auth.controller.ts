import { Body, Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { Public } from './public.decorator';

type BootstrapResponse = {
  needsAdminSetup: boolean;
  onboardingComplete: boolean;
};

type RegisterBody = {
  username?: unknown;
  password?: unknown;
};

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('bootstrap')
  async bootstrap(): Promise<BootstrapResponse> {
    const hasUser = await this.authService.hasAnyUser();
    if (!hasUser) {
      return { needsAdminSetup: true, onboardingComplete: false };
    }

    const onboardingComplete = await this.authService.isOnboardingComplete();
    return { needsAdminSetup: false, onboardingComplete };
  }

  @Public()
  @Post('register')
  async register(
    @Body() body: RegisterBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    this.logger.log(
      `auth: register attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} ua=${JSON.stringify(ua)}`,
    );
    await this.authService.registerAdmin({ username, password });

    // Auto-login after registration
    const login = await this.authService.login({ username, password });
    this.setSessionCookie(res, login.sessionId);
    this.logger.log(
      `auth: register success userId=${login.user.id} username=${JSON.stringify(login.user.username)} ip=${JSON.stringify(ip)}`,
    );
    return { ok: true, user: login.user };
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    this.logger.log(
      `auth: login attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} ua=${JSON.stringify(ua)}`,
    );
    try {
      const result = await this.authService.login({ username, password });
      this.setSessionCookie(res, result.sessionId);
      this.logger.log(
        `auth: login success userId=${result.user.id} username=${JSON.stringify(result.user.username)} ip=${JSON.stringify(ip)}`,
      );
      return { ok: true, user: result.user };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.logger.warn(
        `auth: login failed username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} error=${JSON.stringify(msg)}`,
      );
      throw err;
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sid = this.authService.readSessionIdFromRequest(req);
    if (sid) await this.authService.logout(sid);
    this.clearSessionCookie(res);
    const ip = req.ip ?? null;
    this.logger.log(`auth: logout ip=${JSON.stringify(ip)} hadSession=${Boolean(sid)}`);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { user: req.user };
  }

  @Post('reset-dev')
  async resetDev(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Require auth (guarded). This wipes everything.
    await this.authService.resetAllDataForDev();
    const sid = this.authService.readSessionIdFromRequest(req);
    if (sid) await this.authService.logout(sid).catch(() => undefined);
    this.clearSessionCookie(res);
    return { ok: true };
  }

  private setSessionCookie(res: Response, sessionId: string) {
    res.cookie(this.authService.getSessionCookieName(), sessionId, {
      ...this.getSessionCookieOptions(),
      // session cookie (no maxAge) => cleared when browser closes
    });
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie(this.authService.getSessionCookieName(), {
      ...this.getSessionCookieOptions(),
    });
  }

  private getSessionCookieOptions() {
    // In production we default secure cookies ON (HTTPS behind reverse proxy).
    // Override with COOKIE_SECURE=true|false for special deployments/dev.
    const raw = process.env.COOKIE_SECURE?.trim().toLowerCase();
    const secure =
      raw === 'true'
        ? true
        : raw === 'false'
          ? false
          : process.env.NODE_ENV === 'production';

    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path: '/',
    };
  }
}
