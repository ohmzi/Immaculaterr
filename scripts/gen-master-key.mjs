import { randomBytes } from 'node:crypto';
process.stderr.write('WARNING: treat this key as a secret — do not log or share it.\n');
const key = randomBytes(32);
process.stdout.write(`${key.toString('hex')}\n`);

