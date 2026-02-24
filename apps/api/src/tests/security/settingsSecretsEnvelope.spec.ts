import { BadRequestException } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';

describe('security/settings secrets envelope transport', () => {
  const originalAllowPlaintext = process.env.SECRETS_TRANSPORT_ALLOW_PLAINTEXT;

  afterEach(() => {
    process.env.SECRETS_TRANSPORT_ALLOW_PLAINTEXT = originalAllowPlaintext;
  });

  function makeService() {
    const prisma = {
      userSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      userSecrets: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      jobSchedule: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const crypto = {
      encryptString: jest.fn((raw: string) => `enc:${raw}`),
      decryptString: jest.fn(),
      isEncrypted: jest.fn().mockReturnValue(false),
      signDetached: jest.fn().mockReturnValue('sig'),
      verifyDetached: jest.fn().mockReturnValue(true),
    };

    const credentialEnvelope = {
      getEnvelopeKey: jest.fn().mockReturnValue({
        algorithm: 'RSA-OAEP-256+A256GCM',
        keyId: 'k1',
        publicKeyPem: 'pem',
        ephemeral: true,
      }),
      decryptPayload: jest.fn(),
    };

    const service = new SettingsService(
      prisma as never,
      crypto as never,
      credentialEnvelope as never,
    );

    return { service, prisma, crypto, credentialEnvelope };
  }

  it('accepts encrypted secrets envelope and persists encrypted-at-rest patch', async () => {
    delete process.env.SECRETS_TRANSPORT_ALLOW_PLAINTEXT;
    const { service, prisma, credentialEnvelope, crypto } = makeService();
    credentialEnvelope.decryptPayload.mockReturnValue({
      secrets: {
        tmdb: { apiKey: 'tmdb-secret' },
      },
    });

    await service.updateSecretsFromEnvelope('u1', { ciphertext: 'x' });

    expect(credentialEnvelope.decryptPayload).toHaveBeenCalledWith(
      { ciphertext: 'x' },
      expect.objectContaining({
        expectedPurpose: 'settings.secrets',
        requireTimestamp: true,
        requireNonce: true,
      }),
    );
    expect(crypto.encryptString).toHaveBeenCalledWith(
      JSON.stringify({ tmdb: { apiKey: 'tmdb-secret' } }),
    );
    expect(prisma.userSecrets.upsert).toHaveBeenCalled();
  });

  it('rejects plaintext transport in strict mode by default', () => {
    delete process.env.SECRETS_TRANSPORT_ALLOW_PLAINTEXT;
    const { service } = makeService();
    expect(() => service.assertPlaintextSecretTransportAllowed()).toThrow(
      BadRequestException,
    );
  });

  it('allows plaintext transport only with explicit env override', () => {
    process.env.SECRETS_TRANSPORT_ALLOW_PLAINTEXT = 'true';
    const { service } = makeService();
    expect(() => service.assertPlaintextSecretTransportAllowed()).not.toThrow();
  });
});
