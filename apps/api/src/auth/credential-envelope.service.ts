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

export type CredentialEnvelope = {
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
  purpose?: unknown;
  service?: unknown;
  username?: unknown;
  password?: unknown;
  timestampMs?: unknown;
  nonce?: unknown;
};

type DecryptPayloadOptions = {
  expectedPurpose?: string;
  requireTimestamp?: boolean;
  requireNonce?: boolean;
  maxSkewMs?: number;
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
  const base64 = buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return trimBase64Padding(base64);
}

function trimBase64Padding(input: string): string {
  let end = input.length;
  while (end > 0 && input[end - 1] === '=') {
    end -= 1;
  }
  return input.slice(0, end);
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

  getEnvelopeKey() {
    return this.getLoginKey();
  }

  decryptPayload(
    envelope: CredentialEnvelope,
    options?: DecryptPayloadOptions,
  ): Record<string, unknown> {
    const payload = this.decryptPayloadInternal(envelope);
    this.assertExpectedPurpose(payload, options?.expectedPurpose);
    const policy = this.resolveDecryptPolicy(options);
    this.assertTimestampPolicy(payload, policy);
    this.assertNoncePolicy(payload, policy.requireNonce);
    return payload;
  }

  decryptEnvelope(envelope: CredentialEnvelope): DecryptedCredentials {
    const payload = this.decryptPayload(envelope);

    const username =
      typeof payload.username === 'string' ? payload.username : '';
    const password =
      typeof payload.password === 'string' ? payload.password : '';
    if (!username.trim() || !password) {
      throw new BadRequestException(
        'credentialEnvelope payload must include username and password',
      );
    }

    return { username, password };
  }

  private decryptPayloadInternal(
    envelope: CredentialEnvelope,
  ): Record<string, unknown> {
    this.assertSupportedAlgorithm(envelope.algorithm);
    this.assertKnownKeyId(envelope.keyId);

    const encryptedKey = readEncodedField(
      envelope.encryptedKey,
      'encryptedKey',
    );
    const iv = readEncodedField(envelope.iv, 'iv');
    const ciphertext = readEncodedField(envelope.ciphertext, 'ciphertext');
    const tag = readEncodedField(envelope.tag, 'tag');
    this.assertGcmFieldLengths(iv, tag);

    const aesKey = this.decryptEnvelopeKey(encryptedKey);
    const plaintext = this.decryptEnvelopeCiphertext({
      aesKey,
      iv,
      tag,
      ciphertext,
    });
    return this.parseEnvelopePayload(plaintext);
  }

  private parseTimestamp(raw: unknown): number {
    const timestampMs =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseInt(raw, 10)
          : NaN;
    if (!Number.isFinite(timestampMs)) {
      throw new BadRequestException('credentialEnvelope timestamp is invalid');
    }
    return timestampMs;
  }

  private assertExpectedPurpose(
    payload: Record<string, unknown>,
    expectedPurposeRaw: unknown,
  ): void {
    const expectedPurpose =
      typeof expectedPurposeRaw === 'string' ? expectedPurposeRaw.trim() : '';
    if (!expectedPurpose) return;
    const purpose =
      typeof payload.purpose === 'string' ? payload.purpose.trim() : '';
    if (!purpose || purpose !== expectedPurpose) {
      throw new BadRequestException('credentialEnvelope purpose is invalid');
    }
  }

  private resolveDecryptPolicy(options?: DecryptPayloadOptions): {
    maxSkewMs: number;
    requireTimestamp: boolean;
    requireNonce: boolean;
  } {
    const maxSkewMs =
      typeof options?.maxSkewMs === 'number' && Number.isFinite(options.maxSkewMs)
        ? Math.max(1, Math.trunc(options.maxSkewMs))
        : this.maxSkewMs;
    return {
      maxSkewMs,
      requireTimestamp: options?.requireTimestamp === true,
      requireNonce: options?.requireNonce === true,
    };
  }

  private assertTimestampPolicy(
    payload: Record<string, unknown>,
    policy: { maxSkewMs: number; requireTimestamp: boolean },
  ): void {
    if (payload.timestampMs === undefined && !policy.requireTimestamp) return;
    const timestampMs = this.parseTimestamp(payload.timestampMs);
    const skewMs = Math.abs(Date.now() - timestampMs);
    if (skewMs > policy.maxSkewMs) {
      throw new BadRequestException(
        'credentialEnvelope is too old or from the future',
      );
    }
  }

  private assertNoncePolicy(
    payload: Record<string, unknown>,
    requireNonce: boolean,
  ): void {
    if (payload.nonce === undefined && !requireNonce) return;
    const nonce = typeof payload.nonce === 'string' ? payload.nonce.trim() : '';
    if (!nonce) {
      throw new BadRequestException('credentialEnvelope nonce is invalid');
    }
  }

  private assertSupportedAlgorithm(rawAlgorithm: unknown): void {
    const algorithm =
      typeof rawAlgorithm === 'string' ? rawAlgorithm.trim() : '';
    if (algorithm && algorithm !== 'RSA-OAEP-256+A256GCM') {
      throw new BadRequestException('Unsupported credential envelope algorithm');
    }
  }

  private assertKnownKeyId(rawKeyId: unknown): void {
    const keyId = typeof rawKeyId === 'string' ? rawKeyId.trim() : '';
    if (keyId && keyId !== this.keyId) {
      throw new BadRequestException('Credential envelope key mismatch');
    }
  }

  private assertGcmFieldLengths(iv: Buffer, tag: Buffer): void {
    if (iv.length !== 12) {
      throw new BadRequestException('credentialEnvelope.iv must be 12 bytes');
    }
    if (tag.length !== 16) {
      throw new BadRequestException('credentialEnvelope.tag must be 16 bytes');
    }
  }

  private decryptEnvelopeKey(encryptedKey: Buffer): Buffer {
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
    return aesKey;
  }

  private decryptEnvelopeCiphertext(params: {
    aesKey: Buffer;
    iv: Buffer;
    tag: Buffer;
    ciphertext: Buffer;
  }): Buffer {
    try {
      const decipher = createDecipheriv('aes-256-gcm', params.aesKey, params.iv);
      decipher.setAuthTag(params.tag);
      return Buffer.concat([
        decipher.update(params.ciphertext),
        decipher.final(),
      ]);
    } catch {
      throw new BadRequestException(
        'credentialEnvelope ciphertext could not be decrypted',
      );
    }
  }

  private parseEnvelopePayload(plaintext: Buffer): Record<string, unknown> {
    let payload: EnvelopePayload;
    try {
      payload = JSON.parse(plaintext.toString('utf8')) as EnvelopePayload;
    } catch {
      throw new BadRequestException(
        'credentialEnvelope payload is not valid JSON',
      );
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException(
        'credentialEnvelope payload must be an object',
      );
    }
    return payload as Record<string, unknown>;
  }
}
