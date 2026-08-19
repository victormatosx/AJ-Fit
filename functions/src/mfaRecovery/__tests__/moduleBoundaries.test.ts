import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural boundary guards for the MFA recovery module.
 *
 * Renamed from `phase1Boundaries.test.ts`: Phase 1 banned Firestore, secrets,
 * callables and randomness from the whole module because none of it existed
 * yet. Phase 2 deliberately introduces all four, so a blanket ban would now be
 * meaningless. The guards are therefore split by responsibility instead of by
 * phase:
 *
 *   - the PURE DOMAIN modules must STAY pure, so the contracts stay testable
 *     without an emulator and cannot quietly grow I/O;
 *   - the whole module, including the new Phase 2 code, must never acquire
 *     the ability to modify a second factor or a session.
 *
 * These read SOURCE rather than behaviour on purpose: the guarantee is "this
 * capability does not exist in the code", which no runtime assertion shows.
 */

const functionsRoot = path.resolve(__dirname, '..', '..', '..');
const moduleDir = path.join(functionsRoot, 'src', 'mfaRecovery');

function read(relativePath: string): string {
  return readFileSync(path.join(functionsRoot, relativePath), 'utf8');
}

/**
 * Source with comments stripped, matching the convention in
 * `src/__tests__/foundationStructure.test.ts`. Without it the prose in these
 * modules — which discusses Admin SDK, revokeRefreshTokens and Secret Manager
 * at length — would trip every check below.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const moduleFiles = readdirSync(moduleDir).filter((file) => file.endsWith('.ts'));

function sourcesOf(files: readonly string[]) {
  return files.map((file) => ({
    file,
    code: stripComments(readFileSync(path.join(moduleDir, file), 'utf8')),
  }));
}

/** Contracts and pure logic. No I/O, no framework, no randomness. */
const PURE_DOMAIN_FILES = [
  'codeFormat.ts',
  'digest.ts',
  'errors.ts',
  'idempotency.ts',
  'schema.ts',
  'stateMachine.ts',
] as const;

const allSources = sourcesOf(moduleFiles);
const pureSources = sourcesOf(PURE_DOMAIN_FILES);

describe('module inventory', () => {
  it('ships the expected modules', () => {
    expect(moduleFiles.sort()).toEqual([
      'codeFormat.ts',
      'codeGenerator.ts',
      'digest.ts',
      'errors.ts',
      'generateRecoveryCodes.ts',
      'idempotency.ts',
      'logging.ts',
      'pepper.ts',
      'recoverySetRepository.ts',
      'schema.ts',
      'stateMachine.ts',
    ]);
  });
});

describe('no MFA or session can be modified, anywhere in the module', () => {
  it.each([
    ['revokeRefreshTokens', /revokeRefreshTokens/],
    ['updateUser', /updateUser\s*\(/],
    ['deleteUser', /deleteUser\s*\(/],
    ['setCustomUserClaims', /setCustomUserClaims/],
    ['createCustomToken', /createCustomToken/],
    ['unenroll', /unenroll/],
    ['resolveSignIn', /resolveSignIn/],
    ['MultiFactorResolver', /MultiFactorResolver/],
    ['TotpMultiFactorGenerator', /TotpMultiFactorGenerator/],
  ])('never calls %s', (_label, pattern) => {
    for (const { file, code } of allSources) {
      expect(code, `${file} must not reference this`).not.toMatch(pattern);
    }
  });

  it('touches Admin Auth only to READ the caller, and only in one file', () => {
    const callers = allSources.filter(({ code }) => /\bauth\s*\.\s*\w+\s*\(/.test(code));

    expect(callers.map(({ file }) => file)).toEqual(['generateRecoveryCodes.ts']);

    // The single permitted Admin Auth call is getUser — a read.
    const [{ code }] = callers;
    const calls = [...code.matchAll(/\bauth\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1]);
    expect([...new Set(calls)]).toEqual(['getUser']);
  });

  it('reads enrolled factors without writing them', () => {
    const code = stripComments(read('src/mfaRecovery/generateRecoveryCodes.ts'));

    expect(code).toMatch(/enrolledFactors/);
    expect(code).not.toMatch(/multiFactor\s*[:=]/);
    expect(code).not.toMatch(/enrolledFactors\s*[:=][^=]/);
  });
});

describe('client input is never trusted for identity', () => {
  it('never reads uid, email or a set id from the request payload', () => {
    for (const { file, code } of allSources) {
      expect(code, file).not.toMatch(/request\s*\.\s*data/);
      expect(code, file).not.toMatch(/data\s*\.\s*uid/);
      expect(code, file).not.toMatch(/data\s*\.\s*email/);
      expect(code, file).not.toMatch(/data\s*\.\s*recoverySetId/);
    }
  });

  it('derives the uid only from the verified token helper', () => {
    const code = stripComments(read('src/mfaRecovery/generateRecoveryCodes.ts'));

    expect(code).toMatch(/requireRecentAuth\s*\(\s*request/);
  });
});

describe('randomness is cryptographic only', () => {
  it('never uses Math.random anywhere in the module', () => {
    for (const { file, code } of allSources) {
      expect(code, file).not.toMatch(/Math\s*\.\s*random/);
    }
  });

  it('draws entropy only from node:crypto randomBytes, in the generator', () => {
    const generators = allSources.filter(({ code }) => /randomBytes/.test(code));

    expect(generators.map(({ file }) => file)).toEqual(['codeGenerator.ts']);
    expect(stripComments(read('src/mfaRecovery/codeGenerator.ts'))).toMatch(
      /from\s+['"]node:crypto['"]/,
    );
  });

  it('never derives a code from a uuid, a timestamp or the uid', () => {
    const code = stripComments(read('src/mfaRecovery/codeGenerator.ts'));

    expect(code).not.toMatch(/randomUUID/);
    expect(code).not.toMatch(/Date\s*\.\s*now/);
    expect(code).not.toMatch(/\buid\b/);
  });
});

describe('the pure domain stays pure', () => {
  it.each([
    ['Firestore access', /\bdb\s*\./],
    ['firebase-admin', /firebase-admin/],
    ['firebase-functions', /firebase-functions/],
    ['onCall', /\bonCall\s*\(/],
    ['HttpsError', /HttpsError/],
    ['defineSecret', /defineSecret/],
    ['randomBytes', /randomBytes/],
    ['process.env', /process\s*\.\s*env/],
  ])('keeps %s out of the contract modules', (_label, pattern) => {
    for (const { file, code } of pureSources) {
      expect(code, `${file} must remain pure`).not.toMatch(pattern);
    }
  });
});

describe('the pepper is never hardcoded or read from the environment', () => {
  it('never reads the environment', () => {
    for (const { file, code } of allSources) {
      expect(code, file).not.toMatch(/process\s*\.\s*env/);
    }
  });

  it('declares exactly one Secret Manager binding, in pepper.ts', () => {
    const binders = allSources.filter(({ code }) => /defineSecret/.test(code));

    expect(binders.map(({ file }) => file)).toEqual(['pepper.ts']);
    expect(binders[0].code).toMatch(/defineSecret\(\s*['"]MFA_RECOVERY_PEPPER['"]\s*\)/);
  });

  it('carries no default, fallback or literal pepper value', () => {
    const code = stripComments(read('src/mfaRecovery/pepper.ts'));

    expect(code).not.toMatch(/DEFAULT_PEPPER/);
    expect(code).not.toMatch(/pepper\s*\?\?/);
    // A base64 literal long enough to be a 32-byte key would be a smuggled secret.
    expect(code).not.toMatch(/['"][A-Za-z0-9+/]{40,}={0,2}['"]/);
  });

  it('takes the pepper as a parameter in the digest layer', () => {
    const digest = stripComments(read('src/mfaRecovery/digest.ts'));

    expect(digest).toMatch(/pepper\s*:\s*Uint8Array/);
    expect(digest).not.toMatch(/pepper\s*:\s*Uint8Array\s*=/);
  });
});

describe('no plaintext recovery code can be persisted or logged', () => {
  it('persists a digest for each code and never the code itself', () => {
    const code = stripComments(read('src/mfaRecovery/generateRecoveryCodes.ts'));

    expect(code).toMatch(/digest\s*:\s*computeRecoveryCodeDigest/);
    // The record literal must not carry the plaintext under any name.
    expect(code).not.toMatch(/\b(plaintext|plainCode|rawCode|recoveryCode)\s*:/);
  });

  it('never passes a code, digest, selector, uid or email to a logger', () => {
    for (const { file, code } of allSources) {
      const logCalls = [...code.matchAll(/log\w*\(([\s\S]*?)\n\s*\}?\);/g)].map((m) => m[1]);

      for (const call of logCalls) {
        expect(call, `${file}: log call must not carry identity or secrets`).not.toMatch(
          /\b(codes?|digest|selector|pepper|uid|email|secret|token)\s*[,:]/,
        );
      }
    }
  });

  it('exposes no endpoint that reads codes back', () => {
    for (const { file, code } of allSources) {
      expect(code, file).not.toMatch(/getRecoveryCodes/);
      expect(code, file).not.toMatch(/listRecoveryCodes/);
    }
  });
});

describe('backend-only: no client or entrypoint integration', () => {
  it('is not wired into the functions entrypoint', () => {
    // Exporting from index.ts is what makes a callable deployable. Phase 2
    // ships no endpoint; wiring is a Phase 3 step.
    const entrypoint = read('src/index.ts');

    expect(entrypoint).not.toContain('mfaRecovery');
    expect(entrypoint).not.toContain('generateMfaRecoveryCodes');
  });

  it('does not reference the mobile TOTP surface', () => {
    for (const { file, code } of allSources) {
      expect(code, file).not.toMatch(/mfaTotp/);
      expect(code, file).not.toMatch(/\.\.\/\.\.\/src\//);
      expect(code, file).not.toMatch(/react-native/);
    }
  });

  it('leaves App Check enforcement switched off', () => {
    for (const { file, code } of allSources) {
      expect(code, file).not.toMatch(/enforceAppCheck\s*:\s*true/);
    }

    expect(stripComments(read('src/index.ts'))).not.toMatch(/enforceAppCheck\s*:\s*true/);
  });
});
