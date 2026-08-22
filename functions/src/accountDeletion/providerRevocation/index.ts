/**
 * Public surface of the provider-revocation submodule (Fase 3). Not wired
 * into `functions/src/index.ts` — no Cloud Function is registered from
 * this module (see the Fase 3 report for what remains for a later phase).
 *
 * Fase 17 (final production audit) removed `googleProviderRevocation.ts` —
 * a wire contract for a "future confirmation callable" that was never
 * registered and never adopted: Google's revoke+unlink was moved entirely
 * client-side, BEFORE `requestAccountDeletion()`, by the Fase 3/5
 * correction (`src/services/accountDeletionProviderRevocation.ts`'s
 * `revokeGoogleProviderAccess`), so a successfully-unlinked Google account
 * is already `SKIPPED_BY_POLICY` at record-creation time and this
 * submodule's Google sub-step is structurally never runnable in the normal
 * path. The one defensive case where it WOULD be asked to run (client
 * unlink raced/failed and `google.com` was still linked at snapshot time)
 * is still handled — `reconciliation/dispatcher.ts`'s `runProviderSubStep`
 * fails it `MISSING_REQUIRED_CONFIGURATION` (terminal, operator-visible),
 * inline, without needing this module.
 */

export * from './types';
export * from './appleClientSecret';
export * from './appleKmsClient';
export * from './appleTokenCrypto';
export * from './appleIdentityClient';
export * from './appleIdentityConfig';
export * from './appleRevocationRepository';
export * from './appleRevocationPreparation';
export * from './appleProviderRevocation';
