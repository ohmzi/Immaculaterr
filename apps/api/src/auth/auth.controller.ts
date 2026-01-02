import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { Public } from './public.decorator';

type BootstrapResponse = {
  needsAdminSetup: boolean;
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
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('bootstrap')
  async bootstrap(): Promise<BootstrapResponse> {
    const hasUser = await this.authService.hasAnyUser();
    return { needsAdminSetup: !hasUser };
  }

  @Public()
  @Post('register')
  async register(
    @Body() body: RegisterBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    await this.authService.registerAdmin({ username, password });

    // Auto-login after registration
    const login = await this.authService.login({ username, password });
    this.setSessionCookie(res, login.sessionId);
    return { ok: true, user: login.user };
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const result = await this.authService.login({ username, password });
    this.setSessionCookie(res, result.sessionId);
    return { ok: true, user: result.user };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sid = this.authService.readSessionIdFromRequest(req);
    if (sid) await this.authService.logout(sid);
    this.clearSessionCookie(res);
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
    const secure = process.env.COOKIE_SECURE === 'true';
    res.cookie(this.authService.getSessionCookieName(), sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      // session cookie (no maxAge) => cleared when browser closes
    });
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie(this.authService.getSessionCookieName(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
    });
  }
}
