import { randomBytes } from 'node:crypto';

// Generate a 32-byte master key suitable for APP_MASTER_KEY.
// Output format: base64 (recommended).

const key = randomBytes(32);
process.stdout.write(`${key.toString('base64')}\n`);

