import { SettingsService } from '../../settings/settings.service';

function createCryptoMock() {
  const encode = (raw: string) => Buffer.from(raw, 'utf8').toString('base64');
  const decode = (raw: string) => Buffer.from(raw, 'base64').toString('utf8');

  return {
    encryptString: jest.fn((value: string) => `enc:v1:${encode(value)}`),
    decryptString: jest.fn((value: string) => {
      if (!value.startsWith('enc:v1:')) {
        throw new Error('not encrypted');
      }
      return decode(value.slice('enc:v1:'.length));
    }),
    isEncrypted: jest.fn((value: string) => value.startsWith('enc:v1:')),
  };
}

function createPrismaMock() {
  let secretsValue: string | null = null;
  let settingsValue: string | null = null;

  return {
    prisma: {
      userSettings: {
        findUnique: jest.fn(async () => {
          if (!settingsValue) return null;
          return { value: settingsValue };
        }),
        upsert: jest.fn(async (args: { update: { value: string }; create: { value: string } }) => {
          settingsValue = args.update.value || args.create.value;
          return { value: settingsValue };
        }),
      },
      userSecrets: {
        findUnique: jest.fn(async () => {
          if (!secretsValue) return null;
          return { value: secretsValue };
        }),
        upsert: jest.fn(async (args: { update: { value: string }; create: { value: string } }) => {
          secretsValue = args.update.value || args.create.value;
          return { value: secretsValue };
        }),
      },
    },
    readStoredSecretsValue() {
      return secretsValue;
    },
  };
}

describe('security/field encryption at rest', () => {
  it('stores user secrets encrypted and returns decrypted internal secrets', async () => {
    const crypto = createCryptoMock();
    const { prisma, readStoredSecretsValue } = createPrismaMock();
    const service = new SettingsService(prisma as never, crypto as never);

    const publicSecretPresence = await service.updateSecrets('u1', {
      radarr: { apiKey: 'super-secret-key' },
      sonarr: { apiKey: 'another-secret-key' },
    });
    expect(publicSecretPresence).toEqual({ radarr: true, sonarr: true });

    const stored = readStoredSecretsValue();
    expect(typeof stored).toBe('string');
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('super-secret-key');
    expect(stored).not.toContain('another-secret-key');

    const internal = await service.getInternalSettings('u1');
    expect(internal.secrets).toEqual({
      radarr: { apiKey: 'super-secret-key' },
      sonarr: { apiKey: 'another-secret-key' },
    });
  });
});
