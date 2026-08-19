import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({ name, value: () => '' }),
}));

import { RECOVERY_PEPPER_MIN_BYTES, computeRecoveryCodeDigest } from '../digest';
import { RecoveryError } from '../errors';
import {
  CURRENT_RECOVERY_PEPPER_VERSION,
  MFA_RECOVERY_PEPPER,
  decodeRecoveryPepper,
  readRecoveryPepper,
} from '../pepper';

const VALID_PEPPER = randomBytes(RECOVERY_PEPPER_MIN_BYTES).toString('base64');

describe('pepper binding', () => {
  it('binds the expected Secret Manager name', () => {
    expect((MFA_RECOVERY_PEPPER as unknown as { name: string }).name).toBe(
      'MFA_RECOVERY_PEPPER',
    );
  });

  it('pins the current pepper version at 1', () => {
    expect(CURRENT_RECOVERY_PEPPER_VERSION).toBe(1);
  });
});

describe('pepper decoding', () => {
  it('accepts a base64 value of at least 32 bytes', () => {
    const pepper = decodeRecoveryPepper(VALID_PEPPER);

    expect(pepper).toBeInstanceOf(Uint8Array);
    expect(pepper.length).toBeGreaterThanOrEqual(RECOVERY_PEPPER_MIN_BYTES);
  });

  it('produces a key the digest layer accepts', () => {
    const pepper = decodeRecoveryPepper(VALID_PEPPER);
    const code = 'AJF2W7K9XQF3MTBGHJKMNPQRSTVWXYZ0123456789AB';

    expect(() => computeRecoveryCodeDigest(code, pepper)).not.toThrow();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['not base64', 'this is not base64!!'],
    ['too short', Buffer.alloc(RECOVERY_PEPPER_MIN_BYTES - 1).toString('base64')],
    ['single byte', Buffer.alloc(1).toString('base64')],
  ])('fails closed on %s', (_label, value) => {
    expect(() => decodeRecoveryPepper(value as string | undefined)).toThrow(RecoveryError);
  });

  it('reports PEPPER_UNAVAILABLE without describing the key', () => {
    try {
      decodeRecoveryPepper('short');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as RecoveryError).internalCode).toBe('PEPPER_UNAVAILABLE');
      expect((err as Error).message).toBe('PEPPER_UNAVAILABLE');
    }
  });

  it('fails closed when the secret has not been provisioned', () => {
    // The mocked binding resolves to '' — exactly what an unprovisioned
    // secret looks like at runtime. Generation must not proceed.
    expect(() => readRecoveryPepper()).toThrow(RecoveryError);
  });
});
