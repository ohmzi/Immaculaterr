import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFileBackedEnv } from '../../security/secret-source';

describe('security/secret source _FILE loader', () => {
  it('loads missing env values from *_FILE paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imm-secret-'));
    const secretPath = join(dir, 'secret.txt');
    writeFileSync(secretPath, 'super-secret\n', 'utf8');

    const env: Record<string, string | undefined> = {
      MY_SECRET_FILE: secretPath,
      MY_SECRET: undefined,
    };

    applyFileBackedEnv(env);
    expect(env.MY_SECRET).toBe('super-secret');
  });

  it('does not override explicit env values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imm-secret-'));
    const secretPath = join(dir, 'secret.txt');
    writeFileSync(secretPath, 'from-file', 'utf8');

    const env: Record<string, string | undefined> = {
      MY_SECRET_FILE: secretPath,
      MY_SECRET: 'already-set',
    };

    applyFileBackedEnv(env);
    expect(env.MY_SECRET).toBe('already-set');
  });
});
