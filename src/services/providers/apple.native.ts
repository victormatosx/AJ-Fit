import { OAuthProvider } from 'firebase/auth';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  ProviderCredentialError,
  SocialAuthCancelledError,
  type AppleCredentialOptions,
  type ProviderResult,
} from './types';

/** Whether Sign in with Apple is available on this device (iOS 13+). */
export async function isAppleAuthAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

function randomNonce(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._';
  const bytes = Crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Opens the native Sign in with Apple sheet and returns a Firebase credential.
 *
 * Security: a random nonce is generated; its SHA-256 is sent to Apple and the
 * raw value is passed to Firebase, which binds the id token to this request
 * (prevents replay). Throws `SocialAuthCancelledError` when the user cancels.
 */
export async function getAppleCredential(
  options: AppleCredentialOptions = {},
): Promise<ProviderResult> {
  const requestProfile = options.requestProfile !== false;
  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: requestProfile
        ? [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ]
        : [],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      throw new ProviderCredentialError('identityTokenMissing');
    }

    const provider = new OAuthProvider('apple.com');
    const firebaseCredential = provider.credential({
      idToken: credential.identityToken,
      rawNonce,
    });

    // Apple only returns the name on the FIRST authorization.
    const fullName = requestProfile ? credential.fullName : null;
    const displayName = fullName
      ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ').trim()
      : null;

    return { credential: firebaseCredential, displayName: displayName || null };
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') {
      throw new SocialAuthCancelledError();
    }
    throw err;
  }
}
