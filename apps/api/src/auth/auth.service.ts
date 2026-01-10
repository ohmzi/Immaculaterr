import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import type { Request } from 'express';
import argon2 from 'argon2';
import { PrismaService } from '../db/prisma.service';
import type { AuthUser } from './auth.types';

const SESSION_COOKIE = 'tcp_session';

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  getSessionCookieName() {
    return SESSION_COOKIE;
  }

  readSessionIdFromRequest(req: Request): string | null {
    const cookieName = this.getSessionCookieName();
    const cookies = (req as unknown as { cookies?: unknown }).cookies;
    if (!cookies || typeof cookies !== 'object') return null;
    const v = (cookies as Record<string, unknown>)[cookieName];
    return typeof v === 'string' && v.trim() ? v : null;
  }

  async hasAnyUser(): Promise<boolean> {
    const count = await this.prisma.user.count();
    return count > 0;
  }

  async registerAdmin(params: { username: string; password: string }) {
    const { username, password } = params;
    const normalized = username.trim();
    if (!normalized) throw new BadRequestException('username is required');
    if (normalized.length < 3)
      throw new BadRequestException('username must be at least 3 chars');
    if (!password || password.length < 10) {
      throw new BadRequestException('password must be at least 10 chars');
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: normalized },
    });
    if (existing) throw new BadRequestException('username already exists');

    const any = await this.hasAnyUser();
    if (any) {
      // Single-admin for now; we can extend later.
      throw new BadRequestException('admin already exists');
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.create({
      data: {
        username: normalized,
        passwordHash,
      },
      select: { id: true, username: true },
    });

    // Initialize empty settings/secrets rows (per-user)
    // Default posture: all automation OFF until the admin explicitly enables it in Task Manager.
    const defaultUserSettings = {
      onboarding: { completed: false },
      jobs: {
        // Webhook/polling-triggered jobs (Auto-Run toggles)
        webhookEnabled: {
          watchedMovieRecommendations: false,
          immaculateTastePoints: false,
          mediaAddedCleanup: false,
        },
      },
    };
    await this.prisma.userSettings.create({
      data: {
        userId: user.id,
        value: JSON.stringify(defaultUserSettings),
      },
    });
    await this.prisma.userSecrets.create({
      data: { userId: user.id, value: '' },
    });

    // Safety: if schedules exist (e.g. seeded by a previous version), disable them for a fresh admin.
    // Scheduled jobs are global (not per-user), and we don't want surprise auto-runs on first setup.
    await this.prisma.jobSchedule.updateMany({ data: { enabled: false } });

    this.logger.log(`Created admin user=${user.username}`);
    return user;
  }

  async login(params: { username: string; password: string }) {
    const { username, password } = params;
    const normalized = username.trim();
    if (!normalized || !password)
      throw new UnauthorizedException('Invalid credentials');

    const user =
      (await this.prisma.user.findUnique({
        where: { username: normalized },
      })) ??
      // SQLite: case-insensitive fallback for username (so "Admin" == "admin").
      (
        await this.prisma.$queryRaw<
          Array<{ id: string; username: string; passwordHash: string }>
        >`SELECT "id", "username", "passwordHash" FROM "User" WHERE "username" = ${normalized} COLLATE NOCASE LIMIT 1`
      )[0];
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const sessionId = this.createSessionId();
    await this.prisma.session.create({
      data: { id: sha256Hex(sessionId), userId: user.id },
    });

    return {
      sessionId,
      user: { id: user.id, username: user.username } satisfies AuthUser,
    };
  }

  async logout(sessionId: string) {
    const hashed = sha256Hex(sessionId);
    await this.prisma.session
      .delete({ where: { id: hashed } })
      .catch(() => undefined);
  }

  async getUserForSession(sessionId: string): Promise<AuthUser | null> {
    const hashed = sha256Hex(sessionId);
    const session = await this.prisma.session.findUnique({
      where: { id: hashed },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!session) return null;

    // Touch session
    await this.prisma.session
      .update({ where: { id: hashed }, data: {} })
      .catch(() => undefined);

    return session.user;
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
    // Order matters due to FK constraints
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

  private createSessionId() {
    return randomBytes(32).toString('base64url');
  }
}
