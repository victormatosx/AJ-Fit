import {
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type TotpSecret,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  selectTotpFactors,
  isMultiFactorAuthRequired,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import {
  reauthenticateCurrentUser,
  type ReauthenticationRequest,
} from './reauthentication';

const FACTOR_DISPLAY_NAME = 'AJ Fit Authenticator';
const TOTP_ISSUER = 'AJ Fit';

export class MfaTotpServiceError extends Error {
  readonly issue: MfaTotpIssue;

  constructor(issue: MfaTotpIssue) {
    super(issue);
    this.name = 'MfaTotpServiceError';
    this.issue = issue;
  }
}

export type TotpFactor = {
  uid: string;
  factorId: string;
  displayName: string | null;
  enrollmentTime: string;
};

export type TotpEnrollmentDraft = {
  readonly userUid: string;
  readonly secret: TotpSecret;
  readonly secretKey: string;
  readonly otpAuthUri: string;
  readonly enrollmentCompletionDeadline: string;
};

/** A pending TOTP challenge raised by a reauthentication attempt. */
export type TotpReauthenticationChallenge = {
  userUid: string;
  reauthHintUid: string;
  resolver: MultiFactorResolver;
};

export type TotpReauthenticationStart =
  | { status: 'completed'; userUid: string }
  | { status: 'challenge'; challenge: TotpReauthenticationChallenge };

export type TotpUnenrollmentChallenge = {
  readonly userUid: string;
  readonly targetFactorUid: string;
  readonly reauthHintUid: string;
  readonly resolver: MultiFactorResolver;
};

export type TotpUnenrollmentStart =
  | { status: 'completed'; factors: TotpFactor[] }
  | { status: 'challenge'; challenge: TotpUnenrollmentChallenge };

export type TotpSignInOrigin =
  | 'password'
  | 'google'
  | 'apple'
  | 'account-linking';

export type TotpSignInHint = {
  /** Internal selection key. It is never rendered or persisted. */
  uid: string;
  displayName: string | null;
  enrollmentTime: string;
};

export type TotpSignInChallenge = {
  origin: TotpSignInOrigin;
  hints: TotpSignInHint[];
};

// A MultiFactorResolver represents a short-lived, first-factor-authenticated
// sign-in transaction. It deliberately exists only in this JS process: never
// in React state, AsyncStorage, SecureStore, Firestore, logs, or analytics.
let pendingSignInResolver: MultiFactorResolver | null = null;

function currentUserOrThrow() {
  const user = auth.currentUser;
  if (!user) throw new MfaTotpServiceError('userMissing');
  return user;
}

function summarizeFactor(factor: MultiFactorInfo): TotpFactor {
  return {
    uid: factor.uid,
    factorId: factor.factorId,
    displayName: factor.displayName ?? null,
    enrollmentTime: factor.enrollmentTime,
  };
}

function summarizeSignInHint(factor: MultiFactorInfo): TotpSignInHint {
  return {
    uid: factor.uid,
    displayName: factor.displayName ?? null,
    enrollmentTime: factor.enrollmentTime,
  };
}

/** Captures the original Firebase MFA error before any normalization occurs. */
export function startTotpSignInChallenge(
  error: unknown,
  origin: TotpSignInOrigin,
): TotpSignInChallenge {
  pendingSignInResolver = null;
  if (!isMultiFactorAuthRequired(error)) {
    throw new MfaTotpServiceError('generic');
  }

  const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
  if (resolver.hints.length === 0) {
    throw new MfaTotpServiceError('resolverWithoutHints');
  }

  // Unsupported factors are ignored. The app never starts SMS/reCAPTCHA and
  // never assumes the first resolver hint is TOTP.
  const totpHints = selectTotpFactors(resolver.hints);
  if (totpHints.length === 0) {
    throw new MfaTotpServiceError('factorNotFound');
  }

  pendingSignInResolver = resolver;
  return {
    origin,
    hints: totpHints.map(summarizeSignInHint),
  };
}

/**
 * Completes the pending sign-in with the explicitly selected TOTP factor.
 * Invalid/expired OTPs leave the resolver intact so the user can retry.
 */
export async function resolveTotpSignIn(
  hintUid: string,
  code: string,
): Promise<UserCredential> {
  const resolver = pendingSignInResolver;
  if (!resolver) throw new MfaTotpServiceError('sessionExpired');

  const normalizedCode = code.trim();
  const validationIssue = validateTotpCode(normalizedCode);
  if (validationIssue) throw new MfaTotpServiceError(validationIssue);

  const hint = selectTotpFactors(resolver.hints).find(
    (candidate) => candidate.uid === hintUid,
  );
  if (!hint) throw new MfaTotpServiceError('factorNotFound');

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    hint.uid,
    normalizedCode,
  );
  const credential = await resolver.resolveSignIn(assertion);
  pendingSignInResolver = null;
  return credential;
}

/** Clears the process-memory transaction on cancel, expiry, or unmount. */
export function clearTotpSignInChallenge(): void {
  pendingSignInResolver = null;
}

function currentTotpFactors(): TotpFactor[] {
  return selectTotpFactors(multiFactor(currentUserOrThrow()).enrolledFactors).map(
    summarizeFactor,
  );
}

export async function refreshTotpFactors(): Promise<TotpFactor[]> {
  const user = currentUserOrThrow();
  await user.reload();
  const refreshed = currentUserOrThrow();
  if (refreshed.uid !== user.uid) {
    throw new MfaTotpServiceError('sessionExpired');
  }
  return currentTotpFactors();
}

export async function startTotpEnrollment(
  request: ReauthenticationRequest,
): Promise<TotpEnrollmentDraft> {
  if (request.provider === 'password' && !request.password) {
    throw new MfaTotpServiceError('passwordRequired');
  }
  const original = currentUserOrThrow();
  const user = await reauthenticateCurrentUser(request);
  const current = currentUserOrThrow();
  if (current.uid !== original.uid || user.uid !== original.uid) {
    throw new MfaTotpServiceError('userMismatch');
  }
  if (!current.emailVerified) throw new MfaTotpServiceError('emailUnverified');
  if (currentTotpFactors().length > 0) {
    throw new MfaTotpServiceError('alreadyEnabled');
  }

  const session = await multiFactor(current).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  if (currentUserOrThrow().uid !== original.uid) {
    throw new MfaTotpServiceError('userMismatch');
  }
  return {
    userUid: current.uid,
    secret,
    secretKey: secret.secretKey,
    otpAuthUri: secret.generateQrCodeUrl(current.email ?? current.uid, TOTP_ISSUER),
    enrollmentCompletionDeadline: secret.enrollmentCompletionDeadline,
  };
}

/** Compatibility wrapper retained for password settings and existing callers. */
export function startTotpEnrollmentWithPassword(
  currentPassword: string,
): Promise<TotpEnrollmentDraft> {
  return startTotpEnrollment({ provider: 'password', password: currentPassword });
}

export async function finishTotpEnrollment(
  draft: TotpEnrollmentDraft,
  code: string,
): Promise<TotpFactor[]> {
  const user = currentUserOrThrow();
  if (user.uid !== draft.userUid) {
    throw new MfaTotpServiceError('sessionExpired');
  }
  if (Date.parse(draft.enrollmentCompletionDeadline) <= Date.now()) {
    throw new MfaTotpServiceError('flowExpired');
  }
  if (currentTotpFactors().length > 0) {
    throw new MfaTotpServiceError('alreadyEnabled');
  }

  const normalizedCode = code.trim();
  const validationIssue = validateTotpCode(normalizedCode);
  if (validationIssue) throw new MfaTotpServiceError(validationIssue);

  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
    draft.secret,
    normalizedCode,
  );
  await multiFactor(user).enroll(assertion, FACTOR_DISPLAY_NAME);
  return refreshTotpFactors();
}

async function unenrollCurrentTotpFactor(
  factorUid: string,
  expectedUserUid: string,
): Promise<TotpFactor[]> {
  const current = currentUserOrThrow();
  if (current.uid !== expectedUserUid) {
    throw new MfaTotpServiceError('userMismatch');
  }
  const factor = selectTotpFactors(multiFactor(current).enrolledFactors).find(
    (candidate) => candidate.uid === factorUid,
  );
  if (!factor) throw new MfaTotpServiceError('factorNotFound');

  await multiFactor(current).unenroll(factor);
  return refreshTotpFactors();
}

/**
 * Reauthenticates the current user, surfacing the TOTP challenge that Firebase
 * demands whenever the account has a second factor enrolled.
 *
 * This is the shared half of every sensitive 2FA operation. `reauthenticate
 * WithCredential` does NOT complete for an MFA-enabled account — it throws
 * `auth/multi-factor-auth-required` — so any flow that needs "prove it is
 * really you" has to reauthenticate, catch that, build a resolver, and finish
 * with a TOTP code. Unenrollment and recovery-code generation both need
 * exactly that, and neither may weaken it: the second factor is required to
 * act on the second factor.
 *
 * @param requiredFactorUid restricts the challenge to one specific enrolled
 *   factor. Unenrollment passes the factor being removed (you must hold the
 *   authenticator you are deleting); generation leaves it undefined, since any
 *   enrolled TOTP proves possession.
 */
export async function startTotpReauthentication(
  request: ReauthenticationRequest,
  requiredFactorUid?: string,
): Promise<TotpReauthenticationStart> {
  if (request.provider === 'password' && !request.password) {
    throw new MfaTotpServiceError('passwordRequired');
  }
  const user = currentUserOrThrow();

  try {
    const reauthenticated = await reauthenticateCurrentUser(request, {
      preserveMultiFactorError: true,
    });
    if (reauthenticated.uid !== user.uid) {
      throw new MfaTotpServiceError('sessionExpired');
    }
    return { status: 'completed', userUid: user.uid };
  } catch (error) {
    if (!isMultiFactorAuthRequired(error)) throw error;
    const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
    const hints = selectTotpFactors(resolver.hints);
    const reauthHint = requiredFactorUid
      ? hints.find((hint) => hint.uid === requiredFactorUid)
      : hints[0];
    if (!reauthHint) throw new MfaTotpServiceError('factorNotFound');
    return {
      status: 'challenge',
      challenge: { userUid: user.uid, reauthHintUid: reauthHint.uid, resolver },
    };
  }
}

/**
 * Completes a reauthentication challenge with a TOTP code.
 *
 * Returns the confirmed uid. The identity is re-checked on both sides of
 * `resolveSignIn` so a resolver can never complete against a different
 * account than the one that started the flow.
 */
export async function finishTotpReauthentication(
  challenge: TotpReauthenticationChallenge,
  code: string,
): Promise<string> {
  const user = currentUserOrThrow();
  if (user.uid !== challenge.userUid) {
    throw new MfaTotpServiceError('sessionExpired');
  }
  const normalizedCode = code.trim();
  const validationIssue = validateTotpCode(normalizedCode);
  if (validationIssue) throw new MfaTotpServiceError(validationIssue);

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    challenge.reauthHintUid,
    normalizedCode,
  );
  const credential = await challenge.resolver.resolveSignIn(assertion);
  if (credential.user.uid !== challenge.userUid) {
    throw new MfaTotpServiceError('sessionExpired');
  }
  return challenge.userUid;
}

export async function startTotpUnenrollment(
  factorUid: string,
  request: ReauthenticationRequest,
): Promise<TotpUnenrollmentStart> {
  const user = currentUserOrThrow();
  const target = selectTotpFactors(multiFactor(user).enrolledFactors).find(
    (candidate) => candidate.uid === factorUid,
  );
  if (!target) throw new MfaTotpServiceError('factorNotFound');

  // The reauthentication half is shared with recovery-code generation; only
  // the terminal action differs. `factorUid` is required here: removing an
  // authenticator must be proved with that same authenticator.
  const outcome = await startTotpReauthentication(request, factorUid);

  if (outcome.status === 'completed') {
    return {
      status: 'completed',
      factors: await unenrollCurrentTotpFactor(factorUid, user.uid),
    };
  }

  return {
    status: 'challenge',
    challenge: {
      userUid: outcome.challenge.userUid,
      targetFactorUid: factorUid,
      reauthHintUid: outcome.challenge.reauthHintUid,
      resolver: outcome.challenge.resolver,
    },
  };
}

/** Compatibility wrapper retained for the existing password reauth contract. */
export function startTotpUnenrollmentWithPassword(
  factorUid: string,
  currentPassword: string,
): Promise<TotpUnenrollmentStart> {
  return startTotpUnenrollment(factorUid, {
    provider: 'password',
    password: currentPassword,
  });
}

export async function finishTotpUnenrollment(
  challenge: TotpUnenrollmentChallenge,
  code: string,
): Promise<TotpFactor[]> {
  const userUid = await finishTotpReauthentication(
    {
      userUid: challenge.userUid,
      reauthHintUid: challenge.reauthHintUid,
      resolver: challenge.resolver,
    },
    code,
  );

  return unenrollCurrentTotpFactor(challenge.targetFactorUid, userUid);
}
