import Constants from 'expo-constants';

/**
 * Social auth configuration (Google / Apple).
 *
 * REQUIRED NATIVE CONFIG FILES (must be at the project root and referenced in
 * app.json as `ios.googleServicesFile` / `android.googleServicesFile`):
 *   - GoogleService-Info.plist   (iOS)
 *   - google-services.json       (Android)
 * If either is missing, native Google sign-in will fail at runtime. These files
 * come from the Firebase Console → Project settings → Your apps.
 *
 * OAuth client IDs below are PUBLIC (they ship inside the app binary anyway).
 * Source of truth:
 *   - iosClientId : GoogleService-Info.plist  → CLIENT_ID
 *   - webClientId : google-services.json       → client (client_type 3 = web)
 *                   (a.k.a. the "Web application" OAuth 2.0 client in Google
 *                    Cloud Console — REQUIRED by Firebase to verify Google
 *                    id tokens)
 * They can be overridden via app.json → extra.googleWebClientId /
 * extra.googleIosClientId without touching code.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleWebClientId?: string;
  googleIosClientId?: string;
};

// Fallbacks are the values already present in this project's config files.
export const GOOGLE_WEB_CLIENT_ID =
  extra.googleWebClientId ??
  '753375043967-oldj9c61p82vni4s1n5fjkks3gueh4se.apps.googleusercontent.com';

export const GOOGLE_IOS_CLIENT_ID =
  extra.googleIosClientId ??
  '753375043967-sfm41c00upk4u0nbee451d3cs9bsbe1s.apps.googleusercontent.com';

/**
 * Throws a clear, actionable error when the Google web client id is not
 * configured — surfaces misconfiguration instead of an opaque native failure.
 */
export function assertGoogleConfig(): void {
  if (!GOOGLE_WEB_CLIENT_ID || !GOOGLE_WEB_CLIENT_ID.includes('.apps.googleusercontent.com')) {
    throw new Error(
      'Google Sign-In não configurado: defina o webClientId (client_type 3 do ' +
        'google-services.json) em app.json → extra.googleWebClientId e garanta ' +
        'que GoogleService-Info.plist / google-services.json existam.',
    );
  }
}
