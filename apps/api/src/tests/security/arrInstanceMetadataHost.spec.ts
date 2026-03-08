import { BadRequestException } from '@nestjs/common';
import { ArrInstanceService } from '../../arr-instances/arr-instance.service';

describe('security/arr instance metadata host protection', () => {
  it('rejects cloud metadata hosts as baseUrl values', async () => {
    const prisma = {
      arrInstance: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const settingsService = {
      getInternalSettings: jest.fn(),
    };
    const crypto = {
      encryptString: jest.fn((v: string) => v),
    };
    const service = new ArrInstanceService(
      prisma as never,
      settingsService as never,
      crypto as never,
    );

    await expect(
      service.create('u1', {
        type: 'radarr',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        apiKey: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.arrInstance.findMany).not.toHaveBeenCalled();
    expect(prisma.arrInstance.create).not.toHaveBeenCalled();
  });
});
