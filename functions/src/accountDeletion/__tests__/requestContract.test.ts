import { describe, expect, it } from 'vitest';

import { ForbiddenClientFieldError, rejectClientSuppliedIdentityOrPolicy } from '../requestContract';

describe('rejectClientSuppliedIdentityOrPolicy', () => {
  it('accepts an empty payload', () => {
    expect(() => rejectClientSuppliedIdentityOrPolicy({})).not.toThrow();
  });

  it('accepts null/non-object payloads without throwing (nothing to police)', () => {
    expect(() => rejectClientSuppliedIdentityOrPolicy(null)).not.toThrow();
    expect(() => rejectClientSuppliedIdentityOrPolicy(undefined)).not.toThrow();
    expect(() => rejectClientSuppliedIdentityOrPolicy('not-an-object')).not.toThrow();
  });

  it('rejects a client-supplied uid — the client must never choose whose account is deleted', () => {
    expect(() => rejectClientSuppliedIdentityOrPolicy({ uid: 'someone-elses-uid' })).toThrow(
      ForbiddenClientFieldError,
    );
  });

  it('rejects a client-supplied retention policy — support/couponRedemptions/revenueCat are never client choices', () => {
    expect(() =>
      rejectClientSuppliedIdentityOrPolicy({ retentionPolicy: { couponRedemptions: 'DELETE' } }),
    ).toThrow(ForbiddenClientFieldError);
    expect(() => rejectClientSuppliedIdentityOrPolicy({ policy: {} })).toThrow(ForbiddenClientFieldError);
  });

  it('rejects a client-supplied workflowVersion — the server always resolves CURRENT_WORKFLOW_VERSION itself', () => {
    expect(() => rejectClientSuppliedIdentityOrPolicy({ workflowVersion: 1 })).toThrow(
      ForbiddenClientFieldError,
    );
  });

  it('rejects a client-supplied deletionId — the server mints this, never the client', () => {
    expect(() => rejectClientSuppliedIdentityOrPolicy({ deletionId: 'del-fake' })).toThrow(
      ForbiddenClientFieldError,
    );
  });
});
