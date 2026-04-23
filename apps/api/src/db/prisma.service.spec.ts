import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (typeof originalDatabaseUrl === 'string') {
      process.env.DATABASE_URL = originalDatabaseUrl;
      return;
    }

    delete process.env.DATABASE_URL;
  });

  it('applies sqlite pragmas with raw queries for file databases', async () => {
    process.env.DATABASE_URL = 'file:/tmp/test.sqlite';

    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const executeRawUnsafe = jest.fn().mockResolvedValue(0);
    const warn = jest.fn();
    const service = Object.create(PrismaService.prototype) as PrismaService & {
      $executeRawUnsafe: typeof executeRawUnsafe;
      $queryRawUnsafe: typeof queryRawUnsafe;
      logger: { warn: typeof warn };
    };

    service.$queryRawUnsafe = queryRawUnsafe;
    service.$executeRawUnsafe = executeRawUnsafe;
    service.logger = { warn };

    await (
      service as unknown as {
        applySqlitePragmas: () => Promise<void>;
      }
    ).applySqlitePragmas();

    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'PRAGMA journal_mode=WAL',
    );
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      'PRAGMA busy_timeout=10000',
    );
    expect(executeRawUnsafe).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips sqlite pragmas for non-file databases', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/app';

    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const warn = jest.fn();
    const service = Object.create(PrismaService.prototype) as PrismaService & {
      $queryRawUnsafe: typeof queryRawUnsafe;
      logger: { warn: typeof warn };
    };

    service.$queryRawUnsafe = queryRawUnsafe;
    service.logger = { warn };

    await (
      service as unknown as {
        applySqlitePragmas: () => Promise<void>;
      }
    ).applySqlitePragmas();

    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
