import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  signWorkoutActionCapability,
  verifyWorkoutActionCapability,
  WORKOUT_ACTION_CAPABILITY_PURPOSE,
} from '../workoutActionCapability';

const SECRET = 'test-secret-do-not-use-in-prod';
const OTHER_SECRET = 'a-completely-different-secret';

function issue(overrides: Partial<{ uid: string; executionId: string; iat: number; exp: number }> = {}) {
  const iat = Date.now();
  return signWorkoutActionCapability({
    uid: 'alice',
    executionId: 'exec_1',
    iat,
    exp: iat + 60_000,
    ...overrides,
  }, SECRET);
}

describe('signWorkoutActionCapability / verifyWorkoutActionCapability', () => {
  it('round-trips valid claims', () => {
    const token = issue();
    const result = verifyWorkoutActionCapability(token, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.uid).toBe('alice');
      expect(result.claims.executionId).toBe('exec_1');
      expect(result.claims.purpose).toBe(WORKOUT_ACTION_CAPABILITY_PURPOSE);
      expect(result.claims.v).toBe(1);
    }
  });

  // J. Invalid/forged signature.
  it('rejects a token signed with a different secret', () => {
    const iat = Date.now();
    const token = signWorkoutActionCapability({ uid: 'alice', executionId: 'exec_1', iat, exp: iat + 60_000 }, OTHER_SECRET);
    expect(verifyWorkoutActionCapability(token, SECRET)).toEqual({ valid: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a tampered payload even if the original signature is reattached', () => {
    const token = issue();
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const tampered = { ...decoded, executionId: 'exec_someone_elses' };
    const tamperedPayload = Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url');
    const forged = `${tamperedPayload}.${signature}`;
    expect(verifyWorkoutActionCapability(forged, SECRET)).toEqual({ valid: false, reason: 'BAD_SIGNATURE' });
  });

  // I. Expired capability.
  it('rejects an expired token', () => {
    const past = Date.now() - 10_000;
    const token = issue({ iat: past - 1_000, exp: past });
    expect(verifyWorkoutActionCapability(token, SECRET)).toEqual({ valid: false, reason: 'EXPIRED' });
  });

  it('accepts a token one millisecond before expiry', () => {
    const token = issue({ iat: Date.now(), exp: Date.now() + 50 });
    expect(verifyWorkoutActionCapability(token, SECRET).valid).toBe(true);
  });

  it('rejects malformed tokens: wrong shape, missing parts, non-string, empty', () => {
    const malformed = ['', 'not-a-token', 'a.b.c', 'onlyonepart', '.', 'a.', '.b'];
    for (const value of malformed) {
      expect(verifyWorkoutActionCapability(value, SECRET).valid).toBe(false);
    }
    expect(verifyWorkoutActionCapability(undefined, SECRET).valid).toBe(false);
    expect(verifyWorkoutActionCapability(null, SECRET).valid).toBe(false);
    expect(verifyWorkoutActionCapability(12345, SECRET).valid).toBe(false);
  });

  it('rejects a payload with the wrong purpose or version, even if signed correctly', () => {
    const iat = Date.now();
    const wrongPurposePayload = Buffer.from(JSON.stringify({
      v: 1, uid: 'alice', executionId: 'exec_1', purpose: 'something_else', iat, exp: iat + 60_000,
    }), 'utf8').toString('base64url');
    const sig1 = createHmac('sha256', SECRET).update(wrongPurposePayload).digest('hex');
    expect(verifyWorkoutActionCapability(`${wrongPurposePayload}.${sig1}`, SECRET))
      .toEqual({ valid: false, reason: 'WRONG_PURPOSE' });

    const wrongVersionPayload = Buffer.from(JSON.stringify({
      v: 2, uid: 'alice', executionId: 'exec_1', purpose: 'workout_action', iat, exp: iat + 60_000,
    }), 'utf8').toString('base64url');
    const sig2 = createHmac('sha256', SECRET).update(wrongVersionPayload).digest('hex');
    expect(verifyWorkoutActionCapability(`${wrongVersionPayload}.${sig2}`, SECRET))
      .toEqual({ valid: false, reason: 'WRONG_VERSION' });
  });

  // H. A capability for execution A must never verify as valid for a
  // different execution — verification itself doesn't know about "B", but
  // this proves the executionId claim survives verification unmodified, so
  // the CALLER (externalWorkoutAction.ts) can compare it against the
  // request's own executionId.
  it('preserves the exact executionId claim so the caller can reject a mismatched request', () => {
    const token = issue({ executionId: 'exec_A' });
    const result = verifyWorkoutActionCapability(token, SECRET);
    expect(result.valid && result.claims.executionId).toBe('exec_A');
  });

  it('never leaks the secret or raw claims in a thrown error (there is no throw — it is a typed result)', () => {
    expect(() => verifyWorkoutActionCapability('garbage', SECRET)).not.toThrow();
  });
});
