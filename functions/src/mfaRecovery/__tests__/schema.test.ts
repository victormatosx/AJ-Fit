import { describe, expect, it } from 'vitest';

import { RECOVERY_DIGEST_ALGORITHM, RECOVERY_DIGEST_BYTES } from '../digest';
import {
  FORBIDDEN_PLAINTEXT_FIELDS,
  MFA_RECOVERY_COLLECTION,
  RECOVERY_SCHEMA_VERSION,
  type RecoveryCodeRecord,
  type RecoverySetDocument,
  assertValidRecoverySet,
  validateRecoverySet,
} from '../schema';

const CREATED_AT = new Date('2026-08-19T10:00:00Z');

/** Distinct, structurally valid digests. No real code is involved. */
function digest(seed: number): string {
  return Buffer.alloc(RECOVERY_DIGEST_BYTES, seed).toString('base64');
}

function availableCode(index: number): RecoveryCodeRecord {
  return {
    id: `code-${index}`,
    digest: digest(index),
    state: 'available',
    createdAt: CREATED_AT,
    reservedAt: null,
    consumedAt: null,
    operationId: null,
  };
}

function validSet(overrides: Partial<RecoverySetDocument> = {}): RecoverySetDocument {
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    recoverySetId: '2W7K9XQF3MTB',
    uid: 'user-123',
    version: 1,
    pepperVersion: 1,
    digestVersion: 1,
    digestAlgorithm: RECOVERY_DIGEST_ALGORITHM,
    status: 'active',
    createdAt: CREATED_AT,
    rotatedAt: null,
    codes: [availableCode(1), availableCode(2), availableCode(3)],
    rateLimit: {
      attempts: 0,
      windowStartedAt: null,
      lastAttemptAt: null,
      blockedUntil: null,
    },
    activeOperation: null,
    ...overrides,
  };
}

describe('recovery set schema — happy path', () => {
  it('accepts a well-formed set', () => {
    expect(validateRecoverySet(validSet())).toEqual([]);
    expect(() => assertValidRecoverySet(validSet())).not.toThrow();
  });

  it('targets a top-level, backend-only collection outside users/{uid}', () => {
    expect(MFA_RECOVERY_COLLECTION).toBe('_mfaRecovery');
    expect(MFA_RECOVERY_COLLECTION).not.toContain('users');
    expect(MFA_RECOVERY_COLLECTION).not.toContain('/');
  });
});

describe('recovery set schema — no plaintext, structurally', () => {
  it('names the forbidden plaintext fields explicitly', () => {
    for (const field of ['code', 'plaintext', 'plainCode', 'rawCode', 'recoveryCode', 'secret']) {
      expect(FORBIDDEN_PLAINTEXT_FIELDS).toContain(field);
    }
  });

  it('has no field on the persistable types capable of holding a plaintext code', () => {
    const setFields = Object.keys(validSet());
    const codeFields = Object.keys(availableCode(1));

    for (const forbidden of FORBIDDEN_PLAINTEXT_FIELDS) {
      expect(setFields).not.toContain(forbidden);
      expect(codeFields).not.toContain(forbidden);
    }
  });

  it.each(FORBIDDEN_PLAINTEXT_FIELDS)('rejects a set carrying a %s field', (field) => {
    const problems = validateRecoverySet({ ...validSet(), [field]: 'AJF-2W7K-9XQF' });

    expect(problems.some((problem) => problem.includes('forbidden plaintext field'))).toBe(true);
  });

  it.each(FORBIDDEN_PLAINTEXT_FIELDS)('rejects a code record carrying a %s field', (field) => {
    const problems = validateRecoverySet(
      validSet({ codes: [{ ...availableCode(1), [field]: 'AJF-2W7K-9XQF' }] }),
    );

    expect(problems.some((problem) => problem.includes('forbidden plaintext field'))).toBe(true);
  });

  it('rejects any unexpected field, so no plaintext can be smuggled under a new name', () => {
    expect(validateRecoverySet({ ...validSet(), somethingNew: 'x' })).toContain(
      'recoverySet: unexpected field: somethingNew',
    );
  });
});

describe('recovery set schema — closed schema', () => {
  it.each([
    'schemaVersion',
    'recoverySetId',
    'uid',
    'version',
    'pepperVersion',
    'digestVersion',
    'digestAlgorithm',
    'status',
    'createdAt',
    'rotatedAt',
    'codes',
    'rateLimit',
    'activeOperation',
  ])('requires %s', (field) => {
    const candidate = validSet() as unknown as Record<string, unknown>;
    delete candidate[field];

    expect(validateRecoverySet(candidate)).toContain(
      `recoverySet: missing required field: ${field}`,
    );
  });

  it('rejects non-objects', () => {
    for (const candidate of [null, undefined, 'x', 42, []]) {
      expect(validateRecoverySet(candidate)).toEqual(['document must be an object']);
    }
  });

  it('pins the digest algorithm and version', () => {
    expect(validateRecoverySet(validSet({ digestAlgorithm: 'SHA-256' as never }))).toContain(
      `digestAlgorithm must be ${RECOVERY_DIGEST_ALGORITHM}`,
    );
    expect(validateRecoverySet(validSet({ digestVersion: 2 }))).toContain(
      'digestVersion must be 1',
    );
  });

  it('rejects an unknown status', () => {
    expect(
      validateRecoverySet(validSet({ status: 'revoked' as never })).some((problem) =>
        problem.startsWith('status must be one of'),
      ),
    ).toBe(true);
  });

  it('requires a malformed digest to be rejected', () => {
    const problems = validateRecoverySet(
      validSet({ codes: [{ ...availableCode(1), digest: 'not-a-digest' }] }),
    );

    expect(problems).toContain('codes[0].digest must be a base64 HMAC-SHA-256 digest');
  });

  it('never echoes a field value in a problem message', () => {
    const problems = validateRecoverySet({
      ...validSet(),
      uid: '',
      recoverySetId: '',
      code: 'AJF-SUPER-SECRET-VALUE',
    });

    for (const problem of problems) {
      expect(problem).not.toContain('SUPER-SECRET-VALUE');
    }
  });
});

describe('recovery set schema — code uniqueness', () => {
  it('rejects duplicate code ids', () => {
    expect(
      validateRecoverySet(validSet({ codes: [availableCode(1), availableCode(1)] })),
    ).toContain('codes must have unique ids');
  });

  it('rejects duplicate digests', () => {
    // Two codes unlocked by one plaintext would quietly halve the set.
    const duplicate = { ...availableCode(2), digest: digest(1) };

    expect(validateRecoverySet(validSet({ codes: [availableCode(1), duplicate] }))).toContain(
      'codes must have unique digests',
    );
  });

  it('rejects an empty codes array', () => {
    expect(validateRecoverySet(validSet({ codes: [] }))).toContain(
      'codes must be a non-empty array',
    );
  });
});

describe('recovery set schema — state and evidence must agree', () => {
  it('rejects an available code that references an operation', () => {
    const problems = validateRecoverySet(
      validSet({ codes: [{ ...availableCode(1), operationId: 'op-1' }] }),
    );

    expect(problems).toContain('codes[0]: available code must not reference an operation');
  });

  it('rejects an available code carrying timestamps', () => {
    const problems = validateRecoverySet(
      validSet({ codes: [{ ...availableCode(1), reservedAt: CREATED_AT }] }),
    );

    expect(problems).toContain(
      'codes[0]: available code must not carry reserve/consume timestamps',
    );
  });

  it('rejects a reserved code with no operation or no timestamp', () => {
    const problems = validateRecoverySet(
      validSet({
        codes: [{ ...availableCode(1), state: 'reserved' }],
      }),
    );

    expect(problems).toContain('codes[0]: reserved code must reference an operation');
    expect(problems).toContain('codes[0]: reserved code must carry reservedAt');
  });

  it('accepts a properly reserved code', () => {
    const problems = validateRecoverySet(
      validSet({
        codes: [
          {
            ...availableCode(1),
            state: 'reserved',
            reservedAt: CREATED_AT,
            operationId: 'op-1',
          },
          availableCode(2),
        ],
        activeOperation: {
          operationId: 'op-1',
          state: 'reserved',
          codeId: 'code-1',
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          internalCode: null,
        },
      }),
    );

    expect(problems).toEqual([]);
  });

  it('requires a consumed code to retain the full audit trail', () => {
    const problems = validateRecoverySet(
      validSet({
        codes: [{ ...availableCode(1), state: 'consumed', operationId: 'op-1' }, availableCode(2)],
      }),
    );

    expect(problems).toContain('codes[0]: consumed code must retain reservedAt');
    expect(problems).toContain('codes[0]: consumed code must carry consumedAt');
  });
});

describe('recovery set schema — status cannot drift from the codes', () => {
  const consumedCode = (index: number): RecoveryCodeRecord => ({
    ...availableCode(index),
    state: 'consumed',
    reservedAt: CREATED_AT,
    consumedAt: CREATED_AT,
    operationId: `op-${index}`,
  });

  it('rejects an active set whose codes are all consumed', () => {
    expect(
      validateRecoverySet(validSet({ status: 'active', codes: [consumedCode(1)] })),
    ).toContain('active set cannot have every code consumed');
  });

  it('rejects an exhausted set that still has an available code', () => {
    expect(
      validateRecoverySet(
        validSet({ status: 'exhausted', codes: [consumedCode(1), availableCode(2)] }),
      ),
    ).toContain('exhausted set must have every code consumed');
  });

  it('accepts a genuinely exhausted set', () => {
    expect(
      validateRecoverySet(
        validSet({ status: 'exhausted', codes: [consumedCode(1), consumedCode(2)] }),
      ),
    ).toEqual([]);
  });
});

describe('recovery set schema — rate limit contract', () => {
  it('accepts a populated window', () => {
    expect(
      validateRecoverySet(
        validSet({
          rateLimit: {
            attempts: 3,
            windowStartedAt: CREATED_AT,
            lastAttemptAt: CREATED_AT,
            blockedUntil: new Date('2026-08-19T10:15:00Z'),
          },
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a negative or fractional attempt count', () => {
    for (const attempts of [-1, 1.5]) {
      expect(
        validateRecoverySet(
          validSet({
            rateLimit: {
              attempts,
              windowStartedAt: null,
              lastAttemptAt: null,
              blockedUntil: null,
            },
          }),
        ),
      ).toContain('rateLimit.attempts must be an integer >= 0');
    }
  });

  it('rejects an unexpected rate limit field', () => {
    expect(
      validateRecoverySet(
        validSet({
          rateLimit: {
            attempts: 0,
            windowStartedAt: null,
            lastAttemptAt: null,
            blockedUntil: null,
            ip: '203.0.113.1',
          } as never,
        }),
      ),
    ).toContain('rateLimit: unexpected field: ip');
  });
});

describe('recovery set schema — assert variant', () => {
  it('throws with an aggregated, value-free message', () => {
    expect(() => assertValidRecoverySet({ uid: 'x' })).toThrow(/Invalid recovery set/);
  });
});
