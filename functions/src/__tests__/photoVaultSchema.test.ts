import { describe, expect, it } from 'vitest';

import {
  CURRENT_ENCRYPTION_VERSION,
  VAULT_ALGORITHM,
  assertValidPhotoVault,
  validatePhotoVault,
} from '../photoVault/schema';

function validVault(overrides: Record<string, unknown> = {}) {
  return {
    wrappedVaultKey: 'CiQAaBc...base64-ciphertext',
    encryptionVersion: CURRENT_ENCRYPTION_VERSION,
    vaultKeyVersion: 1,
    kmsKeyVersion:
      'projects/p/locations/l/keyRings/r/cryptoKeys/photo-vault/cryptoKeyVersions/1',
    algorithm: VAULT_ALGORITHM,
    createdAt: new Date('2026-08-11T12:00:00Z'),
    updatedAt: new Date('2026-08-11T12:00:00Z'),
    ...overrides,
  };
}

describe('photoVault schema — accepts a well-formed document', () => {
  it('accepts the canonical shape', () => {
    expect(validatePhotoVault(validVault())).toEqual([]);
  });

  it('accepts a rotated vault key version', () => {
    expect(validatePhotoVault(validVault({ vaultKeyVersion: 7 }))).toEqual([]);
  });
});

describe('photoVault schema — closed shape', () => {
  it('rejects an unexpected field', () => {
    expect(validatePhotoVault(validVault({ unwrappedVaultKey: 'oops' }))).toContain(
      'unexpected field: unwrappedVaultKey',
    );
  });

  it.each([
    'wrappedVaultKey',
    'encryptionVersion',
    'vaultKeyVersion',
    'kmsKeyVersion',
    'algorithm',
    'createdAt',
    'updatedAt',
  ])('rejects a missing %s', (field) => {
    const doc = validVault();
    delete (doc as Record<string, unknown>)[field];
    expect(validatePhotoVault(doc)).toContain(`missing required field: ${field}`);
  });

  it.each([null, undefined, 'string', 42, []])('rejects a non-object document: %s', (input) => {
    expect(validatePhotoVault(input)).toEqual(['document must be an object']);
  });
});

describe('photoVault schema — field validation', () => {
  it('rejects an empty wrappedVaultKey', () => {
    expect(validatePhotoVault(validVault({ wrappedVaultKey: '' }))).not.toEqual([]);
  });

  it('rejects an oversized wrappedVaultKey', () => {
    expect(validatePhotoVault(validVault({ wrappedVaultKey: 'A'.repeat(5000) }))).not.toEqual([]);
  });

  it('rejects a non-string wrappedVaultKey', () => {
    expect(validatePhotoVault(validVault({ wrappedVaultKey: 12345 }))).not.toEqual([]);
  });

  it.each([0, -1, 1.5, '1', null])('rejects encryptionVersion %s', (version) => {
    expect(validatePhotoVault(validVault({ encryptionVersion: version }))).not.toEqual([]);
  });

  it.each([0, -1, 2.5, '1', null])('rejects vaultKeyVersion %s', (version) => {
    expect(validatePhotoVault(validVault({ vaultKeyVersion: version }))).not.toEqual([]);
  });

  it.each(['AES-128-CBC', 'none', '', 'aes-256-gcm'])('rejects algorithm %s', (algorithm) => {
    expect(validatePhotoVault(validVault({ algorithm }))).toContain(
      `algorithm must be ${VAULT_ALGORITHM}`,
    );
  });

  it('rejects an empty kmsKeyVersion', () => {
    expect(validatePhotoVault(validVault({ kmsKeyVersion: '' }))).not.toEqual([]);
  });

  it.each(['createdAt', 'updatedAt'])('rejects a non-Date %s', (field) => {
    expect(validatePhotoVault(validVault({ [field]: '2026-08-11' }))).toContain(
      `${field} must be a Date`,
    );
  });
});

describe('photoVault schema — never leaks values into error messages', () => {
  it('reports field names only, never the wrapped key material', () => {
    const secret = 'SUPER-SECRET-WRAPPED-KEY-MATERIAL';
    const problems = validatePhotoVault(validVault({ wrappedVaultKey: secret, bogus: secret }));

    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem).not.toContain(secret);
    }
  });
});

describe('assertValidPhotoVault', () => {
  it('does not throw for a valid document', () => {
    expect(() => assertValidPhotoVault(validVault())).not.toThrow();
  });

  it('throws for an invalid document', () => {
    expect(() => assertValidPhotoVault(validVault({ algorithm: 'none' }))).toThrow(
      /Invalid photoVault document/,
    );
  });
});
