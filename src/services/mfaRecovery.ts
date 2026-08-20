import { httpsCallable } from 'firebase/functions';

import { auth } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import {
  MfaRecoveryError,
  isMfaRecoveryError,
  logMfaRecoveryIssue,
  mfaRecoveryIssueFromCallableCode,
  type MfaRecoveryIssue,
} from '../lib/mfaRecoveryErrors';

/**
 * Client for the MFA recovery-codes backend.
 *
 * Owns the only conversation with `generateMfaRecoveryCodes`. Screens never
 * call `httpsCallable` directly and never see a raw Firebase error.
 *
 *
 * THE PLAINTEXT RULE
 * ------------------
 * The value returned by this module is the ONLY time ten usable recovery
 * codes exist outside the user's own notes. It is handed straight to the
 * screen that displays them and must live nowhere else: not in AsyncStorage,
 * not in SecureStore, not in Firestore, not on the filesystem, not in a
 * persisted store, not in analytics, and above all not in a log line.
 *
 * That last one is why the error path here never logs the caught error or the
 * response — only a sanitized issue. A `logError(err)` on a resolved-then-
 * rejected promise is exactly how a response body ends up in a crash report.
 *
 *
 * WHAT IS NEVER SENT
 * ------------------
 * The callable takes NO arguments. Identity comes from the verified ID token
 * on the backend (`request.auth.uid`); a uid, email, provider, recoverySetId
 * or pointer version sent from here would be ignored at best and a spoofing
 * surface at worst.
 */

/** Fixed by the backend contract. A response with any other count is rejected. */
export const RECOVERY_CODES_PER_SET = 10;

/**
 * Display shape of a recovery code: `AJF-XXXX-…` in groups of four.
 *
 * Validated defensively rather than trusted. A malformed entry means the
 * response is not what this client understands, and showing a partially
 * correct list would leave the user believing they have working codes.
 */
const RECOVERY_CODE_PATTERN = /^AJF(-[0-9A-HJKMNP-TV-Z]{4}){10}$/;

export interface RecoveryCodesResult {
  /** Plaintext codes, display-formatted. In memory only, for one screen. */
  codes: string[];
  count: number;
}

function callableCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
}

function fail(stage: string, issue: MfaRecoveryIssue, callableCode?: string): never {
  logMfaRecoveryIssue(stage, issue, callableCode);
  throw new MfaRecoveryError(issue);
}

/**
 * Validates the callable payload against the whole contract before any of it
 * reaches the UI.
 *
 * Fails closed and completely: a response that is wrong in any way yields
 * nothing at all, never a partial list. The backend fields the client does not
 * need (`recoverySetId`, `createdAt`) are deliberately dropped here rather
 * than carried forward — the screen has no use for them and they would only
 * be one careless render away from being displayed.
 */
export function parseRecoveryCodesPayload(data: unknown): RecoveryCodesResult {
  if (typeof data !== 'object' || data === null) {
    fail('parse', 'recoveryInvalidResponse');
  }

  const payload = data as { codes?: unknown; count?: unknown };

  if (!Array.isArray(payload.codes)) {
    fail('parse', 'recoveryInvalidResponse');
  }
  if (payload.codes.length !== RECOVERY_CODES_PER_SET) {
    fail('parse', 'recoveryInvalidResponse');
  }
  if (payload.count !== RECOVERY_CODES_PER_SET) {
    // `count` disagreeing with `codes.length` means the two halves of the
    // response came from different states. Refuse rather than pick one.
    fail('parse', 'recoveryInvalidResponse');
  }

  const codes: string[] = [];
  for (const code of payload.codes) {
    if (typeof code !== 'string' || !RECOVERY_CODE_PATTERN.test(code)) {
      fail('parse', 'recoveryInvalidResponse');
    }
    codes.push(code);
  }

  if (new Set(codes).size !== codes.length) {
    // A duplicate would silently halve the set the user believes they hold.
    fail('parse', 'recoveryInvalidResponse');
  }

  return { codes, count: codes.length };
}

/**
 * Generates a fresh set of recovery codes for the signed-in user.
 *
 * Rotates any previous set server-side; the caller must have authenticated
 * recently and must already have TOTP enrolled — both enforced by the
 * backend, which stays the authority regardless of what the client did.
 *
 * The returned codes are shown once and then dropped. Callers must not
 * persist them.
 */
export async function generateRecoveryCodes(): Promise<RecoveryCodesResult> {
  // A callable attaches the ID token only when the SDK has a signed-in user.
  // Checking first turns "no session on this device" into a distinct, locally
  // diagnosable condition instead of an `unauthenticated` that looks
  // identical to a backend rejecting a valid token.
  if (!auth.currentUser) {
    fail('generate', 'recoveryUnauthenticated', 'no-current-user');
  }

  try {
    // No arguments, by contract. See "WHAT IS NEVER SENT" above.
    const call = httpsCallable(functions, 'generateMfaRecoveryCodes');
    const response = await call();
    return parseRecoveryCodesPayload(response.data);
  } catch (err) {
    // A parse failure already logged its own issue; re-throwing it unchanged
    // keeps one failure from being reported twice under two different names.
    if (isMfaRecoveryError(err)) throw err;

    const code = callableCode(err);
    if (code === 'internal' || code === '') {
      // Network faults surface without a usable code on React Native.
      fail(
        'generate',
        code === '' ? 'recoveryNetworkUnavailable' : 'recoveryGenerationFailed',
        code || 'no-code',
      );
    }
    fail('generate', mfaRecoveryIssueFromCallableCode(code), code);
  }
}
