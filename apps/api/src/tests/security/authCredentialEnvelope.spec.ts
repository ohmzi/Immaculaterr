import {
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  constants as cryptoConstants,
} from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { CredentialEnvelopeService } from '../../auth/credential-envelope.service';

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/(=+)$/g, '');
}

function makeEnvelope(params: {
  publicKeyPem: string;
  keyId: string;
  username: string;
  password: string;
}) {
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const payload = Buffer.from(
    JSON.stringify({
      username: params.username,
      password: params.password,
      timestampMs: Date.now(),
      nonce: randomBytes(16).toString('base64url'),
    }),
    'utf8',
  );

  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  const encryptedKey = publicEncrypt(
    {
      key: createPublicKey(params.publicKeyPem),
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey,
  );

  return {
    algorithm: 'RSA-OAEP-256+A256GCM',
    keyId: params.keyId,
    encryptedKey: toBase64Url(encryptedKey),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
    tag: toBase64Url(tag),
  };
}

describe('security/auth credential envelope', () => {
  const originalPrivateKey = process.env.AUTH_CREDENTIALS_PRIVATE_KEY;

  afterEach(() => {
    process.env.AUTH_CREDENTIALS_PRIVATE_KEY = originalPrivateKey;
  });

  it('decrypts valid credential envelopes', () => {
    delete process.env.AUTH_CREDENTIALS_PRIVATE_KEY;
    const service = new CredentialEnvelopeService();
    const key = service.getLoginKey();

    const envelope = makeEnvelope({
      publicKeyPem: key.publicKeyPem,
      keyId: key.keyId,
      username: 'admin',
      password: 'super-secret',
    });

    const creds = service.decryptEnvelope(envelope);
    expect(creds).toEqual({ username: 'admin', password: 'super-secret' });
  });

  it('rejects wrong key id', () => {
    delete process.env.AUTH_CREDENTIALS_PRIVATE_KEY;
    const service = new CredentialEnvelopeService();
    const key = service.getLoginKey();

    const envelope = makeEnvelope({
      publicKeyPem: key.publicKeyPem,
      keyId: 'wrong-key-id',
      username: 'admin',
      password: 'secret',
    });

    expect(() => service.decryptEnvelope(envelope)).toThrow(
      BadRequestException,
    );
  });
});
