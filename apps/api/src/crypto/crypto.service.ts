import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ENCRYPTED_PREFIX = 'enc:v1:';
const SECRET_FINGERPRINT_PREFIX = 'secret-fp.v1:';
const SECRET_FINGERPRINT_ITERATIONS = 120_000;
const SECRET_FINGERPRINT_BYTES = 32;

function decodeMasterKey(input: string): Buffer {
  const raw = input.trim();
  if (!raw) throw new Error('Empty master key');

  // hex (64 chars => 32 bytes)
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  // base64 (32 bytes)
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'APP_MASTER_KEY must decode to 32 bytes (base64) or be a 64-char hex string.',
    );
  }
  return buf;
}

@Injectable()
export class CryptoService implements OnModuleInit {
  private masterKey!: Buffer;
  private secretFingerprintSalt!: Buffer;

  async onModuleInit() {
    this.masterKey = await this.loadOrCreateMasterKey();
    this.secretFingerprintSalt = Buffer.concat([
      Buffer.from(SECRET_FINGERPRINT_PREFIX, 'utf8'),
      this.masterKey,
    ]);
  }

  encryptString(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return (
      ENCRYPTED_PREFIX +
      [
        iv.toString('base64'),
        tag.toString('base64'),
        ciphertext.toString('base64'),
      ].join(':')
    );
  }

  decryptString(payload: string): string {
    if (!payload.startsWith(ENCRYPTED_PREFIX)) {
      throw new Error('Unsupported encrypted payload format');
    }

    const parts = payload.slice(ENCRYPTED_PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }

    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX);
  }

  signDetached(payload: string): string {
    return createHmac('sha256', this.masterKey)
      .update(payload, 'utf8')
      .digest('base64url');
  }

  verifyDetached(payload: string, signature: string): boolean {
    const normalized = signature.trim();
    if (!normalized) return false;
    const expected = this.signDetached(payload);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(normalized, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  deriveSecretFingerprint(secret: string): string {
    return pbkdf2Sync(
      secret,
      this.secretFingerprintSalt,
      SECRET_FINGERPRINT_ITERATIONS,
      SECRET_FINGERPRINT_BYTES,
      'sha256',
    ).toString('base64url');
  }

  private async loadOrCreateMasterKey(): Promise<Buffer> {
    const envKey = process.env.APP_MASTER_KEY?.trim();
    if (envKey) {
      return decodeMasterKey(envKey);
    }

    const envKeyFile = process.env.APP_MASTER_KEY_FILE?.trim();
    if (envKeyFile) {
      try {
        const raw = await readFile(envKeyFile, 'utf8');
        return decodeMasterKey(raw);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        throw new Error(`Failed to read APP_MASTER_KEY_FILE (${envKeyFile}): ${msg}`);
      }
    }

    const dataDir = process.env.APP_DATA_DIR?.trim();
    if (!dataDir) {
      throw new Error(
        'APP_DATA_DIR must be set before CryptoService initializes.',
      );
    }

    const keyPath = join(dataDir, 'app-master.key');
    try {
      const existing = await readFile(keyPath, 'utf8');
      // Best-effort: keep the key file locked down (owner read/write only).
      await chmod(keyPath, 0o600).catch(() => undefined);
      return decodeMasterKey(existing);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code && code !== 'ENOENT') {
        throw err;
      }
    }

    const key = randomBytes(32);
    const keyB64 = key.toString('base64');
    await writeFile(keyPath, keyB64, { encoding: 'utf8', mode: 0o600 });
    // Ensure permissions even if umask interferes
    await chmod(keyPath, 0o600).catch(() => undefined);

    return key;
  }
}
