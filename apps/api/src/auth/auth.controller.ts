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
import { AUTH_CREDENTIAL_ENVELOPE_PURPOSES } from '../app.constants';

type BootstrapResponse = {
  needsAdminSetup: boolean;
  onboardingComplete: boolean;
};

type LoginBody = {
  username?: unknown;
  password?: unknown;
  credentialEnvelope?: unknown;
  captchaToken?: unknown;
  recoveryAnswers?: unknown;
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

type ConfigureRecoveryBody = {
  currentPassword?: unknown;
  recoveryAnswers?: unknown;
  credentialEnvelope?: unknown;
};

type ResetQuestionsBody = {
  username?: unknown;
};

type ResetPasswordBody = {
  challengeId?: unknown;
  newPassword?: unknown;
  answers?: unknown;
  credentialEnvelope?: unknown;
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

function readRecoveryAnswers(
  value: unknown,
  fieldName: 'recoveryAnswers' | 'answers',
): Array<{
  questionKey: string;
  answer: string;
}> {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException(`${fieldName}[${index}] must be an object`);
    }
    const questionKey = readString(
      (entry as Record<string, unknown>)['questionKey'],
    );
    const answer = readString((entry as Record<string, unknown>)['answer']);
    return { questionKey, answer };
  });
}

function readResetAnswers(
  value: unknown,
): Array<{ slot: number; answer: string }> {
  if (!Array.isArray(value)) {
    throw new BadRequestException('answers must be an array');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException(`answers[${index}] must be an object`);
    }
    const slotRaw = (entry as Record<string, unknown>)['slot'];
    const slot =
      typeof slotRaw === 'number'
        ? slotRaw
        : Number.parseInt(readString(slotRaw), 10);
    const answer = readString((entry as Record<string, unknown>)['answer']);
    return { slot, answer };
  });
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
  @Get('recovery/questions')
  listRecoveryQuestions() {
    return { questions: this.authService.listPasswordRecoveryQuestions() };
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
    const envelopePayload = this.resolveEnvelopePayload(
      body?.credentialEnvelope,
      [
        AUTH_CREDENTIAL_ENVELOPE_PURPOSES.register,
        AUTH_CREDENTIAL_ENVELOPE_PURPOSES.login,
      ],
    );
    const { username, password, captchaToken } = this.resolveCredentialBody(
      body,
      envelopePayload,
    );
    const recoveryAnswers = readRecoveryAnswers(
      envelopePayload
        ? envelopePayload['recoveryAnswers']
        : body?.recoveryAnswers,
      'recoveryAnswers',
    );
    const meta = this.getRequestMeta(req);

    this.logger.log(
      `auth: register attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(meta.ip)} ua=${JSON.stringify(meta.userAgent)}`,
    );
    await this.authService.registerAdmin({
      username,
      password,
      recoveryAnswers,
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
    const envelopePayload = this.resolveEnvelopePayload(
      body?.credentialEnvelope,
      [AUTH_CREDENTIAL_ENVELOPE_PURPOSES.login],
    );
    const { username, password, captchaToken } = this.resolveCredentialBody(
      body,
      envelopePayload,
    );
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

  @Get('recovery/status')
  async recoveryStatus(@Req() req: AuthenticatedRequest) {
    return await this.authService.getPasswordRecoveryStatus(req.user.id);
  }

  @Post('recovery/configure')
  async configureRecovery(
    @Req() req: AuthenticatedRequest,
    @Body() body: ConfigureRecoveryBody,
  ) {
    const envelopePayload = this.resolveEnvelopePayload(
      body?.credentialEnvelope,
      [AUTH_CREDENTIAL_ENVELOPE_PURPOSES.recoveryConfigure],
    );
    const currentPassword = readString(
      envelopePayload
        ? envelopePayload['currentPassword']
        : body?.currentPassword,
    );
    const recoveryAnswers = readRecoveryAnswers(
      envelopePayload
        ? envelopePayload['recoveryAnswers']
        : body?.recoveryAnswers,
      'recoveryAnswers',
    );
    const meta = this.getRequestMeta(req);
    return await this.authService.configurePasswordRecovery({
      userId: req.user.id,
      currentPassword,
      answers: recoveryAnswers,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  @Public()
  @Post('recovery/reset-questions')
  async createRecoveryResetQuestions(
    @Body() body: ResetQuestionsBody,
    @Req() req: Request,
  ) {
    const username = readString(body?.username);
    const meta = this.getRequestMeta(req);
    return await this.authService.createPasswordResetChallenge({
      username,
      ip: meta.ip,
    });
  }

  @Public()
  @Post('recovery/reset-password')
  async resetPasswordWithRecovery(
    @Body() body: ResetPasswordBody,
    @Req() req: Request,
  ) {
    const envelopePayload = this.resolveEnvelopePayload(
      body?.credentialEnvelope,
      [AUTH_CREDENTIAL_ENVELOPE_PURPOSES.recoveryResetPassword],
    );
    const challengeId = readString(
      envelopePayload ? envelopePayload['challengeId'] : body?.challengeId,
    );
    const newPassword = readString(
      envelopePayload ? envelopePayload['newPassword'] : body?.newPassword,
    );
    const answers = readResetAnswers(
      envelopePayload ? envelopePayload['answers'] : body?.answers,
    );
    const meta = this.getRequestMeta(req);
    return await this.authService.resetPasswordWithRecovery({
      challengeId,
      newPassword,
      answers,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
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

  private resolveCredentialBody(
    body: LoginBody,
    envelopePayload: Record<string, unknown> | null = null,
  ): {
    username: string;
    password: string;
    captchaToken: string | null;
  } {
    const captchaToken = readOptionalString(body?.captchaToken);
    const envelopeCredentials =
      this.resolveEnvelopeCredentials(envelopePayload);
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

  private resolveEnvelopePayload(
    credentialEnvelope: unknown,
    expectedPurposes?: readonly string[],
  ): Record<string, unknown> | null {
    if (credentialEnvelope === undefined) return null;
    const payload =
      this.authService.decryptCredentialEnvelopePayload(credentialEnvelope);
    if (!expectedPurposes?.length) return payload;

    const purpose = readString(payload['purpose']).trim();
    if (!purpose || !expectedPurposes.includes(purpose)) {
      throw new BadRequestException('credentialEnvelope purpose is invalid');
    }
    return payload;
  }

  private resolveEnvelopeCredentials(payload: Record<string, unknown> | null): {
    username: string;
    password: string;
  } | null {
    if (!payload) return null;
    const username = readString(payload['username']);
    const password = readString(payload['password']);
    if (!username.trim() || !password) {
      throw new BadRequestException(
        'credentialEnvelope payload must include username and password',
      );
    }
    return { username, password };
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
