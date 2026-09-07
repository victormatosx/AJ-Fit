# Push Notifications — Phase 1 foundation

## Scope

This phase installs only the delivery foundation and the fixed, admin-only
`QA_TEST` probe. No workout, progression, photo, assessment, billing or
subscription event is connected to the dispatcher.

## Data flow

1. A native installation keeps a random installation id and secret in
   SecureStore.
2. The authenticated client calls `syncPushDevice` with the current OS
   permission, Expo/native tokens, a persisted session-binding id and the
   expected ownership version.
3. The backend stores:
   - private installation proof/lease in `pushInstallations`;
   - the raw Expo token only in `pushTokenOwners`;
   - a raw-token-free projection in `users/{uid}/devices`.
4. A typed content builder feeds preference policy, semantic idempotency,
   a fenced dispatch claim and paginated device eligibility.
5. Only `expoPushClient.ts` calls Expo. Tickets become per-device deliveries.
6. Scheduled workers retry transient dispatch failures and reconcile receipts.
   Both have transactional claims/fencing and bounded attempts. A final
   `MessageRateExceeded` receipt schedules a new send with backoff; a missing
   receipt is rechecked without resending and becomes explicitly exhausted.
7. `DeviceNotRegistered` updates the delivery and deletes its raw token in the
   same transaction, only when uid, installation, token hash and ownership
   version still match the original delivery.

Logout never waits for network. A release contains the last ownership version;
a late A release after B binds is a no-op. App Check is enforced on the callable,
and the high-entropy installation proof limits an unauthenticated post-logout
release to that exact installation/version.

Sync is also compare-and-swap fenced. If two identities overlap in flight, a
stale ownership version performs no write. The still-current client may retry
once using the returned version; a client operation whose local auth generation
has already changed cannot retry, so delayed A sync cannot reclaim B's device.

## Retention and TTL

Code writes `expireAt` on released installations, dispatches and deliveries.
`firestore.indexes.json` contains the TTL field overrides needed for:

- `pushInstallations.expireAt` (30 days after release);
- active `pushInstallations`, private `pushTokenOwners` and user `devices`
  expire with their 30-day lease if the app never renews it;
- `notificationDispatches.expireAt` (90 days);
- `deliveries.expireAt` (90 days).

No TTL configuration was applied in this phase. Review retention with the
privacy/operations owner, deploy indexes/TTL in the intended non-production
project first, and verify that subcollection TTL is active before production.

## Optional Expo access-token security

The server reads an optional `EXPO_ACCESS_TOKEN` only from its backend
environment. Local development does not require it. If Expo enhanced push
security is enabled later, provision the value through the project's secret
manager and explicitly bind it to the deployed functions; never put it in an
Expo public variable, source file or client configuration.

## Native configuration

- Expo SDK 56 resolved `expo-notifications~56.0.25`.
- `ajfit_general` is the default/general channel.
- Rest Activity keeps its existing `rest_timer` channel.
- Background remote notifications are disabled.
- No notification icon was configured: `assets/aj-logo.png` was not assumed
  to be a valid monochrome Android status-bar asset. Design must provide one
  before release if the default application icon is not acceptable.

## Local validation

```sh
npm run typecheck
npm run lint
npm test
npm --prefix functions run typecheck
npm --prefix functions test
npm run test:rules:firestore
firebase emulators:exec --only firestore --project ajfit-rules-test   'cd functions && PUSH_FOUNDATION_INTEGRATION=1 npx vitest run src/notifications/__tests__/foundation.integration.test.ts'
```

## Physical-device QA still required

Use a development build; Android remote push is not available in Expo Go.

- provision APNs and FCM credentials for the QA project;
- test first prompt, denial, system-settings re-enable and revocation;
- validate foreground/background/terminated receipt behavior on iOS/Android;
- verify token refresh, reinstall, multiple devices and A→B account switch;
- verify `rest_timer` still presents independently from `ajfit_general`;
- run the fixed DEV console hooks only with an authenticated admin account:
  `__AJFIT_PUSH_QA__.requestPermissionAndGetToken()`, then
  `__AJFIT_PUSH_QA__.sendSelfTestNotification()`.

No deployment, secret creation, TTL activation or real-user push belongs to
this phase.
