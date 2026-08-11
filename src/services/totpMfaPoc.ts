import {
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  selectTotpFactors,
  validateTotpCode,
  type MfaTotpIssue,
} from '../lib/mfaTotp';

// Temporary Phase 1 challenge bridge. Phase 3 will replace it with the
// provider-complete production sign-in architecture.
export class TotpMfaPocServiceError extends Error {
  readonly issue: MfaTotpIssue;

  constructor(issue: MfaTotpIssue) {
    super(issue);
    this.name = 'TotpMfaPocServiceError';
    this.issue = issue;
  }
}

export type TotpFactorSummary = {
  uid: string;
  factorId: string;
  displayName: string | null;
  enrollmentTime: string;
};

export type TotpSignInChallenge = {
  hints: TotpFactorSummary[];
};

// Deliberately process-memory only. A resolver represents a short-lived MFA
// sign-in transaction and must never be serialized to app storage.
let pendingSignInResolver: MultiFactorResolver | null = null;

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
    displayName: factor.displayName ?? null,
    enrollmentTime: factor.enrollmentTime,
  };
}

export function captureTotpMfaSignInPoc(error: unknown): TotpSignInChallenge {
  pendingSignInResolver = null;
  const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
  if (resolver.hints.length === 0) {
    throw new TotpMfaPocServiceError('resolverWithoutHints');
  }

  const hints = selectTotpFactors(resolver.hints);
  if (hints.length === 0) {
    throw new TotpMfaPocServiceError('factorNotFound');
  }

  pendingSignInResolver = resolver;
  return { hints: hints.map(summarizeFactor) };
}

export async function resolveTotpMfaSignInPoc(
  hintUid: string,
  code: string,
): Promise<UserCredential> {
  const resolver = pendingSignInResolver;
  if (!resolver) throw new TotpMfaPocServiceError('sessionExpired');

  const hint = selectTotpFactors(resolver.hints).find(
    (candidate) => candidate.uid === hintUid,
  );
  if (!hint) throw new TotpMfaPocServiceError('factorNotFound');

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
