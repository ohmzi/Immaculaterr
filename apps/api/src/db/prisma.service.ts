import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    await this.applySqlitePragmas();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async applySqlitePragmas() {
    const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
    if (!databaseUrl.startsWith('file:')) return;

    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode=WAL');
      await this.$queryRawUnsafe('PRAGMA busy_timeout=10000');
    } catch (error) {
      this.logger.warn(
        `SQLite pragmas not applied: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
