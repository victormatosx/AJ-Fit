/**
 * Orchestrates ONE Apple provider-revocation attempt: identity guard ->
 * (exchange or reuse cached material) -> revoke -> cleanup. Fase 3.
 *
 * This is what a future worker calls for the `apple.com` sub-step of
 * `PROVIDER_REVOCATION` (see `types.ts`). It returns an
 * `AccountDeletionStepOutcome` (Fase 1's `../errors.ts`) — the SAME
 * contract every other step in the workflow already reports through
 * `../steps.ts`'s `completeStepAttempt`. No parallel result shape.
 *
 * Idempotency (Fase 3 §13/§14), by construction:
 *   - First attempt for a `deletionId`: no cached material exists ->
 *     requires a fresh `authorizationCode` -> exchanges it once, persists
 *     the resulting refresh token (encrypted), then revokes.
 *   - Any subsequent attempt (retry after a `revoke` timeout, or a second
 *     worker picking up the same `deletionId`): cached material exists ->
 *     the spent `authorizationCode` is never touched again -> unwraps the
 *     PREVIOUSLY exchanged refresh token and retries ONLY the revoke call.
 *   - On success, or on any TERMINAL-classified failure (retrying would
 *     never help), the cached material is cleared — it is never kept
 *     longer than the sub-step needs it.
 */

import { classifyErrorCode, type AccountDeletionStepOutcome, type KnownErrorCode } from '../errors';
import { AppleIdentityApiError, type AppleIdentityClient } from './appleIdentityClient';
import type { AppleRevocationMaterialRepository } from './appleRevocationRepository';

export interface AppleProviderRevocationInput {
  deletionId: string;
  /** The uid this DELETION RECORD belongs to — never client-supplied at this layer, resolved server-side when the record was created (Fase 1). */
  expectedUid: string;
  /** The uid the Apple material (identityToken/authorizationCode) was actually captured for, during the client's fresh reauthentication. */
  capturedForUid: string;
  /** Present only on an attempt that just captured fresh Apple material; `null` on a retry that should reuse cached material. */
  authorizationCode: string | null;
}

export interface AppleProviderRevocationDependencies {
  client: Pick<AppleIdentityClient, 'exchangeAuthorizationCode' | 'revokeToken'>;
  repository: AppleRevocationMaterialRepository;
  wrap: (refreshToken: string) => Promise<{ wrappedToken: string; kmsKeyVersion: string }>;
  unwrap: (wrappedToken: string) => Promise<string>;
  now?: () => number;
}

function errorCodeFrom(error: unknown): KnownErrorCode {
  if (error instanceof AppleIdentityApiError) return error.code;
  return 'INTERNAL_TRANSIENT';
}

export async function revokeAppleProvider(
  input: AppleProviderRevocationInput,
  deps: AppleProviderRevocationDependencies,
): Promise<AccountDeletionStepOutcome> {
  // Identity guard FIRST — before any network call, any KMS call, any
  // Firestore read. Fase 3 §16/§37: material captured for one Firebase UID
  // must never be usable to revoke a provider on behalf of another.
  if (input.capturedForUid !== input.expectedUid) {
    return { kind: 'FAILED', code: 'IDENTITY_MISMATCH' };
  }

  const now = deps.now ?? (() => Date.now());

  let refreshToken: string;
  const cached = await deps.repository.read(input.deletionId);

  if (cached) {
    try {
      refreshToken = await deps.unwrap(cached.wrappedRefreshToken);
    } catch {
      return { kind: 'FAILED', code: 'PROVIDER_RESPONSE_INVALID' };
    }
  } else {
    if (!input.authorizationCode) {
      // No cached material AND no fresh code to spend — nothing this
      // attempt can do. The caller must have the client capture a new
      // authorizationCode via a fresh reauthentication before retrying.
      return { kind: 'FAILED', code: 'PROVIDER_AUTHORIZATION_INVALID' };
    }

    let exchange;
    try {
      exchange = await deps.client.exchangeAuthorizationCode(input.authorizationCode);
    } catch (error) {
      return { kind: 'FAILED', code: errorCodeFrom(error) };
    }
    refreshToken = exchange.refreshToken;

    try {
      const wrapped = await deps.wrap(refreshToken);
      await deps.repository.save(input.deletionId, {
        wrappedRefreshToken: wrapped.wrappedToken,
        kmsKeyVersion: wrapped.kmsKeyVersion,
        createdAtMs: now(),
      });
    } catch {
      // Persistence failed, but the token is already in hand for THIS
      // attempt — proceed to revoke immediately rather than discard the
      // only usable outcome of an already-spent authorization code. If
      // revoke also fails below, a subsequent retry will have no cached
      // material and will need a fresh client capture — a known, documented
      // degraded path (Fase 3 report §9), not silently pretended away.
    }
  }

  try {
    await deps.client.revokeToken(refreshToken, 'refresh_token');
  } catch (error) {
    const code = errorCodeFrom(error);
    if (classifyErrorCode(code) !== 'RETRYABLE') {
      await deps.repository.clear(input.deletionId).catch(() => {});
    }
    return { kind: 'FAILED', code };
  }

  await deps.repository.clear(input.deletionId).catch(() => {});
  return { kind: 'SUCCEEDED' };
}
