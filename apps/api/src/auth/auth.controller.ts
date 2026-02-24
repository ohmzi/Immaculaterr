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

type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

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
    const username = readString(body?.username);
    const meta = this.getRequestMeta(req);

    return await this.authService.createLoginChallenge({
      username,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  @Public()
  @Post('login-proof')
  async loginProof(
    @Body() body: LoginProofBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const challengeId = readString(body?.challengeId);
    const proof = readString(body?.proof);
    const captchaToken = readOptionalString(body?.captchaToken);
    const meta = this.getRequestMeta(req);

    const result = await this.authService.loginWithChallengeProof({
      challengeId,
      proof,
      ip: meta.ip,
      userAgent: meta.userAgent,
      captchaToken,
    });
    this.setSessionCookie(req, res, result.sessionId);
    this.logger.log(
      `auth: login proof success userId=${result.user.id} username=${JSON.stringify(result.user.username)} ip=${JSON.stringify(meta.ip)}`,
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
    const meta = this.getRequestMeta(req);

    this.logger.log(
      `auth: register attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(meta.ip)} ua=${JSON.stringify(meta.userAgent)}`,
    );
    await this.authService.registerAdmin({
      username,
      password,
      ip: meta.ip,
      userAgent: meta.userAgent,
      captchaToken,
    });

    const login = await this.authService.login({
      username,
      password,
      ip: meta.ip,
      userAgent: meta.userAgent,
      captchaToken,
    });
    this.setSessionCookie(req, res, login.sessionId);
    this.logger.log(
      `auth: register success userId=${login.user.id} username=${JSON.stringify(login.user.username)} ip=${JSON.stringify(meta.ip)}`,
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
    const meta = this.getRequestMeta(req);

    this.logger.log(
      `auth: login attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(meta.ip)} ua=${JSON.stringify(meta.userAgent)}`,
    );
    try {
      const result = await this.authService.login({
        username,
        password,
        ip: meta.ip,
        userAgent: meta.userAgent,
        captchaToken,
      });
      this.setSessionCookie(req, res, result.sessionId);
      this.logger.log(
        `auth: login success userId=${result.user.id} username=${JSON.stringify(result.user.username)} ip=${JSON.stringify(meta.ip)}`,
      );
      return { ok: true, user: result.user };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.logger.warn(
        `auth: login failed username=${JSON.stringify(username.trim())} ip=${JSON.stringify(meta.ip)} error=${JSON.stringify(msg)}`,
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
    const currentPassword = readString(body?.currentPassword);
    const newPassword = readString(body?.newPassword);
    const captchaToken = readOptionalString(body?.captchaToken);
    const meta = this.getRequestMeta(req);

    await this.authService.changePassword({
      userId: req.user.id,
      currentPassword,
      newPassword,
      ip: meta.ip,
      userAgent: meta.userAgent,
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
    const captchaToken = readOptionalString(body?.captchaToken);
    const envelopeCredentials = this.resolveEnvelopeCredentials(body);
    if (envelopeCredentials) {
      return { ...envelopeCredentials, captchaToken };
    }

    const plainCredentials = this.resolvePlainCredentials(body);
    return { ...plainCredentials, captchaToken };
  }

  private setSessionCookie(req: Request, res: Response, sessionId: string) {
    const cookieValue = this.authService.encodeSessionIdForCookie(sessionId);
    res.cookie(this.authService.getSessionCookieName(), cookieValue, {
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

  private getRequestMeta(req: Request): RequestMeta {
    return {
      ip: req.ip ?? null,
      userAgent: readOptionalString(req.headers['user-agent']),
    };
  }

  private resolveEnvelopeCredentials(body: LoginBody): {
    username: string;
    password: string;
  } | null {
    if (body?.credentialEnvelope === undefined) return null;
    return this.authService.decryptCredentialEnvelope(body.credentialEnvelope);
  }

  private resolvePlainCredentials(body: LoginBody): {
    username: string;
    password: string;
  } {
    const username = readString(body?.username);
    const password = readString(body?.password);
    if (!username.trim() || !password) {
      throw new BadRequestException(
        'username/password or credentialEnvelope is required',
      );
    }
    return { username, password };
  }
}
