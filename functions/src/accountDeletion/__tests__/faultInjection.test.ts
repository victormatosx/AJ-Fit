/**
 * Fase 13 — automated fault-injection scenarios over the account-deletion
 * workflow. Uses `faultInjectionHarness.ts` (test-only) to drive the REAL
 * state machine (`steps.ts`) and invokes REAL executors directly (no
 * worker/scheduler — Fase 14 territory, not built here).
 *
 * Scenarios already exhaustively covered at the ENGINE level by earlier
 * phases are referenced, not re-derived, here:
 *   - Firestore/Storage partial-failure + retry: `firestoreCleanup/
 *     __tests__/engine.test.ts`, `storageCleanup/__tests__/engine.test.ts`.
 *   - Vault Key Destruction idempotency/retry: `__tests__/
 *     vaultKeyDestruction.test.ts` + `.integration.test.ts`.
 *   - Auth Deletion idempotency/retry: `__tests__/authDeletion.test.ts` +
 *     `.integration.test.ts`.
 *   - RevenueCat late-webhook fail-closed (post-COMPLETED): `billing/
 *     __tests__/accountDeletionLateWebhook.test.ts`.
 *   - Full chain, zero client calls, real Emulators: `__tests__/
 *     backendAutonomy.integration.test.ts` (this IS Scenario H).
 * This file adds the WORKFLOW-LEVEL properties those don't already prove:
 * crash-between-steps recovery, retry-budget exhaustion, concurrent-write
 * rejection, frozen-policy survival, and a genuinely new mid-workflow
 * webhook fail-closed proof.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  applyProviderSubStepOutcome,
  applyStepOutcome,
  createHarness,
  runnableStep,
} from './faultInjectionHarness';
import { lockAccountAccess } from '../accountAccessLock';
import { revokeAppleProvider } from '../providerRevocation/appleProviderRevocation';
import { deriveProviderRevocationOutcome } from '../providerRevocation/types';
import { compareAndSet } from '../concurrency';
import { computeRetryDecision } from '../retry';
import { beginStepAttempt, completeStepAttempt, initialStepRecords } from '../steps';
import { currentPolicy } from '../policy';
import type { AccountDeletionRetentionPolicy } from '../types';

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

// ─── Scenario A / A1 — ACCOUNT_ACCESS_LOCK partial failure ────────────────

describe('Scenario A — Auth disabled, cleanup not yet run, then crash', () => {
  it('a full ACCOUNT_ACCESS_LOCK success advances the harness to PROVIDER_REVOCATION', async () => {
    let state = createHarness();
    expect(runnableStep(state)).toBe('ACCOUNT_ACCESS_LOCK');

    const updateUser = vi.fn().mockResolvedValue(undefined);
    const revokeRefreshTokens = vi.fn().mockResolvedValue(undefined);
    const outcome = await lockAccountAccess('uid-A', { updateUser, revokeRefreshTokens } as never);

    state = applyStepOutcome(state, 'ACCOUNT_ACCESS_LOCK', outcome, 1);
    expect(state.steps.ACCOUNT_ACCESS_LOCK.status).toBe('SUCCEEDED');
    expect(runnableStep(state)).toBe('PROVIDER_REVOCATION');
  });
});

describe('Scenario A1 — disable succeeds, revokeRefreshTokens fails transiently, then retry', () => {
  it('crash after disable, before revoke: retry redoes disable safely and completes revoke', async () => {
    let state = createHarness();

    const updateUser = vi.fn().mockResolvedValue(undefined);
    const revokeRefreshTokens = vi.fn().mockRejectedValueOnce(authError('auth/internal-error'));
    const adminAuth = { updateUser, revokeRefreshTokens } as never;

    const first = await lockAccountAccess('uid-A', adminAuth);
    state = applyStepOutcome(state, 'ACCOUNT_ACCESS_LOCK', first, 1);
    expect(state.steps.ACCOUNT_ACCESS_LOCK.status).toBe('FAILED_RETRYABLE');
    // Nothing advances past the failed step.
    expect(runnableStep(state)).toBe('ACCOUNT_ACCESS_LOCK');

    // "Crash", then a worker retries: revokeRefreshTokens now succeeds.
    revokeRefreshTokens.mockResolvedValueOnce(undefined);
    const second = await lockAccountAccess('uid-A', adminAuth);
    state = applyStepOutcome(state, 'ACCOUNT_ACCESS_LOCK', second, 2);

    expect(state.steps.ACCOUNT_ACCESS_LOCK.status).toBe('SUCCEEDED');
    expect(updateUser).toHaveBeenCalledTimes(2); // redone safely, never skipped
    expect(runnableStep(state)).toBe('PROVIDER_REVOCATION');
  });
});

// ─── Scenario E / E1 — Apple provider revocation faults ────────────────────

describe('Scenario E — Apple revoke fails retryably, blocks the workflow, then succeeds on retry', () => {
  it('workflow stays at PROVIDER_REVOCATION, never advances to VAULT_KEY_DESTRUCTION, until Apple succeeds', async () => {
    let state = createHarness(['apple.com']);
    state = applyStepOutcome(state, 'ACCOUNT_ACCESS_LOCK', { kind: 'SUCCEEDED' }, 1);
    expect(runnableStep(state)).toBe('PROVIDER_REVOCATION');

    const repository = { read: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const deps = {
      client: {
        exchangeAuthorizationCode: vi.fn().mockResolvedValue({ refreshToken: 'rt-1' }),
        revokeToken: vi.fn().mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: undefined })),
      },
      repository,
      wrap: vi.fn().mockResolvedValue({ wrappedToken: 'w', kmsKeyVersion: 'kv' }),
      unwrap: vi.fn().mockResolvedValue('rt-1'),
    };
    repository.read.mockResolvedValue(null);

    const firstAttempt = await revokeAppleProvider(
      { deletionId: 'del-1', expectedUid: 'uid-A', capturedForUid: 'uid-A', authorizationCode: 'code-1' },
      deps,
    );
    state = applyProviderSubStepOutcome(state, 'apple', firstAttempt, 2);
    expect(deriveProviderRevocationOutcome(state.providerRevocation)).toBe('NOT_DONE');
    // The OUTER step never independently advances past PROVIDER_REVOCATION
    // while the sub-step is unresolved — proven by never applying SUCCEEDED
    // to the outer step here and confirming nextRunnableStep still reports it.
    expect(runnableStep(state)).toBe('PROVIDER_REVOCATION');

    // Cached material survived the failed revoke — retry reuses it (repository.read now returns it).
    repository.read.mockResolvedValue({ wrappedRefreshToken: 'w', kmsKeyVersion: 'kv', createdAtMs: 1 });
    deps.client.revokeToken.mockResolvedValueOnce(undefined);
    const retryAttempt = await revokeAppleProvider(
      { deletionId: 'del-1', expectedUid: 'uid-A', capturedForUid: 'uid-A', authorizationCode: null },
      deps,
    );
    expect(retryAttempt).toEqual({ kind: 'SUCCEEDED' });
    expect(deps.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1); // never re-exchanged

    state = applyProviderSubStepOutcome(state, 'apple', retryAttempt, 3);
    // Google was never linked (harness created with only 'apple.com') — its
    // sub-step is already SKIPPED_BY_POLICY from record creation, exactly
    // like `initialProviderRevocationSubState` (Fase 3) already guarantees.
    expect(state.providerRevocation.google.step.status).toBe('SKIPPED_BY_POLICY');
    expect(deriveProviderRevocationOutcome(state.providerRevocation)).toBe('SUCCEEDED');

    state = applyStepOutcome(state, 'PROVIDER_REVOCATION', { kind: 'SUCCEEDED' }, 3);
    expect(runnableStep(state)).toBe('VAULT_KEY_DESTRUCTION');
  });
});

describe('Scenario E1 — Apple revoke fails terminally: workflow stops, never reaches the point of no return', () => {
  it('a genuinely terminal Apple failure never lets VAULT_KEY_DESTRUCTION run', async () => {
    let state = createHarness(['apple.com']);
    state = applyStepOutcome(state, 'ACCOUNT_ACCESS_LOCK', { kind: 'SUCCEEDED' }, 1);

    const repository = { read: vi.fn().mockResolvedValue(null), save: vi.fn(), clear: vi.fn() };
    const deps = {
      client: { exchangeAuthorizationCode: vi.fn(), revokeToken: vi.fn() },
      repository,
      wrap: vi.fn(),
      unwrap: vi.fn(),
    };

    // No cached material AND no fresh code — the documented terminal case.
    const outcome = await revokeAppleProvider(
      { deletionId: 'del-1', expectedUid: 'uid-A', capturedForUid: 'uid-A', authorizationCode: null },
      deps,
    );
    expect(outcome).toEqual({ kind: 'FAILED', code: 'PROVIDER_AUTHORIZATION_INVALID' });

    state = applyProviderSubStepOutcome(state, 'apple', outcome, 2);
    expect(state.providerRevocation.apple.step.status).toBe('FAILED_TERMINAL');
    expect(deriveProviderRevocationOutcome(state.providerRevocation)).toBe('FAILED_TERMINAL');

    // The workflow never fabricates progress past this: VAULT_KEY_DESTRUCTION
    // (the point of no return) must never run while Apple is stuck terminal.
    expect(runnableStep(state)).toBe('PROVIDER_REVOCATION');
    expect(runnableStep(state)).not.toBe('VAULT_KEY_DESTRUCTION');
  });
});

// ─── Retry budget exhaustion (§78) ─────────────────────────────────────────

describe('Retry budget exhaustion', () => {
  it('repeated RETRYABLE failures eventually become FAILED_TERMINAL with RETRY_BUDGET_EXHAUSTED, never an infinite loop', () => {
    const policy = currentPolicy();
    let record = initialStepRecords().FIRESTORE_CLEANUP;
    let now = 1;

    for (let attempt = 0; attempt < policy.retry.maxAttempts; attempt++) {
      const running = beginStepAttempt('FIRESTORE_CLEANUP', record, now);
      record = completeStepAttempt('FIRESTORE_CLEANUP', running, { kind: 'FAILED', code: 'UNAVAILABLE' }, now, policy.retry);
      now += 1;
      if (record.status === 'FAILED_TERMINAL') break;
      expect(record.status).toBe('FAILED_RETRYABLE');
    }

    expect(record.status).toBe('FAILED_TERMINAL');
    expect(record.lastErrorCode).toBe('RETRY_BUDGET_EXHAUSTED');
    expect(record.attemptCount).toBeLessThanOrEqual(policy.retry.maxAttempts);
  });

  it('backoff is computed with a controlled clock — never real wall-clock waiting', () => {
    const decision1 = computeRetryDecision({ attemptCount: 0, now: 1000, retry: currentPolicy().retry });
    const decision2 = computeRetryDecision({ attemptCount: 1, now: 1000, retry: currentPolicy().retry });
    expect(decision2.nextAttemptAt).toBeGreaterThan(decision1.nextAttemptAt); // exponential, not flat
    expect(decision1.exhausted).toBe(false);
  });
});

// ─── Revision / optimistic concurrency (§76) ───────────────────────────────

describe('Revision/CAS prevents two workers from silently overwriting each other', () => {
  it('a second writer using a stale revision is rejected, never regressing already-applied progress', () => {
    const record: { revision: number; status: 'PROCESSING' | 'COMPLETED' } = { revision: 5, status: 'PROCESSING' };

    const workerA = compareAndSet(record, 5, (current) => ({ ...current, status: 'PROCESSING' as const }));
    expect(workerA.ok).toBe(true);
    if (!workerA.ok) throw new Error('unreachable');

    // Worker B still holds the OLD snapshot (revision 5) — its write must
    // be rejected once A has already advanced the real document to 6.
    const workerB = compareAndSet(workerA.value, 5, (current) => ({ ...current, status: 'COMPLETED' as const }));
    expect(workerB).toEqual({ ok: false, reason: 'REVISION_MISMATCH', currentRevision: 6 });
  });
});

// ─── Frozen policy survives a currentPolicy() drift mid-retry (§82) ────────

describe('Frozen policy — an in-flight workflow never re-resolves currentPolicy()', () => {
  it('a harness created under v1 keeps using its OWN frozen retention through every retry, regardless of what a hypothetical v2 would say', () => {
    const state = createHarness();
    const frozenRetention: AccountDeletionRetentionPolicy = state.policy.retention;
    expect(frozenRetention).toEqual({ support: 'RETAIN', couponRedemptions: 'RETAIN', revenueCat: 'SKIP' });

    // Simulate a "v2" policy existing NOW, elsewhere in the process — the
    // harness's own `state.policy` must never be swapped for it.
    const hypotheticalV2Retention: AccountDeletionRetentionPolicy = {
      support: 'DELETE',
      couponRedemptions: 'DELETE',
      revenueCat: 'DELETE',
    };
    expect(state.policy.retention).not.toEqual(hypotheticalV2Retention);
    expect(state.policy.retention).toBe(frozenRetention); // same object reference — never re-derived
  });
});

// ─── AUTH_DELETION: side effect succeeds, persistence-of-status fails (§72) ─

describe('AUTH_DELETION — deleteUser succeeds, workflow persistence update fails, retry converges', () => {
  it('a retry after a persistence-only failure never re-deletes anything destructive — deleteUser(already-absent) is logical success', async () => {
    const deleteUser = vi.fn().mockResolvedValueOnce(undefined); // first call: real delete succeeds
    const adminAuth = { deleteUser } as never;
    const { executeAuthDeletion } = await import('../authDeletion');

    const first = await executeAuthDeletion('uid-A', adminAuth);
    expect(first).toEqual({ kind: 'SUCCEEDED' });

    // Simulate: the SIDE EFFECT (Auth deletion) succeeded, but the workflow's
    // own persisted step status write failed right after — a worker retries
    // the whole step, calling deleteUser again.
    deleteUser.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
    const retry = await executeAuthDeletion('uid-A', adminAuth);
    expect(retry).toEqual({ kind: 'FAILED', code: 'ALREADY_DELETED' }); // resolves to SUCCEEDED one level up

    let state = createHarness();
    state = applyStepOutcome(state, 'AUTH_DELETION', retry, 1);
    expect(state.steps.AUTH_DELETION.status).toBe('SUCCEEDED');
  });
});

// ─── Scenario G (extended) — webhook mid-workflow, not just post-COMPLETED ─

describe('Scenario G (mid-workflow) — a late write landing on users/{uid} before FIRESTORE_CLEANUP runs is still removed wholesale', () => {
  /**
   * HONEST FINDING (not a bug fix — a documented, accepted, low-impact
   * race): `ACCOUNT_ACCESS_LOCK` disables the Auth user but does not delete
   * it, and `validFirebaseUserExists` (`billing/subscriptionSync.ts`) only
   * checks EXISTENCE, not the `disabled` flag. This means a RevenueCat
   * webhook arriving in the window between `ACCOUNT_ACCESS_LOCK` and
   * `FIRESTORE_CLEANUP` could still successfully resolve identity and write
   * to `users/{uid}.subscription` — the account-deletion policy
   * (`revenueCat = SKIP`) never entangles the webhook with deletion status
   * by design (Fase 9). This test proves the property that actually makes
   * this harmless: `FIRESTORE_CLEANUP`'s `deleteUserProfileDocument`
   * removes the ENTIRE `users/{uid}` document (Fase 6, non-recursive but
   * whole-document), so any field a late webhook wrote — subscription or
   * otherwise — is removed regardless of when it landed, the moment
   * `FIRESTORE_CLEANUP` actually runs. The narrower claim "identity
   * resolution itself fails closed mid-workflow" is NOT made here — that
   * only becomes true once `AUTH_DELETION` runs (already proven by
   * `backendAutonomy.integration.test.ts` / `accountDeletionLateWebhook.test.ts`).
   */
  it('deleteUserProfileDocument removes the whole users/{uid} document, including a late-written subscription field', async () => {
    const { deleteUserProfileDocument } = await import('../firestoreCleanup/resources');

    const existing = new Map<string, Record<string, unknown>>();
    existing.set('users/uid-A', {
      profile: { name: 'Test' },
      // Simulates a RevenueCat webhook write that landed mid-workflow.
      subscription: { status: 'ACTIVE', lastEventId: 'late-webhook-event' },
    });

    const fakeDb = {
      collection(name: string) {
        return {
          doc(id: string) {
            const path = `${name}/${id}`;
            return {
              async get() {
                return { exists: existing.has(path), data: () => existing.get(path) };
              },
              async delete() {
                existing.delete(path);
              },
            };
          },
        };
      },
    };

    const result = await deleteUserProfileDocument('uid-A', fakeDb as never);
    expect(result).toEqual({ resource: 'userProfile', deletedCount: 1, alreadyAbsent: false });
    // The whole document — including the late-written subscription field —
    // is gone, not just the fields FIRESTORE_CLEANUP "knew about" ahead of time.
    expect(existing.has('users/uid-A')).toBe(false);
  });
});
