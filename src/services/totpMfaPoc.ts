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
  selectTotpHints,
  validateTotpCode,
  type TotpHintLike,
  type TotpMfaPocIssue,
} from '../lib/totpMfaPoc';

const POC_FACTOR_DISPLAY_NAME = 'AJ Fit Authenticator';
const POC_ISSUER = 'AJ Fit';

export class TotpMfaPocServiceError extends Error {
  readonly issue: TotpMfaPocIssue;

  constructor(issue: TotpMfaPocIssue) {
    super(issue);
    this.name = 'TotpMfaPocServiceError';
    this.issue = issue;
  }
}

export type TotpFactorSummary = TotpHintLike & {
  enrollmentTime: string;
};

export type TotpEnrollmentDraft = {
  readonly userUid: string;
  readonly secret: TotpSecret;
  readonly secretKey: string;
  readonly otpAuthUri: string;
  readonly hashingAlgorithm: string;
  readonly codeLength: number;
  readonly codeIntervalSeconds: number;
  readonly enrollmentCompletionDeadline: string;
};

export type TotpSignInChallenge = {
  hints: TotpFactorSummary[];
};

// Deliberately process-memory only. A resolver represents a short-lived MFA
// sign-in transaction and must never be serialized to app storage.
let pendingSignInResolver: MultiFactorResolver | null = null;

function requireCurrentUser() {
  const user = auth.currentUser;
  if (!user) throw new TotpMfaPocServiceError('userMissing');
  return user;
}

function requireValidCode(code: string): string {
  const normalized = code.trim();
  const issue = validateTotpCode(normalized);
  if (issue) throw new TotpMfaPocServiceError(issue);
  return normalized;
}

function summarizeFactor(factor: MultiFactorInfo): TotpFactorSummary {
  return {
    uid: factor.uid,
    factorId: factor.factorId,
    displayName: factor.displayName,
    enrollmentTime: factor.enrollmentTime,
  };
}

export function getEnrolledTotpFactorsPoc(): TotpFactorSummary[] {
  const user = requireCurrentUser();
  return selectTotpHints(multiFactor(user).enrolledFactors).map(summarizeFactor);
}

export async function startTotpEnrollmentPoc(): Promise<TotpEnrollmentDraft> {
  const user = requireCurrentUser();
  if (!user.emailVerified) {
    throw new TotpMfaPocServiceError('emailUnverified');
  }

  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const accountName = user.email ?? user.uid;

  return {
    userUid: user.uid,
    secret,
    secretKey: secret.secretKey,
    otpAuthUri: secret.generateQrCodeUrl(accountName, POC_ISSUER),
    hashingAlgorithm: secret.hashingAlgorithm,
    codeLength: secret.codeLength,
    codeIntervalSeconds: secret.codeIntervalSeconds,
    enrollmentCompletionDeadline: secret.enrollmentCompletionDeadline,
  };
}

export async function finishTotpEnrollmentPoc(
  draft: TotpEnrollmentDraft,
  code: string,
): Promise<TotpFactorSummary[]> {
  const user = requireCurrentUser();
  if (user.uid !== draft.userUid) {
    throw new TotpMfaPocServiceError('invalidSession');
  }

  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
    draft.secret,
    requireValidCode(code),
  );
  await multiFactor(user).enroll(assertion, POC_FACTOR_DISPLAY_NAME);
  return getEnrolledTotpFactorsPoc();
}

export function captureTotpMfaSignInPoc(error: unknown): TotpSignInChallenge {
  pendingSignInResolver = null;
  const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
  if (resolver.hints.length === 0) {
    throw new TotpMfaPocServiceError('resolverWithoutHints');
  }

  const hints = selectTotpHints(resolver.hints);
  if (hints.length === 0) {
    throw new TotpMfaPocServiceError('totpFactorMissing');
  }

  pendingSignInResolver = resolver;
  return { hints: hints.map(summarizeFactor) };
}

export async function resolveTotpMfaSignInPoc(
  hintUid: string,
  code: string,
): Promise<UserCredential> {
  const resolver = pendingSignInResolver;
  if (!resolver) throw new TotpMfaPocServiceError('invalidSession');

  const hint = selectTotpHints(resolver.hints).find(
    (candidate) => candidate.uid === hintUid,
  );
  if (!hint) throw new TotpMfaPocServiceError('totpFactorMissing');

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    hint.uid,
    requireValidCode(code),
  );
  const credential = await resolver.resolveSignIn(assertion);
  pendingSignInResolver = null;
  return credential;
}

export function clearPendingTotpMfaSignInPoc(): void {
  pendingSignInResolver = null;
}
