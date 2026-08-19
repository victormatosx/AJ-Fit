import { describe, expect, it } from 'vitest';

import {
  deriveGoogleSubStepOutcome,
  requireGoogleRevocationReportAuthorization,
} from '../googleProviderRevocation';

describe('deriveGoogleSubStepOutcome', () => {
  it('maps "revoked" to SUCCEEDED', () => {
    expect(deriveGoogleSubStepOutcome('revoked')).toEqual({ kind: 'SUCCEEDED' });
  });

  it('maps "not-linked" to SKIPPED_BY_POLICY (defensive — should already be skipped at record creation)', () => {
    const outcome = deriveGoogleSubStepOutcome('not-linked');
    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
  });

  it('maps "failed" to a RETRYABLE outcome, matching revokeAccess’s documented real-world flakiness', () => {
    expect(deriveGoogleSubStepOutcome('failed')).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
  });
});

describe('requireGoogleRevocationReportAuthorization', () => {
  it('returns the uid from a verified auth token', () => {
    expect(requireGoogleRevocationReportAuthorization({ auth: { uid: 'alice' } } as never)).toBe('alice');
  });

  it('rejects an unauthenticated request', () => {
    expect(() => requireGoogleRevocationReportAuthorization({ auth: null } as never)).toThrow();
  });

  it('never derives identity from anything the client could supply as data', () => {
    // The function signature itself has no `data` parameter — it cannot read
    // a client-supplied uid even if one were present on a real request.
    const uid = requireGoogleRevocationReportAuthorization({
      auth: { uid: 'alice' },
    } as never);
    expect(uid).toBe('alice');
  });

  it('does NOT require recent-auth — a plain, possibly-old token is accepted (Fase 3 §"authorization" doc comment)', () => {
    // No auth_time claim at all, unlike requireRecentAuth's fixture in
    // functions/src/__tests__/auth.test.ts — requireAuth never inspects it.
    expect(requireGoogleRevocationReportAuthorization({ auth: { uid: 'alice' } } as never)).toBe(
      'alice',
    );
  });
});
