import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { auth } from '../lib/firebaseAdmin';
import { requireRecentAuth } from '../lib/auth';
import { logFunctionError } from '../lib/logger';
import { formatRecoveryCodeForDisplay } from './codeFormat';
import { generateRecoveryCodeSet } from './codeGenerator';
import { computeRecoveryCodeDigest } from './digest';
import { RecoveryError, isRecoveryError } from './errors';
import { logRecoveryEvent } from './logging';
import { CURRENT_RECOVERY_PEPPER_VERSION, MFA_RECOVERY_PEPPER, readRecoveryPepper } from './pepper';
import {
  RecoveryGenerationConflictError,
  RecoverySelectorTakenError,
  persistNewRecoverySet,
  readRecoveryPointerState,
} from './recoverySetRepository';
import {
  RECOVERY_CODES_PER_SET,
  RECOVERY_SCHEMA_VERSION,
  type RecoveryCodeRecord,
  type RecoverySetDocument,
} from './schema';
import { RECOVERY_DIGEST_ALGORITHM, RECOVERY_DIGEST_VERSION } from './digest';

/**
 * MFA Recovery — generation callable.
 *
 *     authenticated user
 *             |
 *     recent auth (<= 5 min)  +  TOTP actually enrolled
 *             |
 *     10 codes from the CSPRNG, unique within the set
 *             |
 *     HMAC-SHA-256 with the Secret Manager pepper
 *             |
 *     persist digests only, atomically, rotating any previous set
 *             |
 *     return the plaintext ONCE
 *
 * This mints and stores codes; it does NOT consume them, and
 * it never touches a second factor. There is no Admin Auth write of any kind
 * here — `auth` is used for exactly one read (`getUser`) to confirm the user
 * has TOTP enrolled.
 *
 * Exported from src/index.ts (Phase 3) and deployed to us-central1. The
 * response carries the codes in their grouped display form; everything
 * upstream of the return statement works on the canonical form, which is what
 * is hashed.
 */

const SCOPE = 'mfaRecovery.generate';

/**
 * How many times a taken selector may be retried before failing.
 *
 * At 60 bits a collision is already a ~4e-7 event across the whole user base
 * (codeFormat.ts); three attempts is not a probability budget, it is a bound
 * that keeps a broken CSPRNG or a Firestore fault from looping.
 */
const MAX_SELECTOR_ATTEMPTS = 3;

/**
 * Recent-auth window for generation.
 *
 * Reuses `requireRecentAuth`'s project-wide 5 minute default rather than
 * inventing a second number. Five minutes is long enough for a user to walk
 * from the re-authentication prompt through the enrollment screen on a slow
 * connection, and short enough that a phone left unlocked on a desk, or a
 * stolen refresh token replayed later, is not sufficient on its own to mint a
 * fresh set of credentials that bypass the second factor.
 *
 * `auth_time` is read from the Firebase-verified ID Token, never from the
 * request body, and it is compared against the server clock.
 */
const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;

export interface GenerateRecoveryCodesResponse {
  recoverySetId: string;
  /** Plaintext codes. The ONLY time these ever leave the function. */
  codes: string[];
  /** ISO-8601, server clock. */
  createdAt: string;
  count: number;
}

/** The uid's second factors, read from Admin Auth. Never from the client. */
async function requireEnrolledTotp(uid: string): Promise<void> {
  const user = await auth.getUser(uid);
  const factors = user.multiFactor?.enrolledFactors ?? [];

  // firebase-admin 12.x reports TOTP second factors with factorId 'totp'
  // (TotpMultiFactorInfo). SMS ('phone') deliberately does not count: this
  // product only enrolls TOTP, and recovery codes must correspond to the
  // factor they can replace.
  if (!factors.some((factor) => factor.factorId === 'totp')) {
    throw new HttpsError(
      'failed-precondition',
      'Two-factor authentication must be enabled before generating recovery codes.',
    );
  }
}

/**
 * Generates, hashes and persists one recovery set, retrying on the (effectively
 * impossible) case of a selector that is already taken.
 *
 * A retry regenerates EVERYTHING, not just the selector: every code embeds
 * the selector, so reusing the secrets under a new selector would produce
 * codes whose digests were computed over different strings than the ones
 * printed for the user.
 *
 * The plaintext lives only in this function's locals and in the returned
 * array. It is never written to Firestore, never logged, and there is no
 * endpoint anywhere that can read it back.
 */
export async function provisionRecoverySet(
  uid: string,
  pepper: Uint8Array,
  now: Date,
): Promise<{ recoverySetId: string; codes: string[] }> {
  // Captured BEFORE anything is minted. Every attempt below commits against
  // this same value — deliberately NOT re-read on retry: re-reading would
  // adopt a concurrent winner's state and rotate codes that were already
  // handed to a user, which is precisely the failure the compare-and-set
  // exists to prevent. A selector collision retries; a lost race does not.
  const { version: expectedVersion } = await readRecoveryPointerState(uid);

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_SELECTOR_ATTEMPTS; attempt += 1) {
    const { selector, codes } = generateRecoveryCodeSet(RECOVERY_CODES_PER_SET);

    const records: RecoveryCodeRecord[] = codes.map((code, index) => ({
      id: `code-${index + 1}`,
      // Only the digest survives this line.
      digest: computeRecoveryCodeDigest(code, pepper),
      state: 'available',
      createdAt: now,
      reservedAt: null,
      consumedAt: null,
      operationId: null,
    }));

    try {
      const result = await persistNewRecoverySet(
        uid,
        expectedVersion,
        ({ version }): RecoverySetDocument => ({
          schemaVersion: RECOVERY_SCHEMA_VERSION,
          recoverySetId: selector,
          uid,
          version,
          pepperVersion: CURRENT_RECOVERY_PEPPER_VERSION,
          digestVersion: RECOVERY_DIGEST_VERSION,
          digestAlgorithm: RECOVERY_DIGEST_ALGORITHM,
          status: 'active',
          createdAt: now,
          rotatedAt: null,
          codes: records,
          rateLimit: {
            attempts: 0,
            windowStartedAt: null,
            lastAttemptAt: null,
            blockedUntil: null,
          },
          activeOperation: null,
        }),
        now,
      );

      logRecoveryEvent({
        eventType: result.rotatedSetId ? 'recovery_set_rotated' : 'recovery_set_created',
        stage: 'generate',
        outcome: 'succeeded',
        attempt,
        schemaVersion: RECOVERY_SCHEMA_VERSION,
      });

      return { recoverySetId: result.recoverySetId, codes };
    } catch (err) {
      if (!(err instanceof RecoverySelectorTakenError)) {
        throw err;
      }

      lastError = err;
      logRecoveryEvent({
        eventType: 'recovery_set_created',
        stage: 'persist',
        outcome: 'rejected',
        attempt,
      });
    }
  }

  throw lastError ?? new RecoveryError('INVALID_RECOVERY_SET');
}

export async function handleGenerateRecoveryCodes(
  request: CallableRequest,
): Promise<GenerateRecoveryCodesResponse> {
  // uid comes exclusively from the verified ID token. Anything in
  // `request.data` — a uid, an email, a provider, a recoverySetId — is
  // ignored entirely; this handler never reads `request.data` at all.
  const uid = requireRecentAuth(request, RECENT_AUTH_MAX_AGE_SECONDS);

  await requireEnrolledTotp(uid);

  // Materialized per request, inside the bound runtime. Fails closed with
  // PEPPER_UNAVAILABLE when the secret has not been provisioned.
  const pepper = readRecoveryPepper();

  // Server clock, matching photoVault/createVault.ts: these documents are
  // backend-only, so there is no untrusted writer whose clock could be in
  // play, and a serverTimestamp sentinel could not be schema-validated.
  const now = new Date();

  try {
    const { recoverySetId, codes } = await provisionRecoverySet(uid, pepper, now);

    return {
      recoverySetId,
      // Formatted for display HERE, at the transport boundary, and nowhere
      // earlier. Everything upstream — generation, HMAC, persistence — works
      // on the canonical form, which is what `computeRecoveryCodeDigest`
      // hashes. Grouping is presentation only (codeFormat.ts), so applying it
      // after hashing cannot change a digest; and because
      // `parseRecoveryCode` canonicalizes on the way in, a user typing the
      // grouped form back in a later phase still verifies against the same
      // digest.
      //
      // This is the artifact the user actually reads and writes down, so the
      // grouped form is what leaves the backend — matching the response
      // contract the client validates.
      codes: codes.map(formatRecoveryCodeForDisplay),
      createdAt: now.toISOString(),
      count: codes.length,
    };
  } catch (err) {
    if (err instanceof RecoveryGenerationConflictError) {
      // A concurrent generation won. Nothing was written and no codes are
      // returned, so the caller can simply try again.
      //
      // This is the ONE place generation reports a distinct public reason,
      // and it is safe to do so: the caller is already authenticated as the
      // account owner with a fresh credential, so "another generation for
      // YOUR account just happened" tells them nothing they are not entitled
      // to know, and nothing about whether a recovery set exists, how many
      // codes it holds, or what state it is in. The anti-enumeration rule
      // that collapses every failure into one opaque code belongs to the
      // UNAUTHENTICATED consumption surface (errors.ts), where the caller has
      // not proved who they are — it is not a blanket rule for this module.
      //
      // `aborted` is the canonical code for a failed compare-and-set, and it
      // is the one gRPC status whose documented meaning is "retry may
      // succeed", which is exactly the guidance the client needs.
      logRecoveryEvent({
        eventType: 'recovery_set_created',
        stage: 'persist',
        outcome: 'rejected',
        internalCode: 'GENERATION_CONFLICT',
      });
      throw new HttpsError(
        'aborted',
        'Another recovery code generation is already in progress. Please try again.',
      );
    }

    // Everything else returns no detail: Firestore errors carry project and
    // path information, and a recovery failure must not describe the state of
    // the account's recovery material.
    logFunctionError(SCOPE, err, {
      internalCode: isRecoveryError(err) ? err.internalCode : 'UNCLASSIFIED',
    });
    throw new HttpsError('internal', 'Could not generate recovery codes.');
  }
}

/**
 * App Check is intentionally NOT enforced here.
 *
 * The project's App Check bridge exists and is tested, but enforcement is
 * switched off everywhere pending real-device validation on both platforms
 * (docs/21_photo_vault_pre_launch.md; `foundationStructure.test.ts` actively
 * asserts no callable sets `enforceAppCheck: true` yet). Turning it on for
 * this one callable would make generation fail for any build whose
 * attestation path has not been proven — and would do so at the exact moment
 * a user is trying to secure their account.
 *
 * It is also not the control that matters here: App Check attests the app
 * binary, not the user. This callable's real gates are the verified ID token,
 * the 5-minute recent-auth window and the requirement that TOTP already be
 * enrolled. Flipping enforcement on later is a pure options change with no
 * effect on the handler or the response contract.
 */
export const generateMfaRecoveryCodes = onCall(
  { secrets: [MFA_RECOVERY_PEPPER] },
  handleGenerateRecoveryCodes,
);
