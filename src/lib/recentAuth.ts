import type { User } from 'firebase/auth';

/**
 * Client-side freshness window for deciding whether to prompt for
 * reauthentication before attempting a recent-auth-gated backend call.
 * Deliberately tighter than any backend window (`functions/src/lib/auth.ts`'s
 * `RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60`) and mirrors the value already
 * established for Photo Vault key recovery
 * (`src/services/photoVault.ts`'s `CLIENT_RECENT_AUTH_MAX_AGE_MS`). Being
 * conservative here only costs an extra reauthentication prompt — a false
 * "not fresh" never grants anything, and the backend remains the sole
 * authority regardless of what this check answers (see
 * `functions/src/accountDeletion/authGuard.ts`).
 */
export const CLIENT_RECENT_AUTH_MAX_AGE_MS = 4 * 60 * 1000;

/**
 * Whether `user`'s current ID token was minted recently enough that a
 * recent-auth-gated backend call is LIKELY to be accepted.
 *
 * Read from the Firebase-issued token (`getIdTokenResult().authTime`),
 * never from a local "I just reauthenticated" flag — the backend never
 * trusts anything the client asserts about its own freshness either (see
 * `functions/src/lib/auth.ts`'s `requireRecentAuth`, which reads
 * `request.auth.token.auth_time` from the verified token and explicitly
 * ignores any `auth_time`/`reauthenticated` field a caller plants in the
 * request body).
 */
export async function hasRecentAuth(
  user: Pick<User, 'getIdTokenResult'> | null,
  maxAgeMs: number = CLIENT_RECENT_AUTH_MAX_AGE_MS,
): Promise<boolean> {
  if (!user) return false;

  try {
    const result = await user.getIdTokenResult();
    const authTime = Date.parse(result.authTime);
    if (Number.isNaN(authTime)) return false;

    const age = Date.now() - authTime;
    return age >= 0 && age <= maxAgeMs;
  } catch {
    return false;
  }
}
