import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  type KeyObject,
  constants as cryptoConstants,
} from 'node:crypto';

type CredentialEnvelope = {
  algorithm?: unknown;
  keyId?: unknown;
  encryptedKey?: unknown;
  iv?: unknown;
  ciphertext?: unknown;
  tag?: unknown;
};

type DecryptedCredentials = {
  username: string;
  password: string;
};

type EnvelopePayload = {
  username?: unknown;
  password?: unknown;
  timestampMs?: unknown;
  nonce?: unknown;
};

function parseEnvPrivateKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('AUTH_CREDENTIALS_PRIVATE_KEY is empty');

  const text = trimmed.includes('BEGIN')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  return createPrivateKey(text);
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function readEncodedField(input: unknown, field: string): Buffer {
  if (typeof input !== 'string' || !input.trim()) {
    throw new BadRequestException(`credentialEnvelope.${field} is required`);
  }
  try {
    return fromBase64Url(input.trim());
  } catch {
    throw new BadRequestException(`credentialEnvelope.${field} is invalid`);
  }
}

@Injectable()
export class CredentialEnvelopeService {
  private readonly logger = new Logger(CredentialEnvelopeService.name);
  private readonly privateKey: KeyObject;
  private readonly publicKeyPem: string;
  private readonly keyId: string;
  private readonly ephemeral: boolean;
  private readonly maxSkewMs = Number.parseInt(
    process.env.AUTH_CREDENTIAL_ENVELOPE_MAX_SKEW_MS ?? `${5 * 60_000}`,
    10,
  );

  constructor() {
    const raw = process.env.AUTH_CREDENTIALS_PRIVATE_KEY?.trim();
    if (raw) {
      this.privateKey = parseEnvPrivateKey(raw);
      const publicKey = createPublicKey(this.privateKey);
      const pubDer = publicKey.export({ type: 'spki', format: 'der' });
      this.publicKeyPem = publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString();
      this.keyId = toBase64Url(
        createHash('sha256').update(pubDer).digest(),
      ).slice(0, 24);
      this.ephemeral = false;
      return;
    }

    const generated = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicExponent: 0x10001,
    });
    this.privateKey = generated.privateKey;
    const pubDer = generated.publicKey.export({ type: 'spki', format: 'der' });
    const keyId = toBase64Url(
      createHash('sha256').update(pubDer).digest(),
    ).slice(0, 24);
    this.publicKeyPem = generated.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    this.keyId = keyId;
    this.ephemeral = true;
    this.logger.warn(
      'AUTH_CREDENTIALS_PRIVATE_KEY is unset; using ephemeral credential envelope key (not stable across restarts/instances).',
    );
  }

  getLoginKey() {
    return {
      algorithm: 'RSA-OAEP-256+A256GCM',
      keyId: this.keyId,
      publicKeyPem: this.publicKeyPem,
      ephemeral: this.ephemeral,
    } as const;
  }

  decryptEnvelope(envelope: CredentialEnvelope): DecryptedCredentials {
    const algorithm =
      typeof envelope.algorithm === 'string' ? envelope.algorithm.trim() : '';
    if (algorithm && algorithm !== 'RSA-OAEP-256+A256GCM') {
      throw new BadRequestException(
        'Unsupported credential envelope algorithm',
      );
    }

    const keyId =
      typeof envelope.keyId === 'string' ? envelope.keyId.trim() : '';
    if (keyId && keyId !== this.keyId) {
      throw new BadRequestException('Credential envelope key mismatch');
    }

    const encryptedKey = readEncodedField(
      envelope.encryptedKey,
      'encryptedKey',
    );
    const iv = readEncodedField(envelope.iv, 'iv');
    const ciphertext = readEncodedField(envelope.ciphertext, 'ciphertext');
    const tag = readEncodedField(envelope.tag, 'tag');

    if (iv.length !== 12) {
      throw new BadRequestException('credentialEnvelope.iv must be 12 bytes');
    }
    if (tag.length !== 16) {
      throw new BadRequestException('credentialEnvelope.tag must be 16 bytes');
    }

    let aesKey: Buffer;
    try {
      aesKey = privateDecrypt(
        {
          key: this.privateKey,
          padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        encryptedKey,
      );
    } catch {
      throw new BadRequestException(
        'credentialEnvelope.encryptedKey could not be decrypted',
      );
    }

    if (aesKey.length !== 32) {
      throw new BadRequestException(
        'credentialEnvelope.encryptedKey decrypted to invalid key',
      );
    }

    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
    } catch {
      throw new BadRequestException(
        'credentialEnvelope ciphertext could not be decrypted',
      );
    }

    let payload: EnvelopePayload;
    try {
      payload = JSON.parse(plaintext.toString('utf8')) as EnvelopePayload;
    } catch {
      throw new BadRequestException(
        'credentialEnvelope payload is not valid JSON',
      );
    }

    const username =
      typeof payload.username === 'string' ? payload.username : '';
    const password =
      typeof payload.password === 'string' ? payload.password : '';
    if (!username.trim() || !password) {
      throw new BadRequestException(
        'credentialEnvelope payload must include username and password',
      );
    }

    if (payload.timestampMs !== undefined) {
      const timestampMs =
        typeof payload.timestampMs === 'number'
          ? payload.timestampMs
          : typeof payload.timestampMs === 'string'
            ? Number.parseInt(payload.timestampMs, 10)
            : NaN;
      if (!Number.isFinite(timestampMs)) {
        throw new BadRequestException(
          'credentialEnvelope timestamp is invalid',
        );
      }
      const skewMs = Math.abs(Date.now() - timestampMs);
      if (skewMs > this.maxSkewMs) {
        throw new BadRequestException(
          'credentialEnvelope is too old or from the future',
        );
      }
    }

    if (payload.nonce !== undefined) {
      const nonce =
        typeof payload.nonce === 'string' ? payload.nonce.trim() : '';
      if (!nonce) {
        throw new BadRequestException('credentialEnvelope nonce is invalid');
      }
    }

    return { username, password };
  }
}
