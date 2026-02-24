import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type LoginChallengeRecord = {
  id: string;
  username: string;
  userId: string | null;
  saltB64: string;
  iterations: number;
  nonce: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type StoredChallengeRecord = LoginChallengeRecord & { consumed: boolean };

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

@Injectable()
export class PasswordProofService {
  private readonly challenges = new Map<string, StoredChallengeRecord>();
  private readonly challengeTtlMs = Number.parseInt(
    process.env.AUTH_PASSWORD_PROOF_CHALLENGE_TTL_MS ?? `${5 * 60_000}`,
    10,
  );

  createChallenge(params: {
    username: string;
    userId: string | null;
    saltB64: string;
    iterations: number;
  }): LoginChallengeRecord {
    const now = Date.now();
    this.cleanup(now);

    const id = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const expiresAtMs = now + this.challengeTtlMs;

    const record: StoredChallengeRecord = {
      id,
      username: params.username,
      userId: params.userId,
      saltB64: params.saltB64,
      iterations: params.iterations,
      nonce,
      createdAtMs: now,
      expiresAtMs,
      consumed: false,
    };

    this.challenges.set(id, record);
    return {
      id: record.id,
      username: record.username,
      userId: record.userId,
      saltB64: record.saltB64,
      iterations: record.iterations,
      nonce: record.nonce,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    };
  }

  consumeChallenge(challengeId: string): LoginChallengeRecord | null {
    const now = Date.now();
    this.cleanup(now);

    const rec = this.challenges.get(challengeId);
    if (!rec) return null;
    if (rec.consumed) return null;
    if (rec.expiresAtMs <= now) {
      this.challenges.delete(challengeId);
      return null;
    }

    rec.consumed = true;
    return {
      id: rec.id,
      username: rec.username,
      userId: rec.userId,
      saltB64: rec.saltB64,
      iterations: rec.iterations,
      nonce: rec.nonce,
      createdAtMs: rec.createdAtMs,
      expiresAtMs: rec.expiresAtMs,
    };
  }

  buildExpectedProof(params: {
    keyB64: string;
    challengeId: string;
    nonce: string;
  }): string {
    const key = Buffer.from(params.keyB64, 'base64');
    const message = `${params.challengeId}:${params.nonce}`;
    const digest = createHmac('sha256', key).update(message).digest();
    return toBase64Url(digest);
  }

  matches(expected: string, actual: string): boolean {
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(actual);
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  private cleanup(now: number): void {
    for (const [id, rec] of this.challenges.entries()) {
      if (rec.expiresAtMs <= now || rec.consumed) {
        this.challenges.delete(id);
      }
    }
  }
}
