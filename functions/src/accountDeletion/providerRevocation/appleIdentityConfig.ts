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
 * These four values are Apple Developer Portal artifacts (Services ID,
 * Team ID, Sign in with Apple private key + its Key ID) that must be
 * provisioned once, by a human, via
 * `firebase functions:secrets:set APPLE_TEAM_ID` (etc.) — this module
 * cannot create them, and none of this phase's work created or altered any
 * such secret value. Bound to the `requestAccountDeletion` Cloud Function
 * in `index.ts`, exactly like RevenueCat's secrets are bound to
 * `revenueCatWebhook`.
 */
export const APPLE_TEAM_ID = defineSecret('APPLE_TEAM_ID');
export const APPLE_KEY_ID = defineSecret('APPLE_KEY_ID');
export const APPLE_SERVICES_CLIENT_ID = defineSecret('APPLE_SERVICES_CLIENT_ID');
export const APPLE_PRIVATE_KEY = defineSecret('APPLE_PRIVATE_KEY');

/** Fresh client secret JWT per call (see `appleClientSecret.ts`'s doc comment on why this is cheap and deliberately not cached). */
export function createAppleIdentityClient(): AppleIdentityClient {
  const clientId = APPLE_SERVICES_CLIENT_ID.value();
  const clientSecret = generateAppleClientSecret({
    teamId: APPLE_TEAM_ID.value(),
    keyId: APPLE_KEY_ID.value(),
    clientId,
    privateKeyPem: APPLE_PRIVATE_KEY.value(),
  });
  return new AppleIdentityClient({ clientId, clientSecret });
}
