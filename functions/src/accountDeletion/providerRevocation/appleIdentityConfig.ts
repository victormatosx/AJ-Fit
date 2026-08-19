import { defineSecret } from 'firebase-functions/params';

import { generateAppleClientSecret } from './appleClientSecret';
import { AppleIdentityClient } from './appleIdentityClient';

/**
 * Secret Manager wiring for the REAL `AppleIdentityClient` — Fase 3/5
 * correction. `appleClientSecret.ts`/`appleIdentityClient.ts` are pure
 * functions of whatever config they're handed (Fase 3); this module is the
 * one place that actually resolves that config from backend secrets, the
 * same pattern `billing/revenueCatApi.ts`'s `createRevenueCatV2Client`
 * already establishes for `REVENUECAT_API_SECRET_KEY`.
 *
 * These values are Apple Developer Portal artifacts (Services ID, Bundle/App
 * ID, Team ID, Sign in with Apple private key + its Key ID) that must be
 * provisioned once, by a human, via
 * `firebase functions:secrets:set APPLE_TEAM_ID` (etc.) — this module
 * cannot create them, and none of this phase's work created or altered any
 * such secret value. Bound to the `requestAccountDeletion`/
 * `cleanupPendingAccountDeletions`/`onAccountDeletionRequested` Cloud
 * Functions in `index.ts`, exactly like RevenueCat's secrets are bound to
 * `revenueCatWebhook`.
 */
export const APPLE_TEAM_ID = defineSecret('APPLE_TEAM_ID');
export const APPLE_KEY_ID = defineSecret('APPLE_KEY_ID');
export const APPLE_PRIVATE_KEY = defineSecret('APPLE_PRIVATE_KEY');

/**
 * Fase 15 incident fix: Apple's `/auth/token`/`/auth/revoke` require the
 * `client_id` (and the client_secret JWT's `sub`) to match whichever
 * identifier actually MINTED the material being exchanged/revoked — the
 * Services ID for a web/JS "Sign in with Apple" flow, or the App ID (Bundle
 * ID) for a NATIVE flow (`expo-apple-authentication`'s `signInAsync`, the
 * ONLY Apple flow this app has). This app is 100% native — every
 * `authorizationCode` this codebase ever exchanges was minted for
 * `APPLE_NATIVE_CLIENT_ID` (the Bundle ID, `com.ajfit.app`), never for the
 * Services ID. Using the Services ID here (the bug: see
 * docs/25_exclusao_de_conta_arquitetura.md's Fase 15 incident section)
 * produced a deterministic Apple rejection on every single attempt.
 *
 * `APPLE_SERVICES_CLIENT_ID` is kept, unused by any current caller,
 * SEPARATE from this — a future web/JS Sign in with Apple flow (if this app
 * ever adds one) would need it, and conflating the two identifiers is
 * exactly the class of bug this fix exists to prevent. Nothing here
 * infers/accepts a client_id from the client app — both identifiers are
 * backend secrets, never client-supplied.
 */
export const APPLE_NATIVE_CLIENT_ID = defineSecret('APPLE_NATIVE_CLIENT_ID');
export const APPLE_SERVICES_CLIENT_ID = defineSecret('APPLE_SERVICES_CLIENT_ID');

export type AppleClientIdSource = 'native' | 'services';

/** Resolves which configured identifier backs a given Apple REST call — never a client-supplied value. */
export function resolveAppleClientId(source: AppleClientIdSource): string {
  return source === 'native' ? APPLE_NATIVE_CLIENT_ID.value() : APPLE_SERVICES_CLIENT_ID.value();
}

/**
 * Fresh client secret JWT per call (see `appleClientSecret.ts`'s doc comment
 * on why this is cheap and deliberately not cached). `source` defaults to
 * `'native'` — the only Apple flow this app has today; every current caller
 * (`requestAccountDeletion.ts`'s exchange, `reconciliation/dispatcher.ts`'s
 * revoke) passes it explicitly rather than relying on the default, so a
 * future web-flow caller can never accidentally inherit the native identity
 * by omission.
 */
export function createAppleIdentityClient(source: AppleClientIdSource = 'native'): AppleIdentityClient {
  const clientId = resolveAppleClientId(source);
  const clientSecret = generateAppleClientSecret({
    teamId: APPLE_TEAM_ID.value(),
    keyId: APPLE_KEY_ID.value(),
    clientId,
    privateKeyPem: APPLE_PRIVATE_KEY.value(),
  });
  return new AppleIdentityClient({ clientId, clientSecret });
}
