import type { AuthCredential } from 'firebase/auth';

/** Normalized result every social provider returns. */
export type ProviderResult = {
  credential: AuthCredential;
  /** Best-effort display name from the provider (Apple only sends it once). */
  displayName?: string | null;
};

export type AppleCredentialOptions = {
  /** Login requests profile data; reauthentication deliberately does not. */
  requestProfile?: boolean;
};

export type ProviderCredentialIssue =
  | 'providerUnavailable'
  | 'providerBusy'
  | 'identityTokenMissing'
  /** Apple did not return `authorizationCode` — only ever checked by `getAppleCredentialForAccountDeletion` (Fase 3); ordinary login/reauth never requests or needs this field. */
  | 'authorizationCodeMissing';

/** Safe provider acquisition failure without exposing tokens or credentials. */
export class ProviderCredentialError extends Error {
  readonly issue: ProviderCredentialIssue;

  constructor(issue: ProviderCredentialIssue) {
    super(issue);
    this.name = 'ProviderCredentialError';
    this.issue = issue;
  }
}

/** Thrown when the user cancels the native sign-in sheet. Handled silently. */
export class SocialAuthCancelledError extends Error {
  constructor() {
    super('Social sign-in cancelled');
    this.name = 'SocialAuthCancelledError';
  }
}
