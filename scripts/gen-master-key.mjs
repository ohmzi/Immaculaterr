import { randomBytes } from 'node:crypto';
const key = randomBytes(32);
process.stdout.write(`${key.toString('base64')}\n`);

