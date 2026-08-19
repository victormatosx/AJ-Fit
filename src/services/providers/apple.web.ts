import {
  ProviderCredentialError,
  type AppleCredentialOptions,
  type ProviderResult,
} from './types';

/**
 * Web stub — native Sign in with Apple is not available in the web bundle.
 * Social login is a native (iOS) feature.
 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  return false;
}

export async function getAppleCredential(
  _options: AppleCredentialOptions = {},
): Promise<ProviderResult> {
  throw new ProviderCredentialError('providerUnavailable');
}

/** Fase 3 — account deletion provider revocation. Web stub: never available. */
export async function getAppleCredentialForAccountDeletion(): Promise<
  ProviderResult & { authorizationCode: string }
> {
  throw new ProviderCredentialError('providerUnavailable');
}
