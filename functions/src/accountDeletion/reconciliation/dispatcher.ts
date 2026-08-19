/**
 * Step dispatcher — Fase 14. Maps `AccountDeletionStepName` (and, for
 * `PROVIDER_REVOCATION`, `ProviderId`) to the EXACT executor already built
 * and independently tested in its own phase. This file contains ZERO
 * business logic of its own beyond argument wiring — no retry, no state
 * transition, no idempotency handling. That all still lives exclusively in
 * `../steps.ts`/`../errors.ts`/`../retry.ts` and each executor itself; see
 * `processRecord.ts` for where a dispatched outcome is turned into a
 * persisted step transition.
 */

import { lockAccountAccess } from '../accountAccessLock';
import { executeVaultKeyDestruction } from '../vaultKeyDestruction';
import { runFirestoreCleanup } from '../firestoreCleanup/engine';
import { runStorageCleanup } from '../storageCleanup/engine';
import { runRetainedDataProcessing } from '../retainedDataProcessing/engine';
import { runRevenueCatProcessing } from '../revenueCatProcessing/engine';
import { executeAuthDeletion } from '../authDeletion';
import { revokeAppleProvider } from '../providerRevocation/appleProviderRevocation';
import {
  FirestoreAppleRevocationMaterialRepository,
  type AppleRevocationMaterialRepository,
} from '../providerRevocation/appleRevocationRepository';
import { unwrapAppleRefreshToken, wrapAppleRefreshToken } from '../providerRevocation/appleTokenCrypto';
import { createAppleIdentityClient } from '../providerRevocation/appleIdentityConfig';
import type { AppleIdentityClient } from '../providerRevocation/appleIdentityClient';
import type { AccountDeletionStepOutcome } from '../errors';
import type { AccountDeletionRecord, AccountDeletionStepName } from '../types';
import type { ProviderId } from '../providerRevocation/types';

export type TopLevelDispatchableStep = Exclude<AccountDeletionStepName, 'PROVIDER_REVOCATION'>;

/**
 * Runs the ONE executor for a non-`PROVIDER_REVOCATION` step. `uid` and the
 * frozen `policy.retention` always come from `record` — never a
 * caller-supplied value — mirroring every executor's own contract that
 * `uid` must come exclusively from the workflow's trusted context.
 */
export async function runTopLevelStep(
  step: TopLevelDispatchableStep,
  record: AccountDeletionRecord,
): Promise<AccountDeletionStepOutcome> {
  switch (step) {
    case 'ACCOUNT_ACCESS_LOCK':
      return lockAccountAccess(record.uid);
    case 'VAULT_KEY_DESTRUCTION':
      return executeVaultKeyDestruction(record.uid);
    case 'FIRESTORE_CLEANUP':
      return runFirestoreCleanup(record.uid);
    case 'STORAGE_CLEANUP':
      return runStorageCleanup(record.uid);
    case 'RETAINED_DATA_PROCESSING':
      // Frozen policy ONLY — never `currentPolicy()` (Fase 8/14 rule). This
      // record may be years old; `record.policy.retention` is exactly the
      // snapshot resolved at its own creation time.
      return runRetainedDataProcessing(record.uid, record.policy.retention);
    case 'REVENUECAT_PROCESSING':
      // Frozen policy ONLY (Fase 9/14 rule). v1 is always `SKIP` — never
      // cancels a subscription, never makes a RevenueCat network call.
      return runRevenueCatProcessing(record.policy.retention.revenueCat);
    case 'AUTH_DELETION':
      return executeAuthDeletion(record.uid);
  }
}

export interface ProviderSubStepDispatcherDeps {
  appleClient?: Pick<AppleIdentityClient, 'exchangeAuthorizationCode' | 'revokeToken'>;
  appleRepository?: AppleRevocationMaterialRepository;
  wrap?: typeof wrapAppleRefreshToken;
  unwrap?: typeof unwrapAppleRefreshToken;
  now?: () => number;
}

/**
 * Runs one attempt of a `PROVIDER_REVOCATION` sub-step.
 *
 * Apple: reuses `revokeAppleProvider` exactly as built in Fase 3, always
 * with `authorizationCode: null` — the worker NEVER has fresh client
 * material, only whatever `requestAccountDeletion.ts` cached synchronously
 * at commit time (Fase 3/5 correction). `capturedForUid`/`expectedUid` are
 * both `record.uid`: the worker never captures material itself, so this
 * identity guard is satisfied by construction, not bypassed.
 *
 * Google: NO backend executor exists, and this is deliberate architecture
 * (`../providerRevocation/googleProviderRevocation.ts`'s doc comment) — the
 * Fase 3/5 correction moved Google's revoke+unlink entirely client-side,
 * BEFORE `requestAccountDeletion()` is even called, so a successfully
 * revoked Google account is already `SKIPPED_BY_POLICY` at record-creation
 * time and this function should structurally never be asked to run it.
 * Reaching here means the client did not (or could not) unlink Google
 * before the commit — the worker has no capability to complete this
 * sub-step, and per Fase 14's own rule, it must fail SAFELY rather than
 * hang, invent a new interactive flow, or attempt an undocumented API call.
 * `MISSING_REQUIRED_CONFIGURATION` (terminal) surfaces this as an
 * observable, operator-visible `FAILED_TERMINAL` outcome — never a silent
 * infinite retry.
 */
export async function runProviderSubStep(
  provider: ProviderId,
  record: AccountDeletionRecord,
  deps: ProviderSubStepDispatcherDeps = {},
): Promise<AccountDeletionStepOutcome> {
  if (provider === 'google.com') {
    return { kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' };
  }

  const client = deps.appleClient ?? createAppleIdentityClient();
  const repository = deps.appleRepository ?? new FirestoreAppleRevocationMaterialRepository();
  const wrap = deps.wrap ?? wrapAppleRefreshToken;
  const unwrap = deps.unwrap ?? unwrapAppleRefreshToken;

  return revokeAppleProvider(
    {
      deletionId: record.deletionId,
      expectedUid: record.uid,
      capturedForUid: record.uid,
      authorizationCode: null,
    },
    { client, repository, wrap, unwrap, now: deps.now },
  );
}
