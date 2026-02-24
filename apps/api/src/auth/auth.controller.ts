import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { Public } from './public.decorator';

type BootstrapResponse = {
  needsAdminSetup: boolean;
  onboardingComplete: boolean;
};

type LoginBody = {
  username?: unknown;
  password?: unknown;
  credentialEnvelope?: unknown;
  captchaToken?: unknown;
};

type LoginChallengeBody = {
  username?: unknown;
};

type LoginProofBody = {
  challengeId?: unknown;
  proof?: unknown;
  captchaToken?: unknown;
};

type ChangePasswordBody = {
  currentPassword?: unknown;
  newPassword?: unknown;
  captchaToken?: unknown;
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
  @Get('login-key')
  getLoginKey() {
    return this.authService.getLoginKey();
  }

  @Public()
  @Post('login-challenge')
  async loginChallenge(@Body() body: LoginChallengeBody, @Req() req: Request) {
    const username = typeof body?.username === 'string' ? body.username : '';
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    return await this.authService.createLoginChallenge({
      username,
      ip,
      userAgent: ua,
    });
  }

  @Public()
  @Post('login-proof')
  async loginProof(
    @Body() body: LoginProofBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const challengeId =
      typeof body?.challengeId === 'string' ? body.challengeId : '';
    const proof = typeof body?.proof === 'string' ? body.proof : '';
    const captchaToken =
      typeof body?.captchaToken === 'string' ? body.captchaToken : null;
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    const result = await this.authService.loginWithPasswordProof({
      challengeId,
      proof,
      ip,
      userAgent: ua,
      captchaToken,
    });
    this.setSessionCookie(req, res, result.sessionId);
    this.logger.log(
      `auth: login proof success userId=${result.user.id} username=${JSON.stringify(result.user.username)} ip=${JSON.stringify(ip)}`,
    );
    return { ok: true, user: result.user };
  }

  @Public()
  @Post('register')
  async register(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { username, password, captchaToken } =
      this.resolveCredentialBody(body);
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    this.logger.log(
      `auth: register attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} ua=${JSON.stringify(ua)}`,
    );
    await this.authService.registerAdmin({
      username,
      password,
      ip,
      userAgent: ua,
      captchaToken,
    });

    const login = await this.authService.login({
      username,
      password,
      ip,
      userAgent: ua,
      captchaToken,
    });
    this.setSessionCookie(req, res, login.sessionId);
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
    const { username, password, captchaToken } =
      this.resolveCredentialBody(body);
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    this.logger.log(
      `auth: login attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} ua=${JSON.stringify(ua)}`,
    );
    try {
      const result = await this.authService.login({
        username,
        password,
        ip,
        userAgent: ua,
        captchaToken,
      });
      this.setSessionCookie(req, res, result.sessionId);
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
    this.clearSessionCookie(req, res);
    const ip = req.ip ?? null;
    this.logger.log(
      `auth: logout ip=${JSON.stringify(ip)} hadSession=${Boolean(sid)}`,
    );
    return { ok: true };
  }

  @Post('logout-all')
  async logoutAll(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(req.user.id);
    this.clearSessionCookie(req, res);
    const ip = req.ip ?? null;
    this.logger.log(
      `auth: logout all userId=${req.user.id} ip=${JSON.stringify(ip)}`,
    );
    return { ok: true };
  }

  @Post('change-password')
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: ChangePasswordBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const currentPassword =
      typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword =
      typeof body?.newPassword === 'string' ? body.newPassword : '';
    const captchaToken =
      typeof body?.captchaToken === 'string' ? body.captchaToken : null;
    const ip = req.ip ?? null;
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    await this.authService.changePassword({
      userId: req.user.id,
      currentPassword,
      newPassword,
      ip,
      userAgent: ua,
      captchaToken,
    });

    this.clearSessionCookie(req, res);
    return { ok: true, requireReauth: true };
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
    await this.authService.resetAllData();
    const sid = this.authService.readSessionIdFromRequest(req);
    if (sid) await this.authService.logout(sid).catch(() => undefined);
    this.clearSessionCookie(req, res);
    return { ok: true };
  }

  private resolveCredentialBody(body: LoginBody): {
    username: string;
    password: string;
    captchaToken: string | null;
  } {
    const captchaToken =
      typeof body?.captchaToken === 'string' ? body.captchaToken : null;

    if (body?.credentialEnvelope !== undefined) {
      const creds = this.authService.decryptCredentialEnvelope(
        body.credentialEnvelope,
      );
      return {
        username: creds.username,
        password: creds.password,
        captchaToken,
      };
    }

    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!username.trim() || !password) {
      throw new BadRequestException(
        'username/password or credentialEnvelope is required',
      );
    }

    return { username, password, captchaToken };
  }

  private setSessionCookie(req: Request, res: Response, sessionId: string) {
    res.cookie(this.authService.getSessionCookieName(), sessionId, {
      ...this.getSessionCookieOptions(req),
      maxAge: this.authService.getSessionMaxAgeMs(),
    });
  }

  private clearSessionCookie(req: Request, res: Response) {
    res.clearCookie(this.authService.getSessionCookieName(), {
      ...this.getSessionCookieOptions(req),
    });
  }

  private getSessionCookieOptions(req: Request) {
    const raw = process.env.COOKIE_SECURE?.trim().toLowerCase();
    const secure =
      raw === 'true' ? true : raw === 'false' ? false : Boolean(req.secure);

    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path: '/',
    };
  }
}
