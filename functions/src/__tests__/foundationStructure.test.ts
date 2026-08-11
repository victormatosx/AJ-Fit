import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const functionsRoot = path.resolve(__dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(functionsRoot, relativePath), 'utf8');
}

describe('Photo Vault backend foundation — Phase 3 structural guarantees', () => {
  it('never carries a service account JSON file in the repo', () => {
    // A real service account key file always has this literal marker.
    const suspects = ['src/lib/firebaseAdmin.ts', 'package.json'];

    for (const file of suspects) {
      expect(read(file)).not.toContain('"type": "service_account"');
      expect(read(file)).not.toContain('private_key');
    }
  });

  it('initializes firebase-admin with no arguments (Application Default Credentials only)', () => {
    const source = read('src/lib/firebaseAdmin.ts');

    expect(source).toContain('initializeApp()');
    expect(source).not.toMatch(/initializeApp\(\s*\{/);
    expect(source).not.toContain('credential.cert');
    expect(source).not.toContain('serviceAccount');
    expect(source).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
  });

  it('has no Cloud KMS, Vault Key or Photo Vault crypto logic yet (Phase 3 scope)', () => {
    const forbidden = [
      '@google-cloud/kms',
      'KeyManagementServiceClient',
      'CryptoKeyVersion',
      'wrappedVaultKey',
      'createVault',
      'recoverVaultKey',
      'AES-256-GCM',
    ];

    for (const file of [
      'src/index.ts',
      'src/lib/firebaseAdmin.ts',
      'src/lib/auth.ts',
      'src/lib/logger.ts',
      'src/health/backendHealth.ts',
      'package.json',
    ]) {
      const source = read(file);
      for (const token of forbidden) {
        expect(source, `${file} must not reference "${token}" in Phase 3`).not.toContain(token);
      }
    }
  });

  it('has no App Check wiring yet (Phase 3 scope)', () => {
    for (const file of ['src/index.ts', 'src/health/backendHealth.ts', 'package.json']) {
      const source = read(file);
      expect(source).not.toContain('app-check');
      expect(source).not.toContain('AppCheck');
    }
  });

  it('exports backendHealth from the entrypoint', () => {
    const source = read('src/index.ts');

    expect(source).toContain("export { backendHealth }");
  });

  it('firebase.json declares the functions codebase without touching Firestore/Storage rules config', () => {
    const firebaseJson = JSON.parse(read('../firebase.json')) as Record<string, unknown>;

    expect(firebaseJson.functions).toBeDefined();
    expect(firebaseJson.firestore).toBeDefined();
    expect(firebaseJson.storage).toBeDefined();
  });

  it('has a .firebaserc with a production alias and no implicit default project', () => {
    const rcPath = path.resolve(functionsRoot, '..', '.firebaserc');
    expect(existsSync(rcPath)).toBe(true);

    const rc = JSON.parse(readFileSync(rcPath, 'utf8')) as {
      projects?: Record<string, string>;
    };

    expect(rc.projects?.production).toBe('ajfit-2f321');
    expect(rc.projects?.default).toBeUndefined();
  });

  it('does not commit compiled output (lib/) to git-tracked source', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).toContain('lib/');
  });
});
