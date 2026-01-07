import { Injectable } from '@nestjs/common';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import type { HealthResponseDto } from './app.dto';
import { PrismaService } from './db/prisma.service';

export type ReadinessCheck =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

export type ReadinessResponse = {
  status: 'ready' | 'not_ready';
  time: string;
  checks: {
    db: ReadinessCheck;
    dataDir: ReadinessCheck;
  };
};

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth(): HealthResponseDto {
    return {
      status: 'ok' as const,
      time: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const time = new Date().toISOString();

    const checks: ReadinessResponse['checks'] = {
      db: { ok: true },
      dataDir: { ok: true },
    };

    try {
      // Works for SQLite/Postgres/MySQL etc. via Prisma.
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = { ok: true };
    } catch (err) {
      checks.db = {
        ok: false,
        error: (err as Error)?.message ?? String(err),
      };
    }

    const dataDir = process.env.APP_DATA_DIR?.trim();
    if (!dataDir) {
      checks.dataDir = { ok: false, error: 'APP_DATA_DIR is not set' };
    } else {
      try {
        const s = await stat(dataDir);
        if (!s.isDirectory()) {
          checks.dataDir = { ok: false, error: 'APP_DATA_DIR is not a directory' };
        } else {
          // To create files we need write + execute (search) on the directory.
          await access(dataDir, fsConstants.W_OK | fsConstants.X_OK);
          checks.dataDir = { ok: true };
        }
      } catch (err) {
        checks.dataDir = {
          ok: false,
          error: (err as Error)?.message ?? String(err),
        };
      }
    }

    const status =
      checks.db.ok && checks.dataDir.ok ? ('ready' as const) : ('not_ready' as const);

    return { status, time, checks };
  }
}
