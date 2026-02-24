import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../db/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { AuthUser } from './auth.types';
import {
  AuthThrottleService,
  type ThrottleAssessment,
} from './auth-throttle.service';
import { CaptchaService } from './captcha.service';
import { CredentialEnvelopeService } from './credential-envelope.service';
import { PasswordProofService } from './password-proof.service';
import {
  createPasswordProofMaterial,
  derivePasswordProofKey,
  hashPassword,
  type PasswordVerificationResult,
  verifyPassword,
} from './password';

const SESSION_COOKIE = 'tcp_session';
const SESSION_COOKIE_PAYLOAD_PREFIX = 'sid:v1:';
const DEFAULT_SESSION_MAX_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_PASSWORD_PROOF_ITERATIONS = 210_000;

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type AuthLoginResult = {
  sessionId: string;
  user: AuthUser;
};

export type LoginContext = {
  ip: string | null;
  userAgent: string | null;
  captchaToken?: string | null;
};

type AuthLookupUser = {
  id: string;
  username: string;
  passwordHash: string;
  tokenVersion: number;
  passwordProofSalt: string | null;
  passwordProofIterations: number | null;
  passwordProofKeyEnc: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly authThrottle: AuthThrottleService,
    private readonly captcha: CaptchaService,
    private readonly credentialEnvelope: CredentialEnvelopeService,
    private readonly passwordProof: PasswordProofService,
  ) {}

  getSessionCookieName() {
    return SESSION_COOKIE;
  }

  getSessionMaxAgeMs() {
    return parsePositiveInt(
      process.env.AUTH_SESSION_MAX_AGE_MS,
      DEFAULT_SESSION_MAX_AGE_MS,
    );
  }

  getLoginKey() {
    return this.credentialEnvelope.getLoginKey();
  }

  encodeSessionIdForCookie(sessionId: string): string {
    const normalized = sessionId.trim();
    if (!normalized) {
      throw new BadRequestException('Invalid session');
    }
    return this.crypto.encryptString(
      `${SESSION_COOKIE_PAYLOAD_PREFIX}${normalized}`,
    );
  }

  readSessionIdFromRequest(req: Request): string | null {
    const cookieName = this.getSessionCookieName();
    const cookies = (req as unknown as { cookies?: unknown }).cookies;
    if (!cookies || typeof cookies !== 'object') return null;
    const v = (cookies as Record<string, unknown>)[cookieName];
    if (typeof v !== 'string' || !v.trim()) return null;
    return this.decodeSessionIdFromCookie(v);
  }

  async hasAnyUser(): Promise<boolean> {
    const count = await this.prisma.user.count();
    return count > 0;
  }

  decryptCredentialEnvelope(payload: unknown): {
    username: string;
    password: string;
  } {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('credentialEnvelope must be an object');
    }
    return this.credentialEnvelope.decryptEnvelope(
      payload as Record<string, unknown>,
    );
  }

  async registerAdmin(params: {
    username: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }) {
    const { username, password } = params;
    const normalized = this.normalizeUsername(username);
    this.assertValidRegistrationInputs(normalized, password);
    await this.assertRegisterThrottleAndCaptcha({
      username: normalized,
      ip: params.ip,
      userAgent: params.userAgent,
      captchaToken: params.captchaToken,
    });
    await this.assertUsernameAvailable(normalized);
    await this.assertNoExistingAdmin();

    const user = await this.createAdminUser({
      username: normalized,
      password,
    });
    await this.initializeAdminData(user.id);

    await this.prisma.jobSchedule.updateMany({ data: { enabled: false } });

    this.authThrottle.recordSuccess({ username: normalized, ip: params.ip });
    this.logger.log(`Created admin user=${user.username}`);

    return {
      user: { id: user.id, username: user.username } satisfies AuthUser,
      tokenVersion: user.tokenVersion,
    };
  }

  async login(params: {
    username: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }): Promise<AuthLoginResult> {
    const { username, password } = params;
    const normalized = this.assertValidLoginInput(username, password);
    await this.assertLoginAllowed({
      username: normalized,
      ip: params.ip,
      userAgent: params.userAgent,
      captchaToken: params.captchaToken,
    });

    const user = await this.findAuthUserOrThrow({
      username: normalized,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const verification = await this.verifyPasswordOrThrow({
      user,
      password,
      username: normalized,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    await this.rehashPasswordIfNeeded(user.id, password, verification);
    await this.ensurePasswordProofMaterial(user, password);

    this.authThrottle.recordSuccess({ username: normalized, ip: params.ip });

    return await this.createSessionForUser({
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
    });
  }

  async createLoginChallenge(params: {
    username: string;
    ip: string | null;
    userAgent: string | null;
  }) {
    const normalized = this.assertChallengeUsername(params.username);
    const assessment = this.authThrottle.assess({
      username: normalized,
      ip: params.ip,
    });
    this.assertNotLocked(assessment);

    const user = await this.findUserForAuth(normalized);
    const saltB64 = this.resolveChallengeSalt(user);
    const iterations = this.resolveChallengeIterations(user);

    const challengeUserId =
      user && this.hasPasswordProofMaterial(user) ? user.id : null;

    const challenge = this.passwordProof.createChallenge({
      username: normalized,
      userId: challengeUserId,
      saltB64,
      iterations,
    });

    return {
      challengeId: challenge.id,
      algorithm: 'PBKDF2-SHA256-HMAC-SHA256',
      salt: challenge.saltB64,
      iterations: challenge.iterations,
      nonce: challenge.nonce,
      expiresAt: new Date(challenge.expiresAtMs).toISOString(),
    } as const;
  }

  async loginWithChallengeProof(params: {
    challengeId: string;
    proof: string;
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }): Promise<AuthLoginResult> {
    const challengeId = this.assertChallengeId(params.challengeId);
    const proof = this.assertProofValue(params.proof);
    const challenge = this.consumeChallengeOrThrow(challengeId);

    const assessment = this.authThrottle.assess({
      username: challenge.username,
      ip: params.ip,
    });
    this.assertNotLocked(assessment);
    await this.assertCaptchaIfRequired({
      assessment,
      captchaToken: params.captchaToken,
      ip: params.ip,
      username: challenge.username,
      userAgent: params.userAgent,
    });

    if (!challenge.userId) {
      throw this.invalidCredentialsFailure({
        username: challenge.username,
        ip: params.ip,
        userAgent: params.userAgent,
      });
    }

    const user = await this.findProofUserOrThrow({
      userId: challenge.userId,
      username: challenge.username,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const matched = this.matchesChallengeProof({
      encryptedKey: user.passwordProofKeyEnc,
      challengeId,
      nonce: challenge.nonce,
      proof,
    });
    if (!matched) {
      throw this.invalidCredentialsFailure({
        username: challenge.username,
        ip: params.ip,
        userAgent: params.userAgent,
      });
    }

    this.authThrottle.recordSuccess({
      username: challenge.username,
      ip: params.ip,
    });

    return await this.createSessionForUser({
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
    });
  }

  async logout(sessionId: string) {
    const hashed = sha256Hex(sessionId);
    await this.prisma.session
      .delete({ where: { id: hashed } })
      .catch(() => undefined);
  }

  async logoutAll(userId: string) {
    await this.invalidateUserSessions(userId);
  }

  async getUserForSession(sessionId: string): Promise<AuthUser | null> {
    const hashed = sha256Hex(sessionId);
    const session = await this.prisma.session.findUnique({
      where: { id: hashed },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            tokenVersion: true,
          },
        },
      },
    });
    if (!session) return null;

    const now = new Date();
    if (
      session.expiresAt <= now ||
      session.tokenVersion !== session.user.tokenVersion
    ) {
      await this.prisma.session
        .delete({ where: { id: hashed } })
        .catch(() => undefined);
      return null;
    }

    await this.prisma.session
      .update({ where: { id: hashed }, data: { lastSeenAt: now } })
      .catch(() => undefined);

    return {
      id: session.user.id,
      username: session.user.username,
    };
  }

  async changePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }) {
    const currentPassword = params.currentPassword;
    const newPassword = params.newPassword;
    this.assertValidPasswordChangeInputs(currentPassword, newPassword);
    const user = await this.findPasswordChangeUserOrThrow(params.userId);
    await this.assertCurrentPasswordValid(user.passwordHash, currentPassword);
    await this.updatePasswordAndRevokeSessions(user.id, newPassword);

    this.logger.log(
      `auth: password changed userId=${user.id} username=${JSON.stringify(user.username)} ip=${JSON.stringify(params.ip)} ua=${JSON.stringify(params.userAgent)}`,
    );

    return { ok: true } as const;
  }

  async getFirstAdminUserId(): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async isOnboardingComplete(): Promise<boolean> {
    const userId = await this.getFirstAdminUserId();
    if (!userId) return false;

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!settings?.value) return false;

    try {
      const parsed = JSON.parse(settings.value) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'onboarding' in parsed &&
        parsed.onboarding &&
        typeof parsed.onboarding === 'object' &&
        'completed' in parsed.onboarding
      ) {
        return Boolean(parsed.onboarding.completed);
      }
      return false;
    } catch {
      return false;
    }
  }

  async resetAllData() {
    await this.prisma.jobLogLine.deleteMany();
    await this.prisma.jobRun.deleteMany();
    await this.prisma.jobSchedule.deleteMany();
    await this.prisma.curatedCollectionItem.deleteMany();
    await this.prisma.curatedCollection.deleteMany();
    await this.prisma.session.deleteMany();
    await this.prisma.userSecrets.deleteMany();
    await this.prisma.userSettings.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.setting.deleteMany();
  }

  private normalizeUsername(username: string): string {
    return username.trim();
  }

  private assertValidRegistrationInputs(
    normalizedUsername: string,
    password: string,
  ): void {
    if (!normalizedUsername) {
      throw new BadRequestException('username is required');
    }
    if (normalizedUsername.length < 3) {
      throw new BadRequestException('username must be at least 3 chars');
    }
    if (!password || password.length < 10) {
      throw new BadRequestException('password must be at least 10 chars');
    }
  }

  private async assertRegisterThrottleAndCaptcha(params: {
    username: string;
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }): Promise<void> {
    const assessment = this.authThrottle.assess({
      username: params.username,
      ip: params.ip,
    });
    await this.assertCaptchaIfRequired({
      assessment,
      captchaToken: params.captchaToken,
      ip: params.ip,
      username: params.username,
      userAgent: params.userAgent,
    });
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('username already exists');
  }

  private async assertNoExistingAdmin(): Promise<void> {
    if (await this.hasAnyUser()) {
      throw new BadRequestException('admin already exists');
    }
  }

  private async createAdminUser(params: {
    username: string;
    password: string;
  }): Promise<{ id: string; username: string; tokenVersion: number }> {
    const passwordHash = await hashPassword(params.password);
    const proof = createPasswordProofMaterial(params.password);
    return await this.prisma.user.create({
      data: {
        username: params.username,
        passwordHash,
        tokenVersion: 0,
        passwordProofSalt: proof.saltB64,
        passwordProofIterations: proof.iterations,
        passwordProofKeyEnc: this.crypto.encryptString(proof.keyB64),
      },
      select: { id: true, username: true, tokenVersion: true },
    });
  }

  private async initializeAdminData(userId: string): Promise<void> {
    const defaultUserSettings = {
      onboarding: { completed: false },
      jobs: {
        webhookEnabled: {
          watchedMovieRecommendations: false,
          immaculateTastePoints: false,
          mediaAddedCleanup: false,
        },
      },
    };
    await this.prisma.userSettings.create({
      data: {
        userId,
        value: JSON.stringify(defaultUserSettings),
      },
    });
    await this.prisma.userSecrets.create({
      data: { userId, value: '' },
    });
  }

  private assertValidLoginInput(username: string, password: string): string {
    const normalized = this.normalizeUsername(username);
    if (!normalized || !password) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return normalized;
  }

  private async assertLoginAllowed(params: {
    username: string;
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }): Promise<void> {
    const assessment = this.authThrottle.assess({
      username: params.username,
      ip: params.ip,
    });
    this.assertNotLocked(assessment);
    await this.assertCaptchaIfRequired({
      assessment,
      captchaToken: params.captchaToken,
      ip: params.ip,
      username: params.username,
      userAgent: params.userAgent,
    });
  }

  private async findAuthUserOrThrow(params: {
    username: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<AuthLookupUser> {
    const user = await this.findUserForAuth(params.username);
    if (user) return user;
    throw this.invalidCredentialsFailure({
      username: params.username,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  private async verifyPasswordOrThrow(params: {
    user: AuthLookupUser;
    password: string;
    username: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<PasswordVerificationResult> {
    const verification = await verifyPassword(
      params.user.passwordHash,
      params.password,
    );
    if (verification.ok) return verification;
    throw this.invalidCredentialsFailure({
      username: params.username,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  private async rehashPasswordIfNeeded(
    userId: string,
    password: string,
    verification: PasswordVerificationResult,
  ): Promise<void> {
    if (!verification.needsRehash) return;
    const nextHash = await hashPassword(password);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: nextHash },
    });
  }

  private hasPasswordProofMaterial(user: AuthLookupUser | null): boolean {
    return Boolean(
      user?.passwordProofSalt &&
        user.passwordProofIterations &&
        user.passwordProofKeyEnc,
    );
  }

  private async ensurePasswordProofMaterial(
    user: AuthLookupUser,
    password: string,
  ): Promise<void> {
    if (this.hasPasswordProofMaterial(user)) return;
    const proof = createPasswordProofMaterial(password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordProofSalt: proof.saltB64,
        passwordProofIterations: proof.iterations,
        passwordProofKeyEnc: this.crypto.encryptString(proof.keyB64),
      },
    });
  }

  private assertChallengeUsername(username: string): string {
    const normalized = username.trim();
    if (!normalized) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return normalized;
  }

  private resolveChallengeSalt(user: AuthLookupUser | null): string {
    return user?.passwordProofSalt?.trim() || randomBytes(16).toString('base64');
  }

  private resolveChallengeIterations(user: AuthLookupUser | null): number {
    if (user?.passwordProofIterations && user.passwordProofIterations > 0) {
      return user.passwordProofIterations;
    }
    return parsePositiveInt(
      process.env.AUTH_PASSWORD_PROOF_ITERATIONS,
      DEFAULT_PASSWORD_PROOF_ITERATIONS,
    );
  }

  private assertChallengeId(challengeId: string): string {
    const normalized = challengeId.trim();
    if (!normalized) {
      throw new UnauthorizedException('Invalid proof challenge');
    }
    return normalized;
  }

  private assertProofValue(proof: string): string {
    const normalized = proof.trim();
    if (!normalized) {
      throw new UnauthorizedException('Invalid proof challenge');
    }
    return normalized;
  }

  private consumeChallengeOrThrow(challengeId: string) {
    const challenge = this.passwordProof.consumeChallenge(challengeId);
    if (challenge) return challenge;
    throw new UnauthorizedException('Proof challenge expired');
  }

  private async findProofUserOrThrow(params: {
    userId: string;
    username: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{
    id: string;
    username: string;
    tokenVersion: number;
    passwordProofKeyEnc: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        username: true,
        tokenVersion: true,
        passwordProofKeyEnc: true,
      },
    });
    if (user?.passwordProofKeyEnc) {
      return {
        id: user.id,
        username: user.username,
        tokenVersion: user.tokenVersion,
        passwordProofKeyEnc: user.passwordProofKeyEnc,
      };
    }
    throw this.invalidCredentialsFailure({
      username: params.username,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  private matchesChallengeProof(params: {
    encryptedKey: string;
    challengeId: string;
    nonce: string;
    proof: string;
  }): boolean {
    const keyB64 = this.crypto.decryptString(params.encryptedKey);
    const expected = this.passwordProof.buildExpectedProof({
      keyB64,
      challengeId: params.challengeId,
      nonce: params.nonce,
    });
    return this.passwordProof.matches(expected, params.proof);
  }

  private assertValidPasswordChangeInputs(
    currentPassword: string,
    newPassword: string,
  ): void {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException(
        'currentPassword and newPassword are required',
      );
    }
    if (newPassword.length < 10) {
      throw new BadRequestException('newPassword must be at least 10 chars');
    }
  }

  private async findPasswordChangeUserOrThrow(userId: string): Promise<{
    id: string;
    username: string;
    passwordHash: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        passwordHash: true,
      },
    });
    if (user) return user;
    throw new UnauthorizedException('Invalid session');
  }

  private async assertCurrentPasswordValid(
    passwordHash: string,
    currentPassword: string,
  ): Promise<void> {
    const verified = await verifyPassword(passwordHash, currentPassword);
    if (!verified.ok) {
      throw new UnauthorizedException('Current password is invalid');
    }
  }

  private async updatePasswordAndRevokeSessions(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const newHash = await hashPassword(newPassword);
    const proof = createPasswordProofMaterial(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          passwordProofSalt: proof.saltB64,
          passwordProofIterations: proof.iterations,
          passwordProofKeyEnc: this.crypto.encryptString(proof.keyB64),
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  private async createSessionForUser(params: {
    userId: string;
    username: string;
    tokenVersion: number;
  }): Promise<AuthLoginResult> {
    const sessionId = this.createSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.getSessionMaxAgeMs());

    await this.prisma.session.create({
      data: {
        id: sha256Hex(sessionId),
        userId: params.userId,
        tokenVersion: params.tokenVersion,
        expiresAt,
      },
    });

    return {
      sessionId,
      user: { id: params.userId, username: params.username },
    };
  }

  private async findUserForAuth(username: string): Promise<AuthLookupUser | null> {
    const exact = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        tokenVersion: true,
        passwordProofSalt: true,
        passwordProofIterations: true,
        passwordProofKeyEnc: true,
      },
    });
    if (exact) return exact;

    const fallback = await this.prisma.$queryRaw<Array<AuthLookupUser>>`SELECT "id", "username", "passwordHash", "tokenVersion", "passwordProofSalt", "passwordProofIterations", "passwordProofKeyEnc" FROM "User" WHERE "username" = ${username} COLLATE NOCASE LIMIT 1`;

    return fallback[0] ?? null;
  }

  private assertNotLocked(assessment: ThrottleAssessment): void {
    if (assessment.allowed) return;
    throw new UnauthorizedException({
      message: 'Too many authentication attempts',
      retryAfterSeconds: assessment.retryAfterSeconds,
      retryAt: assessment.retryAt,
      captchaRequired: assessment.captchaRequired,
    });
  }

  private async assertCaptchaIfRequired(params: {
    assessment: ThrottleAssessment;
    captchaToken: string | null | undefined;
    ip: string | null;
    username: string;
    userAgent: string | null;
  }) {
    if (!params.assessment.captchaRequired) return;

    const ok = await this.captcha.verify({
      token: params.captchaToken,
      ip: params.ip,
    });
    if (ok) return;

    this.logger.warn(
      `auth captcha required username=${JSON.stringify(params.username)} ip=${JSON.stringify(params.ip)} ua=${JSON.stringify(params.userAgent)}`,
    );

    throw new UnauthorizedException({
      message: 'Captcha required',
      retryAfterSeconds: params.assessment.retryAfterSeconds,
      retryAt: params.assessment.retryAt,
      captchaRequired: true,
    });
  }

  private invalidCredentialsFailure(params: {
    username: string;
    ip: string | null;
    userAgent: string | null;
  }): UnauthorizedException {
    const assessment = this.authThrottle.recordFailure({
      username: params.username,
      ip: params.ip,
      userAgent: params.userAgent,
      reason: 'invalid_credentials',
    });

    return new UnauthorizedException({
      message: 'Invalid credentials',
      retryAfterSeconds: assessment.retryAfterSeconds,
      retryAt: assessment.retryAt,
      captchaRequired: assessment.captchaRequired,
    });
  }

  private async invalidateUserSessions(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  private createSessionId() {
    return randomBytes(32).toString('base64url');
  }

  private decodeSessionIdFromCookie(rawCookieValue: string): string | null {
    const value = rawCookieValue.trim();
    if (!value) return null;

    // Backward compatibility: accept legacy plaintext session cookies.
    if (!this.crypto.isEncrypted(value)) {
      return value;
    }
    return this.decodeEncryptedSessionCookie(value);
  }

  private decodeEncryptedSessionCookie(
    encryptedCookieValue: string,
  ): string | null {
    try {
      const decoded = this.crypto.decryptString(encryptedCookieValue);
      if (!decoded.startsWith(SESSION_COOKIE_PAYLOAD_PREFIX)) {
        return null;
      }
      const sessionId = decoded
        .slice(SESSION_COOKIE_PAYLOAD_PREFIX.length)
        .trim();
      return sessionId || null;
    } catch {
      return null;
    }
  }

  // Exposed for tests / future client helpers.
  createPasswordProofFromPassword(params: {
    password: string;
    saltB64: string;
    iterations: number;
    challengeId: string;
    nonce: string;
  }): string {
    const keyB64 = derivePasswordProofKey({
      password: params.password,
      saltB64: params.saltB64,
      iterations: params.iterations,
    });
    return this.passwordProof.buildExpectedProof({
      keyB64,
      challengeId: params.challengeId,
      nonce: params.nonce,
    });
  }
}
