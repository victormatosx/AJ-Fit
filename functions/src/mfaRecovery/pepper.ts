import { defineSecret } from 'firebase-functions/params';

import { RECOVERY_PEPPER_MIN_BYTES } from './digest';
import { RecoveryError } from './errors';

/**
 * MFA Recovery — the HMAC pepper, sourced from Secret Manager.
 *
 *
 * WHAT THIS SECRET IS FOR
 * -----------------------
 * Recovery code digests are HMAC-SHA-256 keyed with this pepper (digest.ts).
 * Without it, a Firestore-only compromise yields digests an attacker can
 * attack offline; with it, a stolen `_mfaRecovery` collection is inert unless
 * Secret Manager falls too. It is a KEY, not a salt: one value for the whole
 * project, never per-user, never stored beside the digests it protects.
 *
 *
 * PROVISIONING — NOT DONE BY THIS CODE, DELIBERATELY
 * --------------------------------------------------
 * `MFA_RECOVERY_PEPPER` does not exist in this repository, in any `.env`, or
 * in any local Firebase config — that was verified before this file was
 * written, and this phase does not create it. Whether it exists REMOTELY is
 * NOT CONFIRMABLE FROM THE REPOSITORY, and no command was run to find out:
 * reading a secret's value is exactly the thing this module must never do.
 *
 * A human provisions it once, out of band:
 *
 *     head -c 32 /dev/urandom | base64 | \
 *       firebase functions:secrets:set MFA_RECOVERY_PEPPER
 *
 * (32 bytes = 256 bits, matching the HMAC-SHA-256 block guidance in
 * digest.ts. The value must be base64 — see `decodeRecoveryPepper`.)
 *
 * Until that has happened, the callable binding below resolves to nothing and
 * generation fails closed with `PEPPER_UNAVAILABLE`. That is the correct
 * behaviour: minting recovery codes under a missing or weak key would produce
 * digests that cannot be trusted, and a user who was shown those codes would
 * believe they had a working recovery path.
 *
 * Rotation is NOT implemented here. `pepperVersion` is persisted on every
 * recovery set so a future rotation can verify old digests with the old key
 * while writing new ones with the new key; building that is a later phase.
 */

/**
 * Secret Manager binding. Bound to the generation callable's `secrets` option
 * so the value is materialized only inside that function's runtime.
 */
export const MFA_RECOVERY_PEPPER = defineSecret('MFA_RECOVERY_PEPPER');

/**
 * The pepper generation currently in use.
 *
 * Persisted on each recovery set. Bump ONLY together with a rotation
 * mechanism that can still verify digests written under the previous value —
 * changing this number alone would silently invalidate every existing
 * recovery code.
 */
export const CURRENT_RECOVERY_PEPPER_VERSION = 1;

/**
 * Decodes and validates the raw secret value.
 *
 * Kept separate from `readRecoveryPepper` so tests can exercise the
 * validation with a throwaway value and never touch Secret Manager.
 *
 * Failures throw `PEPPER_UNAVAILABLE` and nothing more specific: "absent",
 * "not base64" and "too short" are all the same actionable fact to a caller,
 * and distinguishing them in an error would describe the key.
 */
export function decodeRecoveryPepper(raw: string | undefined | null): Uint8Array {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new RecoveryError('PEPPER_UNAVAILABLE');
  }

  const decoded = Buffer.from(raw, 'base64');

  // Strict round-trip: a value that is not really base64 would otherwise
  // decode to a short, attacker-influenced buffer rather than failing.
  if (decoded.length === 0 || decoded.toString('base64') !== raw) {
    throw new RecoveryError('PEPPER_UNAVAILABLE');
  }

  if (decoded.length < RECOVERY_PEPPER_MIN_BYTES) {
    throw new RecoveryError('PEPPER_UNAVAILABLE');
  }

  return decoded;
}

/**
 * Materializes the pepper inside a bound function's runtime.
 *
 * `.value()` only resolves where the secret is declared in the function's
 * `secrets` option; anywhere else it is empty, which fails closed above.
 * Never call this at module load — that would run at deploy/analysis time,
 * where the secret is legitimately unavailable.
 *
 * The returned bytes stay in memory for the duration of one request and are
 * never logged, returned, persisted or copied anywhere.
 */
export function readRecoveryPepper(): Uint8Array {
  return decodeRecoveryPepper(MFA_RECOVERY_PEPPER.value());
}
