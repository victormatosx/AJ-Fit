import type { AuthCredential } from 'firebase/auth';

/** Normalized result every social provider returns. */
export type ProviderResult = {
  credential: AuthCredential;
  /** Best-effort display name from the provider (Apple only sends it once). */
  displayName?: string | null;
};

/** Thrown when the user cancels the native sign-in sheet. Handled silently. */
export class SocialAuthCancelledError extends Error {
  constructor() {
    super('Social sign-in cancelled');
    this.name = 'SocialAuthCancelledError';
  }
}
