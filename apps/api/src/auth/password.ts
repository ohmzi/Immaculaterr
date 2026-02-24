import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

const ARGON2_MEMORY_COST = Number.parseInt(
  process.env.AUTH_ARGON2_MEMORY_COST ?? `${2 ** 16}`,
  10,
);
const ARGON2_TIME_COST = Number.parseInt(
  process.env.AUTH_ARGON2_TIME_COST ?? '3',
  10,
);
const ARGON2_PARALLELISM = Number.parseInt(
  process.env.AUTH_ARGON2_PARALLELISM ?? '1',
  10,
);

const PBKDF2_DIGEST = 'sha256';
const PBKDF2_KEY_LEN = 32;

export type PasswordVerificationResult = {
  ok: boolean;
  legacy: boolean;
  needsRehash: boolean;
};

function toPositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getArgon2Options() {
  return {
    type: argon2.argon2id,
    memoryCost: toPositiveInt(ARGON2_MEMORY_COST, 2 ** 16),
    timeCost: toPositiveInt(ARGON2_TIME_COST, 3),
    parallelism: toPositiveInt(ARGON2_PARALLELISM, 1),
  } satisfies argon2.Options & { raw?: false | undefined };
}

export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, getArgon2Options());
}

function parseLegacyPbkdf2Hash(hash: string): {
  iterations: number;
  salt: Buffer;
  digest: Buffer;
} | null {
  const parts = splitLegacyPbkdf2Hash(hash);
  if (!parts) return null;
  const iterations = parseLegacyIterationsSafe(parts.iterationsRaw);
  if (!iterations) return null;
  const decoded = decodeLegacyPbkdf2Parts(parts.saltB64, parts.digestB64);
  if (!decoded) return null;
  return { iterations, salt: decoded.salt, digest: decoded.digest };
}

function splitLegacyPbkdf2Hash(hash: string): {
  iterationsRaw: string;
  saltB64: string;
  digestB64: string;
} | null {
  // Format: pbkdf2$sha256$<iterations>$<saltB64>$<digestB64>
  const [kind, digestName, iterationsRaw, saltB64, digestB64, ...rest] =
    hash.split('$');
  if (rest.length > 0) return null;
  if (kind !== 'pbkdf2' || digestName !== PBKDF2_DIGEST) return null;
  if (!iterationsRaw || !saltB64 || !digestB64) return null;
  return { iterationsRaw, saltB64, digestB64 };
}

function parseLegacyIterations(raw: string): number {
  const iterations = Number.parseInt(raw, 10);
  if (!Number.isFinite(iterations) || iterations < 10_000) {
    throw new Error('legacy pbkdf2 iterations are invalid');
  }
  return iterations;
}

function parseLegacyIterationsSafe(raw: string): number | null {
  try {
    return parseLegacyIterations(raw);
  } catch {
    return null;
  }
}

function decodeLegacyPbkdf2Parts(
  saltB64: string,
  digestB64: string,
): { salt: Buffer; digest: Buffer } | null {
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const digest = Buffer.from(digestB64, 'base64');
    if (salt.length < 16 || digest.length !== PBKDF2_KEY_LEN) return null;
    return { salt, digest };
  } catch {
    return null;
  }
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<PasswordVerificationResult> {
  if (hash.startsWith('$argon2')) {
    const ok = await argon2.verify(hash, password);
    const needsRehash = ok
      ? argon2.needsRehash(hash, getArgon2Options())
      : false;
    return { ok, legacy: false, needsRehash };
  }

  const parsed = parseLegacyPbkdf2Hash(hash);
  if (!parsed) return { ok: false, legacy: false, needsRehash: false };

  const actual = pbkdf2Sync(
    password,
    parsed.salt,
    parsed.iterations,
    PBKDF2_KEY_LEN,
    PBKDF2_DIGEST,
  );
  const ok =
    actual.length === parsed.digest.length &&
    timingSafeEqual(actual, parsed.digest);
  return { ok, legacy: true, needsRehash: ok };
}

export function createPasswordProofMaterial(password: string): {
  saltB64: string;
  iterations: number;
  keyB64: string;
} {
  const iterations = toPositiveInt(
    Number.parseInt(process.env.AUTH_PASSWORD_PROOF_ITERATIONS ?? '210000', 10),
    210_000,
  );
  const salt = randomBytes(16);
  const key = pbkdf2Sync(
    password,
    salt,
    iterations,
    PBKDF2_KEY_LEN,
    PBKDF2_DIGEST,
  );
  return {
    saltB64: salt.toString('base64'),
    iterations,
    keyB64: key.toString('base64'),
  };
}

export function derivePasswordProofKey(params: {
  password: string;
  saltB64: string;
  iterations: number;
}): string {
  const key = pbkdf2Sync(
    params.password,
    Buffer.from(params.saltB64, 'base64'),
    params.iterations,
    PBKDF2_KEY_LEN,
    PBKDF2_DIGEST,
  );
  return key.toString('base64');
}
