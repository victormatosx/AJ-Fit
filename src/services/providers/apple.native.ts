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
 * Opens the native Sign in with Apple sheet. Shared by `getAppleCredential`
 * (login/reauth — unchanged contract) and
 * `getAppleCredentialForAccountDeletion` (Fase 3 — additionally surfaces
 * `authorizationCode`), so the nonce/cancellation handling is defined
 * exactly once. Returns the RAW Apple credential — callers decide what to
 * extract from it, so a caller that doesn't need `authorizationCode` (every
 * caller except account deletion) never sees it in its own return type.
 *
 * Security: a random nonce is generated per call; its SHA-256 is sent to
 * Apple and the raw value is passed to Firebase, which binds the id token to
 * this request (prevents replay). Throws `SocialAuthCancelledError` when the
 * user cancels.
 */
async function performAppleSignIn(
  requestProfile: boolean,
): Promise<{ raw: AppleAuthentication.AppleAuthenticationCredential; rawNonce: string }> {
  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  try {
    const raw = await AppleAuthentication.signInAsync({
      requestedScopes: requestProfile
        ? [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ]
        : [],
      nonce: hashedNonce,
    });
    return { raw, rawNonce };
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
  const { raw, rawNonce } = await performAppleSignIn(requestProfile);

  if (!raw.identityToken) {
    throw new ProviderCredentialError('identityTokenMissing');
  }

  const provider = new OAuthProvider('apple.com');
  const firebaseCredential = provider.credential({
    idToken: raw.identityToken,
    rawNonce,
  });

  // Apple only returns the name on the FIRST authorization.
  const fullName = requestProfile ? raw.fullName : null;
  const displayName = fullName
    ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ').trim()
    : null;

  return { credential: firebaseCredential, displayName: displayName || null };
}

/**
 * Result of `getAppleCredentialForAccountDeletion` — a distinct, explicitly
 * typed shape (never merged into the general-purpose `ProviderResult`) so
 * that no OTHER caller of Apple sign-in starts receiving
 * `authorizationCode` just by virtue of sharing a type. Only the account
 * deletion flow (`src/services/accountDeletionProviderRevocation.ts`) ever
 * imports this type.
 */
export type AppleCredentialForAccountDeletionResult = ProviderResult & {
  /**
   * Single-use, Apple-documented ~5-minute-lived authorization code. This
   * function is the ONLY place in the codebase that reads
   * `credential.authorizationCode` off the native Apple result (confirmed
   * available on the type — `expo-apple-authentication`'s
   * `AppleAuthenticationCredential.authorizationCode` — but discarded by
   * `getAppleCredential` above, exactly as the Fase 0/2 audits found).
   * The caller must hand this to the account-deletion flow immediately and
   * must never store it in AsyncStorage/SecureStore/Firestore/state that
   * outlives the current request, log it, or include it in any error
   * message — see `docs/25_exclusao_de_conta_arquitetura.md`'s Fase 3
   * section.
   */
  authorizationCode: string;
};

/**
 * Opens the native Sign in with Apple sheet specifically to capture a FRESH
 * `authorizationCode` for the account-deletion provider-revocation flow
 * (Fase 3). Never requests profile scopes — like reauthentication, this
 * call exists to prove/capture identity material, not to collect profile
 * data. Distinct function (not a flag on `getAppleCredential`) so the
 * sensitive field only ever appears in the type of a caller that asked for
 * it by name.
 */
export async function getAppleCredentialForAccountDeletion(): Promise<AppleCredentialForAccountDeletionResult> {
  const { raw, rawNonce } = await performAppleSignIn(false);

  if (!raw.identityToken) {
    throw new ProviderCredentialError('identityTokenMissing');
  }
  if (!raw.authorizationCode) {
    throw new ProviderCredentialError('authorizationCodeMissing');
  }

  const provider = new OAuthProvider('apple.com');
  const firebaseCredential = provider.credential({
    idToken: raw.identityToken,
    rawNonce,
  });

  return {
    credential: firebaseCredential,
    displayName: null,
    authorizationCode: raw.authorizationCode,
  };
}
