import {
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type TotpSecret,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  selectTotpFactors,
  isMultiFactorAuthRequired,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import { reauthenticatePasswordUser } from './password';

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

export type TotpUnenrollmentChallenge = {
  readonly userUid: string;
  readonly targetFactorUid: string;
  readonly reauthHintUid: string;
  readonly resolver: MultiFactorResolver;
};

export type TotpUnenrollmentStart =
  | { status: 'completed'; factors: TotpFactor[] }
  | { status: 'challenge'; challenge: TotpUnenrollmentChallenge };

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

export async function startTotpEnrollmentWithPassword(
  currentPassword: string,
): Promise<TotpEnrollmentDraft> {
  if (!currentPassword) throw new MfaTotpServiceError('passwordRequired');
  const user = await reauthenticatePasswordUser(currentPassword);
  const current = currentUserOrThrow();
  if (current.uid !== user.uid) throw new MfaTotpServiceError('sessionExpired');
  if (!current.emailVerified) throw new MfaTotpServiceError('emailUnverified');
  if (currentTotpFactors().length > 0) {
    throw new MfaTotpServiceError('alreadyEnabled');
  }

  const session = await multiFactor(current).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return {
    userUid: current.uid,
    secret,
    secretKey: secret.secretKey,
    otpAuthUri: secret.generateQrCodeUrl(current.email ?? current.uid, TOTP_ISSUER),
    enrollmentCompletionDeadline: secret.enrollmentCompletionDeadline,
  };
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
): Promise<TotpFactor[]> {
  const current = currentUserOrThrow();
  const factor = selectTotpFactors(multiFactor(current).enrolledFactors).find(
    (candidate) => candidate.uid === factorUid,
  );
  if (!factor) throw new MfaTotpServiceError('factorNotFound');

  await multiFactor(current).unenroll(factor);
  return refreshTotpFactors();
}

export async function startTotpUnenrollmentWithPassword(
  factorUid: string,
  currentPassword: string,
): Promise<TotpUnenrollmentStart> {
  if (!currentPassword) throw new MfaTotpServiceError('passwordRequired');
  const user = currentUserOrThrow();
  const target = selectTotpFactors(multiFactor(user).enrolledFactors).find(
    (candidate) => candidate.uid === factorUid,
  );
  if (!target) throw new MfaTotpServiceError('factorNotFound');

  try {
    const reauthenticated = await reauthenticatePasswordUser(currentPassword, {
      preserveMultiFactorError: true,
    });
    if (reauthenticated.uid !== user.uid) {
      throw new MfaTotpServiceError('sessionExpired');
    }
    return {
      status: 'completed',
      factors: await unenrollCurrentTotpFactor(factorUid),
    };
  } catch (error) {
    if (!isMultiFactorAuthRequired(error)) throw error;
    const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
    const reauthHint = selectTotpFactors(resolver.hints).find(
      (hint) => hint.uid === factorUid,
    );
    if (!reauthHint) throw new MfaTotpServiceError('factorNotFound');
    return {
      status: 'challenge',
      challenge: {
        userUid: user.uid,
        targetFactorUid: factorUid,
        reauthHintUid: reauthHint.uid,
        resolver,
      },
    };
  }
}

export async function finishTotpUnenrollment(
  challenge: TotpUnenrollmentChallenge,
  code: string,
): Promise<TotpFactor[]> {
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
  return unenrollCurrentTotpFactor(challenge.targetFactorUid);
}
