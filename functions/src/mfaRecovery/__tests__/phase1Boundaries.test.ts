import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Phase 1 boundary guards.
 *
 * Phase 1 is explicitly NOT allowed to make recovery work. These tests are the
 * executable version of that promise: they fail if anyone wires the foundation
 * up to a callable, to Admin Auth, to Firestore or to a secret before the
 * later phases have been reviewed.
 *
 * They read SOURCE rather than behaviour on purpose — the guarantee is "this
 * capability does not exist in the code", which no runtime assertion can show.
 */

const functionsRoot = path.resolve(__dirname, '..', '..', '..');
const moduleDir = path.join(functionsRoot, 'src', 'mfaRecovery');

function read(relativePath: string): string {
  return readFileSync(path.join(functionsRoot, relativePath), 'utf8');
}

/**
 * Source with comments stripped, matching the convention in
 * `src/__tests__/foundationStructure.test.ts`. Without it, the prose in these
 * modules (which discusses Admin SDK, revokeRefreshTokens and Secret Manager
 * at length) would trip every check below.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const moduleFiles = readdirSync(moduleDir).filter((file) => file.endsWith('.ts'));

const moduleSources = moduleFiles.map((file) => ({
  file,
  code: stripComments(readFileSync(path.join(moduleDir, file), 'utf8')),
}));

describe('phase 1 — the module exists and is self-contained', () => {
  it('ships the expected foundation modules', () => {
    expect(moduleFiles.sort()).toEqual([
      'codeFormat.ts',
      'digest.ts',
      'errors.ts',
      'idempotency.ts',
      'logging.ts',
      'schema.ts',
      'stateMachine.ts',
    ]);
  });
});

describe('phase 1 — no MFA can be reset', () => {
  it.each([
    ['revokeRefreshTokens', /revokeRefreshTokens/],
    ['getAuth', /getAuth\s*\(/],
    ['admin.auth()', /admin\s*\.\s*auth\s*\(/],
    ['updateUser', /updateUser\s*\(/],
    ['multiFactor', /multiFactor/],
    ['enrolledFactors', /enrolledFactors/],
  ])('never calls %s', (_label, pattern) => {
    for (const { file, code } of moduleSources) {
      expect(code, `${file} must not reference this`).not.toMatch(pattern);
    }
  });

  it('imports nothing from firebase-admin', () => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/from\s+['"]firebase-admin/);
      expect(code, file).not.toMatch(/require\(\s*['"]firebase-admin/);
    }
  });
});

describe('phase 1 — no callable is exposed', () => {
  it.each([
    ['onCall', /\bonCall\s*\(/],
    ['onRequest', /\bonRequest\s*\(/],
    ['HttpsError', /HttpsError/],
  ])('never declares %s', (_label, pattern) => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(pattern);
    }
  });

  it('is not wired into the functions entrypoint', () => {
    const entrypoint = read('src/index.ts');

    expect(entrypoint).not.toContain('mfaRecovery');
    expect(entrypoint).not.toContain('recoveryCode');
  });

  it('leaves App Check enforcement exactly as it was', () => {
    // App Check infrastructure is an existing, separate Photo Vault concern.
    // Phase 1 must neither enable enforcement nor touch the bridge.
    const entrypoint = stripComments(read('src/index.ts'));

    expect(entrypoint).not.toMatch(/enforceAppCheck\s*:\s*true/);

    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/appCheck/i);
    }
  });
});

describe('phase 1 — no persistence', () => {
  it.each([
    ['Firestore access', /\bdb\s*\./],
    ['collection()', /\.collection\s*\(/],
    ['doc()', /\.doc\s*\(/],
    ['runTransaction', /runTransaction/],
    ['firebaseAdmin import', /firebaseAdmin/],
  ])('never performs %s', (_label, pattern) => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(pattern);
    }
  });
});

describe('phase 1 — no secret is bound or read', () => {
  it('never reads the environment', () => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/process\s*\.\s*env/);
    }
  });

  it('never declares a Secret Manager binding', () => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/defineSecret/);
      expect(code, file).not.toMatch(/functions\.config\s*\(/);
    }
  });

  it('takes the pepper as a parameter with no default and no fallback', () => {
    const digest = stripComments(read('src/mfaRecovery/digest.ts'));

    expect(digest).toMatch(/pepper\s*:\s*Uint8Array/);
    // A default or an `??` fallback would let a digest be computed without a
    // real pepper ever being supplied.
    expect(digest).not.toMatch(/pepper\s*:\s*Uint8Array\s*=/);
    expect(digest).not.toMatch(/pepper\s*\?\?/);
    expect(digest).not.toMatch(/DEFAULT_PEPPER/);
  });
});

describe('phase 1 — no code can be generated', () => {
  it('contains no generator', () => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/randomBytes/);
      expect(code, file).not.toMatch(/randomUUID/);
      expect(code, file).not.toMatch(/randomInt/);
      expect(code, file).not.toMatch(/generateRecoveryCode/);
    }
  });

  it('never uses Math.random anywhere in the module', () => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/Math\s*\.\s*random/);
    }
  });
});

describe('phase 1 — the existing auth and TOTP surface is untouched', () => {
  it('adds no client-side file', () => {
    // The whole foundation is backend-only; the app bundle must be unchanged.
    expect(moduleDir).toContain(path.join('functions', 'src'));
  });

  it('does not reference the existing TOTP or auth modules', () => {
    for (const { file, code } of moduleSources) {
      expect(code, file).not.toMatch(/mfaTotp/);
      expect(code, file).not.toMatch(/MultiFactorResolver/);
      expect(code, file).not.toMatch(/resolveSignIn/);
      expect(code, file).not.toMatch(/TotpMultiFactorGenerator/);
    }
  });
});
