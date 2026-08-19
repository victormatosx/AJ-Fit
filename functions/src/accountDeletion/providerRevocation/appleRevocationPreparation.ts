/**
 * Pre-commit Apple revocation preparation — Fase 3/5 correction.
 *
 * Closes the gap the audit found: `appleProviderRevocation.ts`'s executor
 * was always correct, but nothing in the codebase ever called it (or
 * exchanged material for it to cache) BEFORE the client could disappear.
 * This module is the missing half: it lets `requestAccountDeletion.ts`
 * turn a fresh, client-supplied `authorizationCode` into backend-owned,
 * retry-safe material as part of accepting the deletion request itself —
 * so that once accepted, `PROVIDER_REVOCATION`'s Apple sub-step never
 * again needs the client, the app, or the user's attention.
 *
 * Two functions, two different failure postures, used in sequence by
 * `requestAccountDeletion.ts`:
 *   1. `exchangeAppleAuthorizationCode` — runs BEFORE any deletion record
 *      exists. Throws on failure, so the caller can refuse to create a
 *      record at all (Fase 3/5 correction rule: preparation failure ⇒
 *      deletion NOT accepted, account NOT disabled — never a half-committed
 *      state).
 *   2. `cacheAppleRevocationMaterial` — runs AFTER the deletion record
 *      already durably exists, wrapping the already-exchanged refresh token
 *      via KMS and persisting it to `appleRevocationRepository.ts`. Never
 *      throws: a failure here is a rare, documented degraded path (the
 *      authorizationCode is already spent — same reasoning as
 *      `appleProviderRevocation.ts`'s own note on persistence failure), not
 *      a reason to fail the whole accepted request.
 */

import { AppleIdentityApiError, type AppleIdentityClient } from './appleIdentityClient';
import { wrapAppleRefreshToken } from './appleTokenCrypto';
import {
  FirestoreAppleRevocationMaterialRepository,
  type AppleRevocationMaterialRepository,
} from './appleRevocationRepository';
import type { KnownErrorCode } from '../errors';

export class AppleRevocationPreparationError extends Error {
  constructor(public readonly code: KnownErrorCode) {
    super(`Apple revocation preparation failed: ${code}`);
    this.name = 'AppleRevocationPreparationError';
  }
}

/**
 * Exchanges a fresh, single-use `authorizationCode` for a refresh token.
 * Never persists the authorization code itself anywhere (Fase 3/5
 * correction rule: transitory material, never stored long-term by
 * convenience) — it lives only in this call's stack, is spent by Apple the
 * moment the exchange succeeds, and is never touched again either way.
 */
export async function exchangeAppleAuthorizationCode(
  authorizationCode: string,
  deps: { client: Pick<AppleIdentityClient, 'exchangeAuthorizationCode'> },
): Promise<string> {
  try {
    const exchange = await deps.client.exchangeAuthorizationCode(authorizationCode);
    return exchange.refreshToken;
  } catch (error) {
    const code = error instanceof AppleIdentityApiError ? error.code : 'INTERNAL_TRANSIENT';
    throw new AppleRevocationPreparationError(code);
  }
}

/**
 * Wraps (KMS) and persists an already-exchanged refresh token against a
 * deletionId that already exists. `{cached:false}` on any failure — the
 * caller must never treat that as fatal (the record already durably
 * exists); it only means `PROVIDER_REVOCATION`'s Apple sub-step will stay
 * `PENDING` with no cached material until a future attempt captures fresh
 * material again (same terminal-eventually behavior
 * `appleProviderRevocation.ts` already has for "no cache, no code").
 */
export async function cacheAppleRevocationMaterial(
  deletionId: string,
  refreshToken: string,
  deps: {
    repository?: Pick<AppleRevocationMaterialRepository, 'save'>;
    wrap?: typeof wrapAppleRefreshToken;
    now?: () => number;
  } = {},
): Promise<{ cached: boolean }> {
  const repository = deps.repository ?? new FirestoreAppleRevocationMaterialRepository();
  const wrap = deps.wrap ?? wrapAppleRefreshToken;
  const now = deps.now ?? (() => Date.now());

  try {
    const wrapped = await wrap(refreshToken);
    await repository.save(deletionId, {
      wrappedRefreshToken: wrapped.wrappedToken,
      kmsKeyVersion: wrapped.kmsKeyVersion,
      createdAtMs: now(),
    });
    return { cached: true };
  } catch {
    return { cached: false };
  }
}
