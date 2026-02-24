import { BadRequestException } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';

describe('security/secretRef contracts', () => {
  function makeService(initialSecret: string) {
    let currentSecret = initialSecret;

    const prisma = {
      userSettings: {
        findUnique: jest.fn().mockResolvedValue({ value: '{}' }),
      },
      userSecrets: {
        findUnique: jest.fn(async () => ({
          value: JSON.stringify({
            radarr: { apiKey: currentSecret },
          }),
        })),
        upsert: jest.fn(),
      },
      jobSchedule: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const crypto = {
      encryptString: jest.fn(),
      decryptString: jest.fn((raw: string) => raw),
      isEncrypted: jest.fn().mockReturnValue(false),
      signDetached: jest.fn((payload: string) =>
        Buffer.from(payload, 'utf8').toString('base64url'),
      ),
      verifyDetached: jest.fn((payload: string, signature: string) => {
        return signature === Buffer.from(payload, 'utf8').toString('base64url');
      }),
    };

    const credentialEnvelope = {
      getEnvelopeKey: jest.fn(),
      decryptPayload: jest.fn(),
    };

    const service = new SettingsService(
      prisma as never,
      crypto as never,
      credentialEnvelope as never,
    );

    return {
      service,
      setSecret(next: string) {
        currentSecret = next;
      },
    };
  }

  it('emits secretRefs and rotates them when underlying secret changes', async () => {
    const { service, setSecret } = makeService('radarr-v1');
    const first = await service.getPublicSettings('u1');
    const refV1 = first.secretRefs.radarr;

    expect(typeof refV1).toBe('string');
    expect(refV1.length).toBeGreaterThan(20);

    setSecret('radarr-v2');
    const second = await service.getPublicSettings('u1');
    const refV2 = second.secretRefs.radarr;

    expect(refV2).not.toBe(refV1);
  });

  it('resolves valid secretRefs and rejects stale/forged refs', async () => {
    const { service, setSecret } = makeService('radarr-v1');
    const publicSettings = await service.getPublicSettings('u1');
    const validRef = publicSettings.secretRefs.radarr;

    await expect(
      service.resolveServiceSecretRef({
        userId: 'u1',
        service: 'radarr',
        secretRef: validRef,
      }),
    ).resolves.toBe('radarr-v1');

    setSecret('radarr-v2');
    await expect(
      service.resolveServiceSecretRef({
        userId: 'u1',
        service: 'radarr',
        secretRef: validRef,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const forgedRef = `${validRef}x`;
    await expect(
      service.resolveServiceSecretRef({
        userId: 'u1',
        service: 'radarr',
        secretRef: forgedRef,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
