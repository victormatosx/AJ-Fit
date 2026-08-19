/**
 * Public surface of the Account Deletion workflow module (Fase 1-3). See
 * docs/25_exclusao_de_conta_arquitetura.md for the architecture this
 * implements.
 *
 * `types`/`errors`/`policy`/`retry`/`steps`/`stateMachine`/`concurrency`/
 * `record`/`requestContract` (Fase 1-2) remain pure — no network/Firestore/
 * KMS call in any of them.
 *
 * Fase 17 (final production audit) removed `authGuard.ts`
 * (`requireAccountDeletionAuthorization`) as dead code: the REAL
 * `requestAccountDeletion` callable (Fase 4+) never adopted it — it calls
 * `requireRecentAuth` directly and validates its payload with
 * `requestContract.ts`'s `validateRequestAccountDeletionPayload` (a closed
 * allowlist, strictly stronger than `authGuard.ts`'s denylist-based
 * `rejectClientSuppliedIdentityOrPolicy`, which itself remains in
 * `requestContract.ts` — unused by production today, kept there as a small,
 * already-tested, colocated defense-in-depth utility, not deleted since
 * removing it has no benefit and touches a live file for no gain).
 *
 * `providerRevocation/*` (Fase 3) is NOT entirely pure: `appleKmsClient.ts`,
 * `appleTokenCrypto.ts`, `appleRevocationRepository.ts` and
 * `appleIdentityClient.ts` are real I/O adapters (Cloud KMS, Firestore
 * Admin SDK, HTTPS to appleid.apple.com respectively) — but every one of
 * them is a thin, independently-testable adapter behind an interface/
 * injectable dependency, exactly like `functions/src/photoVault/
 * kmsClient.ts`/`vaultKeyCrypto.ts`/`vaultRepository.ts` and
 * `functions/src/billing/revenueCatApi.ts` already are elsewhere in this
 * codebase. No Cloud Function is registered from anywhere in this module —
 * see the Fase 1/2/3 reports for what remains deliberately unbuilt.
 */

export * from './types';
export * from './errors';
export * from './policy';
export * from './retry';
export * from './steps';
export * from './stateMachine';
export * from './concurrency';
export * from './record';
export * from './requestContract';
export * from './providerRevocation';
export * from './repository';
export * from './requestAccountDeletion';
export * from './accountAccessLock';
export * from './activeAccountGuard';
export * from './firestoreCleanup';
export * from './storageCleanup';
export * from './retainedDataProcessing';
export * from './revenueCatProcessing';
export * from './authDeletion';
export * from './vaultKeyDestruction';
