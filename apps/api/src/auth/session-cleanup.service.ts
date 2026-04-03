import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  private static readonly INTERVAL_MS = 3_600_000; // hourly

  constructor(private readonly prisma: PrismaService) {}

  @Interval(SessionCleanupService.INTERVAL_MS)
  async purgeExpiredSessions() {
    try {
      const { count } = await this.prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.log(`Purged ${count} expired session(s)`);
      }
    } catch (err) {
      this.logger.warn(
        `Session cleanup failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
