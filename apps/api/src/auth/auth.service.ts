import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../db/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
  CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
  FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME,
  RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
  RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
  buildImmaculateCollectionName,
  buildUserCollectionName,
  normalizeCollectionTitle,
} from '../plex/plex-collections.utils';
import { PlexServerService } from '../plex/plex-server.service';
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
import {
  PASSWORD_RECOVERY_CHALLENGE_TTL_MS,
  PASSWORD_RECOVERY_LOCKOUT_MS,
  PASSWORD_RECOVERY_MAX_FAILED_ATTEMPTS,
  PASSWORD_RECOVERY_REQUIRED_QUESTION_COUNT,
  PASSWORD_RECOVERY_RESET_QUESTION_COUNT,
  PASSWORD_RECOVERY_SECURITY_QUESTIONS,
} from '../app.constants';
import { maskUsername, maskIp } from '../log.utils';

const SESSION_COOKIE = 'tcp_session';
const SESSION_COOKIE_PAYLOAD_PREFIX = 'sid:v1:';
const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_PASSWORD_PROOF_ITERATIONS = 210_000;
const MIN_RECOVERY_ANSWER_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 10;
const RESET_PLEX_COLLECTION_LOOKUP_TAKE = 1_200;
const RESET_PLEX_COLLECTION_TITLE_KEYWORDS = [
  'Immaculate Taste',
  'Change of Movie Taste',
  'Based on your recently watched',
  'Change of Taste',
  'Fresh Out Of The Oven',
] as const;

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isoFromMs(ms: number | null): string | null {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const value = pick(obj, path);
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new BadRequestException('Plex baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function isPrismaMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === 'P2021';
}

function readPrismaMissingTableName(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const meta = (error as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const table = (meta as { table?: unknown }).table;
  return typeof table === 'string' && table.trim() ? table.trim() : null;
}

export type PasswordRecoveryQuestion = {
  key: string;
  prompt: string;
};

export type PasswordRecoveryAnswerInput = {
  questionKey: string;
  answer: string;
};

type PasswordRecoveryStatus = {
  required: boolean;
  configured: boolean;
  configuredQuestionKeys: string[];
};

type PasswordResetChallenge = {
  challengeId: string;
  questions: Array<{
    slot: 1 | 2 | 3;
    questionKey: string;
    prompt: string;
  }>;
  expiresAt: string;
  attemptsRemaining: number;
};

type StoredPasswordResetChallenge = {
  id: string;
  username: string;
  userId: string;
  slots: [1 | 2 | 3, 1 | 2 | 3];
  createdAtMs: number;
  expiresAtMs: number;
  consumed: boolean;
};

type PasswordResetAttemptState = {
  failures: number;
  lockUntilMs: number;
  lastFailureAtMs: number;
};

type PasswordResetAttemptAssessment = {
  allowed: boolean;
  attemptsRemaining: number;
  retryAfterSeconds: number | null;
  retryAt: string | null;
};

type UserRecoveryRecord = {
  questionOneKey: string;
  questionOneAnswerHash: string;
  questionTwoKey: string;
  questionTwoAnswerHash: string;
  questionThreeKey: string;
  questionThreeAnswerHash: string;
};

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

type ResetPlexConnection = {
  baseUrl: string;
  token: string;
};

type ResetCollectionMatch = {
  sectionKey: string;
  sectionTitle: string;
  ratingKey: string;
  title: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly passwordRecoveryQuestions: PasswordRecoveryQuestion[] =
    PASSWORD_RECOVERY_SECURITY_QUESTIONS.map((question) => ({
      key: question.key,
      prompt: question.prompt,
    }));
  private readonly passwordRecoveryQuestionByKey = new Map(
    this.passwordRecoveryQuestions.map((question) => [question.key, question]),
  );
  private readonly passwordResetChallenges = new Map<
    string,
    StoredPasswordResetChallenge
  >();
  private readonly passwordResetAttempts = new Map<
    string,
    PasswordResetAttemptState
  >();
  private readonly passwordResetMaxFailures = parsePositiveInt(
    process.env.AUTH_PASSWORD_RESET_MAX_FAILURES,
    PASSWORD_RECOVERY_MAX_FAILED_ATTEMPTS,
  );
  private readonly passwordResetLockMs = parsePositiveInt(
    process.env.AUTH_PASSWORD_RESET_LOCKOUT_MS,
    PASSWORD_RECOVERY_LOCKOUT_MS,
  );
  private readonly passwordResetWindowMs = parsePositiveInt(
    process.env.AUTH_PASSWORD_RESET_WINDOW_MS,
    PASSWORD_RECOVERY_LOCKOUT_MS,
  );
  private readonly passwordResetChallengeTtlMs = parsePositiveInt(
    process.env.AUTH_PASSWORD_RESET_CHALLENGE_TTL_MS,
    PASSWORD_RECOVERY_CHALLENGE_TTL_MS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly authThrottle: AuthThrottleService,
    private readonly captcha: CaptchaService,
    private readonly credentialEnvelope: CredentialEnvelopeService,
    private readonly passwordProof: PasswordProofService,
    private readonly plexServer: PlexServerService,
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
    const envelopePayload = this.decryptCredentialEnvelopePayload(payload);
    const username =
      typeof envelopePayload['username'] === 'string'
        ? envelopePayload['username']
        : '';
    const password =
      typeof envelopePayload['password'] === 'string'
        ? envelopePayload['password']
        : '';
    if (!username.trim() || !password) {
      throw new BadRequestException(
        'credentialEnvelope payload must include username and password',
      );
    }
    return { username, password };
  }

  decryptCredentialEnvelopePayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('credentialEnvelope must be an object');
    }
    return this.credentialEnvelope.decryptPayload(
      payload as Record<string, unknown>,
      {
        requireTimestamp: true,
        requireNonce: true,
      },
    );
  }

  async registerAdmin(params: {
    username: string;
    password: string;
    recoveryAnswers: PasswordRecoveryAnswerInput[];
    ip: string | null;
    userAgent: string | null;
    captchaToken?: string | null;
  }) {
    const { username, password } = params;
    const normalized = this.normalizeUsername(username);
    const normalizedRecoveryAnswers = this.normalizeRecoveryAnswerInputs(
      params.recoveryAnswers,
    );
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
    await this.upsertPasswordRecovery({
      userId: user.id,
      answers: normalizedRecoveryAnswers,
    });

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

    const newExpiresAt = new Date(now.getTime() + this.getSessionMaxAgeMs());
    await this.prisma.session
      .update({
        where: { id: hashed },
        data: { lastSeenAt: now, expiresAt: newExpiresAt },
      })
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

    const assessment = this.authThrottle.assess({
      username: user.username,
      ip: params.ip,
    });
    this.assertNotLocked(assessment);

    const verified = await verifyPassword(user.passwordHash, currentPassword);
    if (!verified.ok) {
      this.authThrottle.recordFailure({
        username: user.username,
        ip: params.ip,
        userAgent: params.userAgent,
        reason: 'change_password_invalid_current',
      });
      throw new UnauthorizedException('Current password is invalid');
    }

    await this.updatePasswordAndRevokeSessions(user.id, newPassword);
    this.authThrottle.recordSuccess({ username: user.username, ip: params.ip });

    this.logger.log(
      `auth: password changed userId=${user.id} username=${JSON.stringify(maskUsername(user.username))} ip=${JSON.stringify(maskIp(params.ip))}`,
    );

    return { ok: true } as const;
  }

  listPasswordRecoveryQuestions(): PasswordRecoveryQuestion[] {
    return this.passwordRecoveryQuestions;
  }

  async getPasswordRecoveryStatus(
    userId: string,
  ): Promise<PasswordRecoveryStatus> {
    const recovery = await this.prisma.userRecovery.findUnique({
      where: { userId },
      select: {
        questionOneKey: true,
        questionOneAnswerHash: true,
        questionTwoKey: true,
        questionTwoAnswerHash: true,
        questionThreeKey: true,
        questionThreeAnswerHash: true,
      },
    });
    const configured = this.hasValidRecoveryRecord(recovery);

    return {
      required: !configured,
      configured,
      configuredQuestionKeys: configured
        ? [
            recovery.questionOneKey,
            recovery.questionTwoKey,
            recovery.questionThreeKey,
          ]
        : [],
    };
  }

  async configurePasswordRecovery(params: {
    userId: string;
    currentPassword: string;
    answers: PasswordRecoveryAnswerInput[];
    ip: string | null;
    userAgent: string | null;
  }) {
    const normalizedAnswers = this.normalizeRecoveryAnswerInputs(
      params.answers,
    );
    if (!params.currentPassword) {
      throw new BadRequestException('currentPassword is required');
    }

    const user = await this.findPasswordChangeUserOrThrow(params.userId);
    await this.assertCurrentPasswordValid(
      user.passwordHash,
      params.currentPassword,
    );
    await this.upsertPasswordRecovery({
      userId: user.id,
      answers: normalizedAnswers,
    });

    this.logger.log(
      `auth: password recovery updated userId=${user.id} username=${JSON.stringify(maskUsername(user.username))} ip=${JSON.stringify(maskIp(params.ip))}`,
    );

    return { ok: true } as const;
  }

  async createPasswordResetChallenge(params: {
    username: string;
    ip: string | null;
  }): Promise<PasswordResetChallenge> {
    const normalizedUsername = this.assertPasswordResetUsername(
      params.username,
    );
    const assessment = this.assessPasswordResetAttempts({
      username: normalizedUsername,
      ip: params.ip,
    });
    this.assertPasswordResetAllowed(assessment);

    const user = await this.findPasswordResetUser(normalizedUsername);
    const recovery = user?.recovery;
    if (!user || !this.hasValidRecoveryRecord(recovery)) {
      throw new UnauthorizedException(
        'Password recovery is not configured for this account',
      );
    }

    const challenge = this.createStoredPasswordResetChallenge({
      username: normalizedUsername,
      userId: user.id,
    });

    return {
      challengeId: challenge.id,
      questions: challenge.slots.map((slot) =>
        this.getPasswordResetQuestionForSlot({
          recovery,
          slot,
        }),
      ),
      expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      attemptsRemaining: assessment.attemptsRemaining,
    };
  }

  async resetPasswordWithRecovery(params: {
    challengeId: string;
    newPassword: string;
    answers: Array<{ slot: number; answer: string }>;
    ip: string | null;
    userAgent: string | null;
  }) {
    const challengeId = this.assertPasswordResetChallengeId(params.challengeId);
    this.assertValidNewPassword(params.newPassword);

    const challenge = this.consumePasswordResetChallengeOrThrow(challengeId);
    const assessment = this.assessPasswordResetAttempts({
      username: challenge.username,
      ip: params.ip,
    });
    this.assertPasswordResetAllowed(assessment);

    const normalizedAnswers = this.normalizeResetChallengeAnswers({
      answers: params.answers,
      expectedSlots: challenge.slots,
    });
    const user = await this.findPasswordResetUserById(challenge.userId);
    const recovery = user?.recovery;
    if (!user || !this.hasValidRecoveryRecord(recovery)) {
      throw this.passwordResetFailure({
        username: challenge.username,
        ip: params.ip,
        userAgent: params.userAgent,
        reason: 'recovery_not_configured',
      });
    }

    const matched = await this.passwordResetAnswersMatch({
      recovery,
      normalizedAnswers,
      slots: challenge.slots,
    });
    if (!matched) {
      throw this.passwordResetFailure({
        username: challenge.username,
        ip: params.ip,
        userAgent: params.userAgent,
        reason: 'wrong_recovery_answers',
      });
    }

    await this.updatePasswordAndRevokeSessions(user.id, params.newPassword);
    this.clearPasswordResetFailures({
      username: challenge.username,
      ip: params.ip,
    });
    this.logger.log(
      `auth: password reset with recovery success userId=${user.id} username=${JSON.stringify(maskUsername(user.username))} ip=${JSON.stringify(maskIp(params.ip))}`,
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
    await this.deletePlexCollectionsForFreshReset();

    await this.runResetDeleteStep('jobLogLine', () =>
      this.prisma.jobLogLine.deleteMany(),
    );
    await this.runResetDeleteStep('jobRun', () =>
      this.prisma.jobRun.deleteMany(),
    );
    await this.runResetDeleteStep('jobSchedule', () =>
      this.prisma.jobSchedule.deleteMany(),
    );
    await this.runResetDeleteStep('curatedCollectionItem', () =>
      this.prisma.curatedCollectionItem.deleteMany(),
    );
    await this.runResetDeleteStep('curatedCollection', () =>
      this.prisma.curatedCollection.deleteMany(),
    );
    await this.runResetDeleteStep('watchedMovieRecommendationLibrary', () =>
      this.prisma.watchedMovieRecommendationLibrary.deleteMany(),
    );
    await this.runResetDeleteStep('watchedShowRecommendationLibrary', () =>
      this.prisma.watchedShowRecommendationLibrary.deleteMany(),
    );
    await this.runResetDeleteStep('freshReleaseMovieLibrary', () =>
      this.prisma.freshReleaseMovieLibrary.deleteMany(),
    );
    await this.runResetDeleteStep('immaculateTasteMovieLibrary', () =>
      this.prisma.immaculateTasteMovieLibrary.deleteMany(),
    );
    await this.runResetDeleteStep('immaculateTasteShowLibrary', () =>
      this.prisma.immaculateTasteShowLibrary.deleteMany(),
    );
    await this.runResetDeleteStep('watchedMovieRecommendation', () =>
      this.prisma.watchedMovieRecommendation.deleteMany(),
    );
    await this.runResetDeleteStep('watchedShowRecommendation', () =>
      this.prisma.watchedShowRecommendation.deleteMany(),
    );
    await this.runResetDeleteStep('immaculateTasteMovie', () =>
      this.prisma.immaculateTasteMovie.deleteMany(),
    );
    await this.runResetDeleteStep('immaculateTasteShow', () =>
      this.prisma.immaculateTasteShow.deleteMany(),
    );
    await this.runResetDeleteStep('immaculateTasteProfileUserOverride', () =>
      this.prisma.immaculateTasteProfileUserOverride.deleteMany(),
    );
    await this.runResetDeleteStep('immaculateTasteProfile', () =>
      this.prisma.immaculateTasteProfile.deleteMany(),
    );
    await this.runResetDeleteStep('importedWatchEntry', () =>
      this.prisma.importedWatchEntry.deleteMany(),
    );
    await this.runResetDeleteStep('rejectedSuggestion', () =>
      this.prisma.rejectedSuggestion.deleteMany(),
    );
    await this.runResetDeleteStep('arrInstance', () =>
      this.prisma.arrInstance.deleteMany(),
    );
    await this.runResetDeleteStep('plexUser', () =>
      this.prisma.plexUser.deleteMany(),
    );
    await this.runResetDeleteStep('session', () =>
      this.prisma.session.deleteMany(),
    );
    await this.runResetDeleteStep('userRecovery', () =>
      this.prisma.userRecovery.deleteMany(),
    );
    await this.runResetDeleteStep('userSecrets', () =>
      this.prisma.userSecrets.deleteMany(),
    );
    await this.runResetDeleteStep('userSettings', () =>
      this.prisma.userSettings.deleteMany(),
    );
    await this.runResetDeleteStep('user', () => this.prisma.user.deleteMany());
    await this.runResetDeleteStep('setting', () =>
      this.prisma.setting.deleteMany(),
    );
    this.passwordResetChallenges.clear();
    this.passwordResetAttempts.clear();
  }

  private async runResetDeleteStep(
    modelName: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (isPrismaMissingTableError(error)) {
        const tableName =
          readPrismaMissingTableName(error) ?? `${modelName} (unknown table)`;
        this.logger.warn(
          `auth: reset-dev skipped missing table cleanup model=${modelName} table=${JSON.stringify(tableName)}`,
        );
        return;
      }
      throw error;
    }
  }

  private async deletePlexCollectionsForFreshReset(): Promise<void> {
    const connection = await this.resolveResetPlexConnection();
    if (!connection) {
      this.logger.log(
        'auth: reset-dev skipped Plex collection cleanup (Plex not configured)',
      );
      return;
    }

    const sections = await this.plexServer
      .getSections({
        baseUrl: connection.baseUrl,
        token: connection.token,
      })
      .catch((error: unknown) => {
        throw new BadRequestException(
          `Could not connect to Plex during reset: ${errorToMessage(error)}`,
        );
      });
    const targetSections = sections.filter((section) => {
      const type = String(section.type ?? '')
        .trim()
        .toLowerCase();
      return type === 'movie' || type === 'show';
    });
    if (!targetSections.length) {
      this.logger.log(
        'auth: reset-dev skipped Plex collection cleanup (no movie/show sections)',
      );
      return;
    }

    const normalizedCandidateTitles =
      await this.collectResetCollectionCandidateTitles();
    const normalizedKeywordSet = new Set(
      RESET_PLEX_COLLECTION_TITLE_KEYWORDS.map((keyword) =>
        normalizeCollectionTitle(keyword),
      ).filter((keyword) => Boolean(keyword)),
    );

    const firstPassMatches = await this.findMatchingResetCollections({
      connection,
      sections: targetSections,
      normalizedCandidateTitles,
      normalizedKeywordSet,
    });
    const firstPassDeleted = await this.deleteMatchingResetCollections({
      connection,
      matches: firstPassMatches,
    });

    const secondPassMatches = await this.findMatchingResetCollections({
      connection,
      sections: targetSections,
      normalizedCandidateTitles,
      normalizedKeywordSet,
    });
    const secondPassDeleted = await this.deleteMatchingResetCollections({
      connection,
      matches: secondPassMatches,
    });

    const remainingMatches = await this.findMatchingResetCollections({
      connection,
      sections: targetSections,
      normalizedCandidateTitles,
      normalizedKeywordSet,
    });
    if (remainingMatches.length) {
      const sample = remainingMatches
        .slice(0, 5)
        .map(
          (item) =>
            `${item.sectionTitle || item.sectionKey}: ${JSON.stringify(item.title)}`,
        )
        .join(', ');
      this.logger.warn(
        `auth: reset-dev failed to remove all Plex collections; remaining=${remainingMatches.length} sample=${sample}`,
      );
      throw new BadRequestException(
        'Could not fully delete Immaculaterr Plex collections. Ensure Plex is reachable and retry reset.',
      );
    }

    this.logger.log(
      `auth: reset-dev Plex collection cleanup finished sections=${targetSections.length} deleted=${firstPassDeleted + secondPassDeleted}`,
    );
  }

  private async resolveResetPlexConnection(): Promise<ResetPlexConnection | null> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    for (const user of users) {
      const [settings, secrets] = await Promise.all([
        this.readSettingsDocForReset(user.id),
        this.readSecretsDocForReset(user.id),
      ]);
      const baseUrlRaw =
        pickString(settings, 'plex.baseUrl') ||
        pickString(settings, 'plex.url');
      const token =
        pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
      if (!baseUrlRaw || !token) continue;
      return {
        baseUrl: normalizeHttpUrl(baseUrlRaw),
        token,
      };
    }
    return null;
  }

  private async readSettingsDocForReset(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!row?.value) return {};
    try {
      const raw = this.crypto.isEncrypted(row.value)
        ? this.crypto.decryptString(row.value)
        : row.value;
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private async readSecretsDocForReset(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.userSecrets.findUnique({ where: { userId } });
    if (!row?.value) return {};
    try {
      const raw = this.crypto.isEncrypted(row.value)
        ? this.crypto.decryptString(row.value)
        : row.value;
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private async collectResetCollectionCandidateTitles(): Promise<Set<string>> {
    const normalizedTitles = new Set<string>();
    const baseNames = new Set<string>();
    const addBaseName = (value: string | null | undefined) => {
      const normalized = String(value ?? '').trim();
      if (normalized) {
        baseNames.add(normalized);
      }
    };
    const addTitle = (value: string | null | undefined) => {
      const normalized = normalizeCollectionTitle(String(value ?? '').trim());
      if (normalized) {
        normalizedTitles.add(normalized);
      }
    };

    for (const baseName of [
      IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
      IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME,
      RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
      RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
      CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
      CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
      FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
    ]) {
      addBaseName(baseName);
      addTitle(baseName);
    }

    const [
      profiles,
      movieCollections,
      showCollections,
      movieLibraryCollections,
      showLibraryCollections,
      plexUsers,
    ] = await Promise.all([
      this.prisma.immaculateTasteProfile.findMany({
        select: {
          movieCollectionBaseName: true,
          showCollectionBaseName: true,
          userOverrides: {
            select: {
              movieCollectionBaseName: true,
              showCollectionBaseName: true,
            },
          },
        },
      }),
      this.prisma.watchedMovieRecommendation.findMany({
        distinct: ['collectionName'],
        select: { collectionName: true },
      }),
      this.prisma.watchedShowRecommendation.findMany({
        distinct: ['collectionName'],
        select: { collectionName: true },
      }),
      this.prisma.watchedMovieRecommendationLibrary.findMany({
        distinct: ['collectionName'],
        select: { collectionName: true },
      }),
      this.prisma.watchedShowRecommendationLibrary.findMany({
        distinct: ['collectionName'],
        select: { collectionName: true },
      }),
      this.prisma.plexUser.findMany({
        select: { plexAccountTitle: true },
      }),
    ]);

    for (const profile of profiles) {
      addBaseName(profile.movieCollectionBaseName);
      addBaseName(profile.showCollectionBaseName);
      for (const override of profile.userOverrides) {
        addBaseName(override.movieCollectionBaseName);
        addBaseName(override.showCollectionBaseName);
      }
    }

    for (const row of [
      ...movieCollections,
      ...showCollections,
      ...movieLibraryCollections,
      ...showLibraryCollections,
    ]) {
      addTitle(row.collectionName);
    }

    const plexUserTitles = plexUsers
      .map((user) => String(user.plexAccountTitle ?? '').trim())
      .filter((title) => Boolean(title));
    for (const baseName of baseNames) {
      addTitle(baseName);
      for (const plexUserTitle of plexUserTitles) {
        addTitle(buildImmaculateCollectionName(baseName, plexUserTitle));
        addTitle(buildUserCollectionName(baseName, plexUserTitle));
      }
    }

    return normalizedTitles;
  }

  private isResetCollectionTitleMatch(params: {
    title: string;
    normalizedCandidateTitles: Set<string>;
    normalizedKeywordSet: Set<string>;
  }): boolean {
    const normalizedTitle = normalizeCollectionTitle(params.title);
    if (!normalizedTitle) return false;
    if (params.normalizedCandidateTitles.has(normalizedTitle)) return true;
    for (const keyword of params.normalizedKeywordSet) {
      if (normalizedTitle.includes(keyword)) {
        return true;
      }
    }
    return false;
  }

  private async findMatchingResetCollections(params: {
    connection: ResetPlexConnection;
    sections: Array<{ key: string; title: string; type?: string }>;
    normalizedCandidateTitles: Set<string>;
    normalizedKeywordSet: Set<string>;
  }): Promise<ResetCollectionMatch[]> {
    const matches: ResetCollectionMatch[] = [];
    for (const section of params.sections) {
      const collections = await this.plexServer
        .listCollectionsForSectionKey({
          baseUrl: params.connection.baseUrl,
          token: params.connection.token,
          librarySectionKey: section.key,
          take: RESET_PLEX_COLLECTION_LOOKUP_TAKE,
        })
        .catch((error: unknown) => {
          throw new BadRequestException(
            `Could not read Plex collections for section ${section.key}: ${errorToMessage(error)}`,
          );
        });
      for (const collection of collections) {
        if (
          !this.isResetCollectionTitleMatch({
            title: collection.title,
            normalizedCandidateTitles: params.normalizedCandidateTitles,
            normalizedKeywordSet: params.normalizedKeywordSet,
          })
        ) {
          continue;
        }
        matches.push({
          sectionKey: section.key,
          sectionTitle: section.title,
          ratingKey: collection.ratingKey,
          title: collection.title,
        });
      }
    }
    return matches;
  }

  private async deleteMatchingResetCollections(params: {
    connection: ResetPlexConnection;
    matches: ResetCollectionMatch[];
  }): Promise<number> {
    let deleted = 0;
    for (const match of params.matches) {
      try {
        await this.plexServer.deleteCollection({
          baseUrl: params.connection.baseUrl,
          token: params.connection.token,
          collectionRatingKey: match.ratingKey,
        });
        deleted += 1;
      } catch (error) {
        this.logger.warn(
          `auth: reset-dev delete collection failed section=${match.sectionKey} title=${JSON.stringify(match.title)} ratingKey=${JSON.stringify(match.ratingKey)} error=${JSON.stringify(errorToMessage(error))}`,
        );
      }
    }
    return deleted;
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
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `password must be at least ${MIN_PASSWORD_LENGTH} chars`,
      );
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

  private normalizeRecoveryAnswer(answer: string): string {
    return answer.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private normalizeRecoveryAnswerInputs(
    answers: PasswordRecoveryAnswerInput[],
  ): PasswordRecoveryAnswerInput[] {
    if (!Array.isArray(answers)) {
      throw new BadRequestException('recoveryAnswers must be an array');
    }
    if (answers.length !== PASSWORD_RECOVERY_REQUIRED_QUESTION_COUNT) {
      throw new BadRequestException(
        `recoveryAnswers must include exactly ${PASSWORD_RECOVERY_REQUIRED_QUESTION_COUNT} entries`,
      );
    }

    const seenKeys = new Set<string>();
    return answers.map((entry, index) => {
      const questionKey = `${entry?.questionKey ?? ''}`.trim();
      const answer = this.normalizeRecoveryAnswer(`${entry?.answer ?? ''}`);

      if (!this.passwordRecoveryQuestionByKey.has(questionKey)) {
        throw new BadRequestException(
          `recoveryAnswers[${index}].questionKey is invalid`,
        );
      }
      if (seenKeys.has(questionKey)) {
        throw new BadRequestException(
          'recoveryAnswers must use three different questions',
        );
      }
      seenKeys.add(questionKey);

      if (answer.length < MIN_RECOVERY_ANSWER_LENGTH) {
        throw new BadRequestException(
          `recoveryAnswers[${index}].answer must be at least ${MIN_RECOVERY_ANSWER_LENGTH} chars`,
        );
      }

      return { questionKey, answer };
    });
  }

  private assertValidNewPassword(newPassword: string): void {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `newPassword must be at least ${MIN_PASSWORD_LENGTH} chars`,
      );
    }
  }

  private async upsertPasswordRecovery(params: {
    userId: string;
    answers: PasswordRecoveryAnswerInput[];
  }): Promise<void> {
    const [one, two, three] = params.answers;
    if (!one || !two || !three) {
      throw new BadRequestException(
        `recoveryAnswers must include exactly ${PASSWORD_RECOVERY_REQUIRED_QUESTION_COUNT} entries`,
      );
    }

    const [oneHash, twoHash, threeHash] = await Promise.all([
      hashPassword(one.answer),
      hashPassword(two.answer),
      hashPassword(three.answer),
    ]);

    await this.prisma.userRecovery.upsert({
      where: { userId: params.userId },
      update: {
        questionOneKey: one.questionKey,
        questionOneAnswerHash: oneHash,
        questionTwoKey: two.questionKey,
        questionTwoAnswerHash: twoHash,
        questionThreeKey: three.questionKey,
        questionThreeAnswerHash: threeHash,
      },
      create: {
        userId: params.userId,
        questionOneKey: one.questionKey,
        questionOneAnswerHash: oneHash,
        questionTwoKey: two.questionKey,
        questionTwoAnswerHash: twoHash,
        questionThreeKey: three.questionKey,
        questionThreeAnswerHash: threeHash,
      },
    });
  }

  private hasValidRecoveryRecord(
    recovery: UserRecoveryRecord | null | undefined,
  ): recovery is UserRecoveryRecord {
    if (!recovery) return false;
    const keys = [
      recovery.questionOneKey.trim(),
      recovery.questionTwoKey.trim(),
      recovery.questionThreeKey.trim(),
    ];
    const hashes = [
      recovery.questionOneAnswerHash.trim(),
      recovery.questionTwoAnswerHash.trim(),
      recovery.questionThreeAnswerHash.trim(),
    ];
    if (keys.some((key) => !key) || hashes.some((hash) => !hash)) return false;
    if (new Set(keys).size !== PASSWORD_RECOVERY_REQUIRED_QUESTION_COUNT) {
      return false;
    }
    return keys.every((key) => this.passwordRecoveryQuestionByKey.has(key));
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
    return (
      user?.passwordProofSalt?.trim() || randomBytes(16).toString('base64')
    );
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

  private assertPasswordResetUsername(username: string): string {
    const normalized = this.normalizeUsername(username);
    if (!normalized) {
      throw new BadRequestException('username is required');
    }
    return normalized;
  }

  private assertPasswordResetChallengeId(challengeId: string): string {
    const normalized = challengeId.trim();
    if (!normalized) {
      throw new BadRequestException('challengeId is required');
    }
    return normalized;
  }

  private async findPasswordResetUser(username: string): Promise<{
    id: string;
    username: string;
    recovery: UserRecoveryRecord | null;
  } | null> {
    const authUser = await this.findUserForAuth(username);
    if (!authUser) return null;
    return await this.findPasswordResetUserById(authUser.id);
  }

  private async findPasswordResetUserById(userId: string): Promise<{
    id: string;
    username: string;
    recovery: UserRecoveryRecord | null;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        recovery: {
          select: {
            questionOneKey: true,
            questionOneAnswerHash: true,
            questionTwoKey: true,
            questionTwoAnswerHash: true,
            questionThreeKey: true,
            questionThreeAnswerHash: true,
          },
        },
      },
    });
    return user ?? null;
  }

  private getRecoveryQuestionKeyForSlot(
    recovery: UserRecoveryRecord,
    slot: 1 | 2 | 3,
  ): string {
    if (slot === 1) return recovery.questionOneKey;
    if (slot === 2) return recovery.questionTwoKey;
    return recovery.questionThreeKey;
  }

  private getRecoveryAnswerHashForSlot(
    recovery: UserRecoveryRecord,
    slot: 1 | 2 | 3,
  ): string {
    if (slot === 1) return recovery.questionOneAnswerHash;
    if (slot === 2) return recovery.questionTwoAnswerHash;
    return recovery.questionThreeAnswerHash;
  }

  private getPasswordResetQuestionForSlot(params: {
    recovery: UserRecoveryRecord;
    slot: 1 | 2 | 3;
  }): {
    slot: 1 | 2 | 3;
    questionKey: string;
    prompt: string;
  } {
    const questionKey = this.getRecoveryQuestionKeyForSlot(
      params.recovery,
      params.slot,
    );
    const question = this.passwordRecoveryQuestionByKey.get(questionKey);
    if (!question) {
      throw new UnauthorizedException(
        'Password recovery is not configured for this account',
      );
    }
    return {
      slot: params.slot,
      questionKey,
      prompt: question.prompt,
    };
  }

  private createStoredPasswordResetChallenge(params: {
    username: string;
    userId: string;
  }): StoredPasswordResetChallenge {
    const now = Date.now();
    this.cleanupPasswordResetChallenges(now);
    const slots = this.selectRandomPasswordResetSlots();
    const challenge: StoredPasswordResetChallenge = {
      id: randomBytes(24).toString('base64url'),
      username: params.username,
      userId: params.userId,
      slots,
      createdAtMs: now,
      expiresAtMs: now + this.passwordResetChallengeTtlMs,
      consumed: false,
    };
    this.passwordResetChallenges.set(challenge.id, challenge);
    return challenge;
  }

  private consumePasswordResetChallengeOrThrow(
    challengeId: string,
  ): StoredPasswordResetChallenge {
    const now = Date.now();
    this.cleanupPasswordResetChallenges(now);
    const challenge = this.passwordResetChallenges.get(challengeId);
    if (!challenge || challenge.consumed || challenge.expiresAtMs <= now) {
      throw new UnauthorizedException('Password reset challenge expired');
    }
    challenge.consumed = true;
    return challenge;
  }

  private cleanupPasswordResetChallenges(now: number): void {
    for (const [id, challenge] of this.passwordResetChallenges.entries()) {
      if (challenge.consumed || challenge.expiresAtMs <= now) {
        this.passwordResetChallenges.delete(id);
      }
    }
  }

  private selectRandomPasswordResetSlots(): [1 | 2 | 3, 1 | 2 | 3] {
    const slots: Array<1 | 2 | 3> = [1, 2, 3];
    const firstIndex = randomInt(slots.length);
    const [first] = slots.splice(firstIndex, 1);
    const secondIndex = randomInt(slots.length);
    const second = slots[secondIndex] ?? 2;
    return [first, second];
  }

  private normalizeResetChallengeAnswers(params: {
    answers: Array<{ slot: number; answer: string }>;
    expectedSlots: [1 | 2 | 3, 1 | 2 | 3];
  }): Map<1 | 2 | 3, string> {
    if (!Array.isArray(params.answers)) {
      throw new BadRequestException('answers must be an array');
    }
    if (params.answers.length !== PASSWORD_RECOVERY_RESET_QUESTION_COUNT) {
      throw new BadRequestException(
        `answers must include exactly ${PASSWORD_RECOVERY_RESET_QUESTION_COUNT} entries`,
      );
    }

    const answerBySlot = new Map<1 | 2 | 3, string>();
    for (const [index, answerInput] of params.answers.entries()) {
      const slot =
        answerInput?.slot === 1 ||
        answerInput?.slot === 2 ||
        answerInput?.slot === 3
          ? answerInput.slot
          : null;
      if (!slot) {
        throw new BadRequestException(`answers[${index}].slot is invalid`);
      }
      if (answerBySlot.has(slot)) {
        throw new BadRequestException('answers contains duplicate slots');
      }

      const normalizedAnswer = this.normalizeRecoveryAnswer(
        `${answerInput?.answer ?? ''}`,
      );
      if (normalizedAnswer.length < MIN_RECOVERY_ANSWER_LENGTH) {
        throw new BadRequestException(
          `answers[${index}].answer must be at least ${MIN_RECOVERY_ANSWER_LENGTH} chars`,
        );
      }
      answerBySlot.set(slot, normalizedAnswer);
    }

    const expectedSlotSet = new Set(params.expectedSlots);
    if (
      answerBySlot.size !== PASSWORD_RECOVERY_RESET_QUESTION_COUNT ||
      Array.from(answerBySlot.keys()).some((slot) => !expectedSlotSet.has(slot))
    ) {
      throw new BadRequestException('answers do not match the challenge');
    }

    return answerBySlot;
  }

  private async passwordResetAnswersMatch(params: {
    recovery: UserRecoveryRecord;
    normalizedAnswers: Map<1 | 2 | 3, string>;
    slots: [1 | 2 | 3, 1 | 2 | 3];
  }): Promise<boolean> {
    const [slotA, slotB] = params.slots;
    const answerA = params.normalizedAnswers.get(slotA);
    const answerB = params.normalizedAnswers.get(slotB);
    if (!answerA || !answerB) return false;

    const [matchA, matchB] = await Promise.all([
      verifyPassword(
        this.getRecoveryAnswerHashForSlot(params.recovery, slotA),
        answerA,
      ),
      verifyPassword(
        this.getRecoveryAnswerHashForSlot(params.recovery, slotB),
        answerB,
      ),
    ]);
    return matchA.ok && matchB.ok;
  }

  private buildPasswordResetAttemptKey(
    username: string,
    ip: string | null,
  ): string {
    return `${username.trim().toLowerCase()}|${(ip ?? '').trim().toLowerCase() || 'unknown'}`;
  }

  private cleanupPasswordResetAttempts(now: number): void {
    for (const [key, state] of this.passwordResetAttempts.entries()) {
      const lockExpired = state.lockUntilMs <= now;
      const windowExpired =
        now - state.lastFailureAtMs > this.passwordResetWindowMs;
      if (lockExpired && windowExpired) this.passwordResetAttempts.delete(key);
    }
  }

  private assessPasswordResetAttempts(params: {
    username: string;
    ip: string | null;
  }): PasswordResetAttemptAssessment {
    const now = Date.now();
    this.cleanupPasswordResetAttempts(now);
    const key = this.buildPasswordResetAttemptKey(params.username, params.ip);
    const state = this.passwordResetAttempts.get(key);
    if (!state) {
      return {
        allowed: true,
        attemptsRemaining: this.passwordResetMaxFailures,
        retryAfterSeconds: null,
        retryAt: null,
      };
    }

    if (state.lockUntilMs > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.lockUntilMs - now) / 1000),
      );
      return {
        allowed: false,
        attemptsRemaining: 0,
        retryAfterSeconds,
        retryAt: isoFromMs(state.lockUntilMs),
      };
    }

    if (state.lockUntilMs > 0 && state.lockUntilMs <= now) {
      this.passwordResetAttempts.delete(key);
      return {
        allowed: true,
        attemptsRemaining: this.passwordResetMaxFailures,
        retryAfterSeconds: null,
        retryAt: null,
      };
    }

    const attemptsRemaining = Math.max(
      0,
      this.passwordResetMaxFailures - state.failures,
    );
    return {
      allowed: true,
      attemptsRemaining,
      retryAfterSeconds: null,
      retryAt: null,
    };
  }

  private recordPasswordResetFailure(params: {
    username: string;
    ip: string | null;
  }): PasswordResetAttemptAssessment {
    const now = Date.now();
    this.cleanupPasswordResetAttempts(now);

    const key = this.buildPasswordResetAttemptKey(params.username, params.ip);
    const existing = this.passwordResetAttempts.get(key);
    const canReuseState =
      existing && (existing.lockUntilMs <= now || existing.lockUntilMs === 0);
    const previousFailures = canReuseState ? existing.failures : 0;
    const failures = previousFailures + 1;

    if (failures >= this.passwordResetMaxFailures) {
      const lockUntilMs = now + this.passwordResetLockMs;
      this.passwordResetAttempts.set(key, {
        failures: 0,
        lockUntilMs,
        lastFailureAtMs: now,
      });
      return {
        allowed: false,
        attemptsRemaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((lockUntilMs - now) / 1000)),
        retryAt: isoFromMs(lockUntilMs),
      };
    }

    this.passwordResetAttempts.set(key, {
      failures,
      lockUntilMs: 0,
      lastFailureAtMs: now,
    });
    return {
      allowed: true,
      attemptsRemaining: this.passwordResetMaxFailures - failures,
      retryAfterSeconds: null,
      retryAt: null,
    };
  }

  private clearPasswordResetFailures(params: {
    username: string;
    ip: string | null;
  }): void {
    const key = this.buildPasswordResetAttemptKey(params.username, params.ip);
    this.passwordResetAttempts.delete(key);
  }

  private assertPasswordResetAllowed(
    assessment: PasswordResetAttemptAssessment,
  ): void {
    if (assessment.allowed) return;
    throw this.tooManyPasswordResetAttemptsFailure(assessment);
  }

  private tooManyPasswordResetAttemptsFailure(
    assessment: PasswordResetAttemptAssessment,
  ): HttpException {
    return new HttpException(
      {
        message: 'Too many password reset attempts. Try again in 15 minutes.',
        retryAfterSeconds: assessment.retryAfterSeconds,
        retryAt: assessment.retryAt,
      },
      429,
    );
  }

  private passwordResetFailure(params: {
    username: string;
    ip: string | null;
    userAgent: string | null;
    reason: string;
  }): UnauthorizedException | HttpException {
    const assessment = this.recordPasswordResetFailure({
      username: params.username,
      ip: params.ip,
    });
    this.logger.warn(
      `auth: password reset failed username=${JSON.stringify(maskUsername(params.username))} ip=${JSON.stringify(maskIp(params.ip))} reason=${JSON.stringify(params.reason)} attemptsRemaining=${assessment.attemptsRemaining} retryAt=${JSON.stringify(assessment.retryAt)}`,
    );
    if (!assessment.allowed) {
      return this.tooManyPasswordResetAttemptsFailure(assessment);
    }

    const attemptsWord =
      assessment.attemptsRemaining === 1 ? 'attempt' : 'attempts';
    return new UnauthorizedException({
      message: `Security answers did not match. You have ${assessment.attemptsRemaining} more ${attemptsWord}.`,
      attemptsRemaining: assessment.attemptsRemaining,
    });
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
    this.assertValidNewPassword(newPassword);
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

  private async findUserForAuth(
    username: string,
  ): Promise<AuthLookupUser | null> {
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

    const fallback = await this.prisma.$queryRaw<
      Array<AuthLookupUser>
    >`SELECT "id", "username", "passwordHash", "tokenVersion", "passwordProofSalt", "passwordProofIterations", "passwordProofKeyEnc" FROM "User" WHERE "username" = ${username} COLLATE NOCASE LIMIT 1`;

    return fallback[0] ?? null;
  }

  private assertNotLocked(assessment: ThrottleAssessment): void {
    if (assessment.allowed) return;
    throw new HttpException(
      {
        message: 'Too many authentication attempts',
        retryAfterSeconds: assessment.retryAfterSeconds,
        retryAt: assessment.retryAt,
        captchaRequired: assessment.captchaRequired,
      },
      429,
    );
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
      `auth captcha required username=${JSON.stringify(maskUsername(params.username))} ip=${JSON.stringify(maskIp(params.ip))}`,
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
