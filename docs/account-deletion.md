# Account Deletion ("Excluir Conta") — Current Architecture

> This is the **current-state** reference. For phase-by-phase history, incident
> writeups, and the reasoning behind superseded designs, see
> [`25_exclusao_de_conta_arquitetura.md`](./25_exclusao_de_conta_arquitetura.md).
> If the two ever disagree, this document wins — it reflects what is deployed.
>
> Status as of this writing: **E2E-validated in production for all three
> providers** (Email/Password, Apple, Google). Project: `ajfit-2f321`.

## 1. Visão geral

"Excluir Conta" is a single client-initiated request that durably commits a
deletion intent, then a fully backend-autonomous workflow (immediate trigger +
15-minute scheduled fallback) works through 8 steps to hard-delete or retain
every category of user data per a frozen, versioned policy, ending with
Firebase Auth user removal.

**One official path, no alternates:**

```
UI (DeleteAccountScreen)
  → reauth (accountDeletionReauth.ts)
  → provider preparation (Google unlink; Apple material captured during reauth)
  → accountDeletionOrchestrator.ts (commit boundary)
  → requestAccountDeletion (callable)
      → transaction: accountDeletions/{deletionId} + accountDeletionLocks/{uid}
  → onAccountDeletionRequested (Firestore onCreate trigger, immediate)
      ↘ processAccountDeletionRecord() → steps → COMPLETED
  → cleanupPendingAccountDeletions (Scheduler, every 15min, FALLBACK ONLY)
      ↘ same processAccountDeletionRecord()
```

There is no other entry point into the destructive workflow. The client never
calls a step executor directly, and the Scheduler is not the normal path.

## 2. Fluxo client

Files: `src/screens/DeleteAccountScreen.tsx` (presentation only) →
`src/hooks/useAccountDeletionFlow.ts` (all state/orchestration) →
`src/services/accountDeletionReauth.ts` (password/Google/Apple/MFA reauth) →
`src/services/accountDeletionProviderRevocation.ts` (Google-only prep) →
`src/services/accountDeletionOrchestrator.ts` (the ONLY caller of the
`requestAccountDeletion` callable) → `src/services/accountDeletionShutdown.ts`
(local cleanup + logout, only after backend acceptance).

Steps (`AccountDeletionFlowStep`): `intro → reauth → confirm → submitting`.
`reauth` is skipped only when `needsAccountDeletionReauthentication()`
resolves `false` — which is **always `true` for an Apple-linked account**
regardless of session freshness (Fase 16 — see §6).

## 3. Fluxo backend

`functions/src/accountDeletion/`:

- `requestAccountDeletion.ts` — `onCall`. Validates payload (closed allowlist,
  `requestContract.ts`), requires recent-auth (`lib/auth.ts`'s
  `requireRecentAuth`, 5-minute window), resolves linked providers server-side
  (`admin.auth().getUser(uid)`), exchanges a fresh Apple `authorizationCode`
  if `apple.com` is linked, then durably creates `accountDeletions/{deletionId}`
  + `accountDeletionLocks/{uid}` in one transaction (`repository.ts`).
  Deduplicates per-uid (repeat calls reuse the existing non-terminal/terminal
  record, never spawn a second one).
- `immediateDispatch.ts` — `onAccountDeletionRequested`, a Firestore
  `onDocumentCreated` trigger on `accountDeletions/{deletionId}`. Fires
  exactly once per real new request (never on the dedup path) and calls
  `processAccountDeletionRecord()`. This is what makes deletion start
  immediately instead of waiting up to 15 minutes.
- `reconciliation/scheduler.ts` — `cleanupPendingAccountDeletions`, `onSchedule`
  every 15 minutes UTC. Queries `REQUESTED`/`PROCESSING`/`RETRY_SCHEDULED`
  records and calls the SAME `processAccountDeletionRecord()`. Second line of
  defense only — retries, stuck records, missed/failed immediate dispatch.
- `reconciliation/processRecord.ts` — the one engine both entry points call.
  Lease + CAS protected (see §4), advances up to 5 steps per invocation,
  checkpoints after every single step.
- `reconciliation/dispatcher.ts` — maps a step name to its executor. Zero
  business logic of its own.

## 4. State machine / concorrência

`stateMachine.ts` / `concurrency.ts` / `steps.ts` (Fase 1, unchanged since).
Global status: `REQUESTED → PROCESSING → (RETRY_SCHEDULED ⇄ PROCESSING) →
COMPLETED | FAILED_TERMINAL`. Each step has its own status
(`PENDING/RUNNING/SUCCEEDED/SKIPPED_BY_POLICY/FAILED_RETRYABLE/FAILED_TERMINAL`).

Concurrency: a short-lived lease (`tryAcquireReconciliationLease`) plus a
`revision`-based compare-and-set on every persisted write
(`persistAccountDeletionRecordChange`). Two callers racing the same
`deletionId` (e.g. the immediate trigger and the scheduler picking it up in
the same window) — exactly one makes progress, the other observes
`LEASE_HELD` and returns; proven by
`functions/src/accountDeletion/reconciliation/__tests__/concurrentDispatch.test.ts`.

## 5. Steps (ordem canônica, imutável)

```
ACCOUNT_ACCESS_LOCK → PROVIDER_REVOCATION → VAULT_KEY_DESTRUCTION →
FIRESTORE_CLEANUP → STORAGE_CLEANUP → RETAINED_DATA_PROCESSING →
REVENUECAT_PROCESSING → AUTH_DELETION
```

`ACCOUNT_ACCESS_LOCK` is always first (nothing else may run before the
account is locked). `AUTH_DELETION` is always last (Firebase Auth stays a
useful reconciliation anchor until everything else is done).
`VAULT_KEY_DESTRUCTION` is the **point of no return**
(`steps.ts`'s `POINT_OF_NO_RETURN_STEP`) and precedes both cleanup steps.
These invariants are pinned by
`functions/src/accountDeletion/__tests__/architecturalInvariants.test.ts`.

## 6. Apple

Single native `AppleAuthentication.signInAsync()` call per attempt
(`src/services/providers/apple.native.ts`'s `getAppleCredentialForAccountDeletion`),
invoked from `accountDeletionReauth.ts`'s `startAppleAccountDeletionReauthentication`
— the SAME call that proves Firebase recent-auth also returns the
`authorizationCode` the backend needs. No second sheet. The code lives ONLY
in a React `useRef` on the client (`useAccountDeletionFlow.ts`), consumed and
cleared before the network call (single-use, never resent on retry), and is
discarded on cancel/back/abandon.

Backend exchange (`providerRevocation/appleIdentityConfig.ts`): the
`client_id` used for `/auth/token` and `/auth/revoke` MUST match whichever
identifier minted the material — `APPLE_NATIVE_CLIENT_ID` (the Bundle ID,
`com.ajfit.app`) for this app's native-only flow, never
`APPLE_SERVICES_CLIENT_ID` (kept, unused today, for a hypothetical future web
flow — see incident history in the historical doc, "Fase 15"). Revocation
(`reconciliation/dispatcher.ts` → `appleProviderRevocation.ts`) reuses the
same `'native'` client for the same reason.

## 7. Google

Client-only: `revokeGoogleProviderAccess`
(`src/services/accountDeletionProviderRevocation.ts`) calls
`GoogleSignin.revokeAccess()` + Firebase `unlink('google.com')`, BEFORE
`requestAccountDeletion` is ever called. No backend Google revocation exists
or is needed — by the time the backend snapshots `providerData`, a
successfully-unlinked account already shows `google.com` absent, which
`PROVIDER_REVOCATION`'s policy resolves as `SKIPPED_BY_POLICY` at record
creation. If unlink races/fails and `google.com` is still linked at snapshot
time, `dispatcher.ts`'s `runProviderSubStep` fails it
`MISSING_REQUIRED_CONFIGURATION` (terminal, operator-visible) — a defensive
fallback, not the normal path.

## 8. Firestore (DELETE)

`firestoreCleanup/resources.ts`: `users/{uid}` profile doc (non-recursive —
`privateSecurity` survives), `questionnaires`, `assessments`,
`progressPhotos` metadata. Never touches `supportTickets`/`couponRedemptions`
(policy: RETAIN) or `accountDeletions`/`accountDeletionLocks` (control plane,
never touched by any cleanup engine).

## 9. Storage (DELETE)

`storageCleanup/resources.ts`, allowlist not blacklist: `users/{uid}/profile/`
(avatar) and `users/{uid}/progressPhotos/` (ciphertext + thumbnails).
`users/{uid}/support/*` is never referenced in this file — structurally
unreachable from it.

## 10. RevenueCat

Policy v1: `SKIP` — `revenueCatProcessing/engine.ts` makes **zero** RevenueCat
API calls, ever; reports `SKIPPED_BY_POLICY`. The subscription itself is
NEVER cancelled by account deletion — this is surfaced to the user in the
intro screen ("Deleting your account does not cancel your subscription") with
a "Manage subscription" action still available. Client-side: `SubscriptionContext`
reacts to `useAuth().user` becoming `null` (logout, part of
`finalizeAccountDeletionClientShutdown`) and calls `logoutRevenueCat()` +
detaches the customer-info listener on its own — no new code needed for this.
Webhook fail-closed: `billing/subscriptionSync.ts`'s `validFirebaseUserExists`
guard means a late webhook for an already-deleted uid never resurrects
`users/{uid}` — dedicated proof in
`functions/src/billing/__tests__/accountDeletionLateWebhook.test.ts`.

## 11. Retention policy (v1, frozen per record at creation)

| Category | Action | Where |
|---|---|---|
| Firebase Auth | DELETE (last step) | `authDeletion.ts` |
| `users/{uid}` | DELETE | `firestoreCleanup/resources.ts` |
| `questionnaires` | DELETE | same |
| `assessments` | DELETE | same |
| `progressPhotos` (Firestore metadata) | DELETE | same |
| `privateSecurity/photoVault` (Vault key) | CRYPTO-SHRED (delete wrapped DEK doc) | `vaultKeyDestruction.ts` |
| avatar (Storage) | DELETE | `storageCleanup/resources.ts` |
| progress photos ciphertext+thumbnails (Storage) | DELETE | same |
| `supportTickets` + messages + attachments | RETAIN | `retainedDataProcessing/support.ts` |
| `couponRedemptions/{uid}` | RETAIN | `retainedDataProcessing/couponRedemptions.ts` |
| RevenueCat customer identity | SKIP (no API call) | `revenueCatProcessing/engine.ts` |
| Apple provider link | REVOKE (server-side token revoke) | `providerRevocation/appleProviderRevocation.ts` |
| Google provider link | REVOKE + unlink (client-side, pre-commit) | `accountDeletionProviderRevocation.ts` |
| local: onboarding draft, workout substitutions, units pref, Vault thumbnail cache | LOCAL CLEAR | `accountDeletionShutdown.ts` |
| local: language preference | RETAIN (deliberate device preference) | not touched by design |

Policy is **frozen on the record at creation** (`record.policy`) — a step
executor always applies `record.policy.retention`, never `currentPolicy()` —
so changing the policy for future deletions never rewrites the meaning of an
in-flight or historical record. This is enforced by
`policy.test.ts` (`AUTH_DELETION`/`VAULT_KEY_DESTRUCTION` can never be
dropped from `requiredSteps`, exactly 8 required steps).

## 12. Local cleanup

`src/services/accountDeletionShutdown.ts`, best-effort, parallel, never
blocks logout: Photo Vault thumbnail cache, onboarding draft, workout
substitution preferences, units preference. Vault key + secure session
already cleared by ordinary `signOutUser()`/`logout()`. Language is
deliberately excluded (device preference). "Conta A → Conta B on the same
device never sees A's data" is covered by this clearing plus per-uid
namespacing/reconciliation elsewhere (Photo Vault gallery, units).

Minor known residual (non-privacy-sensitive): `photoVaultContentPresence.ts`'s
one-bit "has vault content" AsyncStorage hint is uid-namespaced but not
explicitly cleared on deletion — it stores no PII and a different uid can
never read it, so it is an inert orphaned key, not a leak.

## 13. Security invariants

- **Identity**: uid comes exclusively from `request.auth.uid`
  (Firebase-verified token) at every layer; the wire contract
  (`requestContract.ts`'s `RequestAccountDeletionRequestData`) has no uid
  field at all — nothing for a payload to even smuggle. `validateRequestAccountDeletionPayload`
  is a closed allowlist (only `appleAuthorizationCode` permitted).
- **Recent-auth**: mandatory, backend-authoritative (`requireRecentAuth`,
  5-minute window on `request.auth.token.auth_time` — never client-supplied
  freshness). Client-side `hasRecentAuth` (4-minute window) only decides
  whether to skip the UI prompt; it grants nothing.
- **Apple material**: `authorizationCode`/`identityToken` never persisted
  client-side (memory-only `useRef`, cleared on consume/abandon/reset), never
  logged (backend logs a closed-enum `appleErrorClass`, never the raw code —
  `lib/logger.ts`'s `code`-key blanket redaction is preserved). Apple refresh
  token is backend-only, KMS-wrapped at rest (`appleTokenCrypto.ts`), in a
  KMS key ring SEPARATE from the Photo Vault KEK (§16).
- **Account lock**: `ACCOUNT_ACCESS_LOCK` disables the Auth user + revokes
  refresh tokens; Firestore/Storage Rules additionally gate on
  `accountActive(uid)` (`!exists(accountDeletionLocks/{uid})`) for the ~1h
  window an already-issued ID token can still be used — fail-closed by
  default, deny-all on the control-plane collections themselves.
- **Worker**: only ever acts on an EXISTING `accountDeletions/{deletionId}`
  record — never infers deletion intent from Auth/data absence. CAS +
  revision + lease protect concurrency; every executor is idempotent
  (retrying a partially-done step never double-executes a destructive
  action).

## 14. Retry / reconciliation

`policy.ts`'s `retry` (exponential backoff, `initialDelayMs: 30_000`,
`maxDelayMs: 6h`, `maxAttempts: 8`). A step's own backoff — not Eventarc
redelivery — governs retry timing; `onAccountDeletionRequested` has
`retry: true` only so a genuinely-thrown exception (not a normal
`RETRY_SCHEDULED` outcome) gets redelivered, and even total Eventarc failure
is safe: the record stays `REQUESTED`/durable and the 15-minute Scheduler
always finds it independently.

## 15. Observability

Structured logs only (`lib/logger.ts`), scoped `[accountDeletion.*]`. Never
logs raw errors/objects — `logFunctionError` only ever logs a classified
`code` string, never `err.message`/`err.stack`. Client-side deletion path
(`accountDeletionReauth.ts`, `accountDeletionOrchestrator.ts`,
`useAccountDeletionFlow.ts`) has **zero** logging calls at all — errors are
mapped to a closed enum and shown to the user, never logged.

Event names to grep in Cloud Logging: `account_deletion_immediate_dispatch_started/finished`,
`account_deletion_reconciliation_started/completed/skipped`,
`account_deletion_step_started/step_succeeded/retry_scheduled/terminal_failure`.

## 16. Secrets / configuration

All in Secret Manager, project `ajfit-2f321`, bound to `requestAccountDeletion`
/ `cleanupPendingAccountDeletions` / `onAccountDeletionRequested`:

| Secret | Purpose |
|---|---|
| `APPLE_TEAM_ID` | 10-char Apple Developer Team ID — `iss` claim of the client_secret JWT. |
| `APPLE_KEY_ID` | 10-char ID of the Sign in with Apple private key registered in Apple Developer — `kid` header of the JWT. |
| `APPLE_NATIVE_CLIENT_ID` | The app's **Bundle ID** (`com.ajfit.app`). Used as `client_id`/`sub` for exchanging/revoking material minted by the NATIVE iOS Sign in with Apple flow — the only flow this app has. |
| `APPLE_SERVICES_CLIENT_ID` | The **Services ID** (`com.ajfit.app.service`). NOT used by any current code path — reserved for a hypothetical future WEB Sign in with Apple flow, which would mint material under this identifier instead of the Bundle ID. |
| `APPLE_PRIVATE_KEY` | PEM-encoded EC (P-256) private key — the `.p8` file content. Signs the client_secret JWT (ES256). |

**App ID / Bundle ID vs Services ID**: Apple issues two different kinds of
identifiers for Sign in with Apple. The **App ID** (Bundle ID,
`com.ajfit.app`) is what a NATIVE app's `ASAuthorizationAppleIDProvider`
mints authorization codes/tokens under. The **Services ID** is a separate
identifier you register only if you also support Sign in with Apple on the
web (a `Services ID` + registered redirect URLs). They are not
interchangeable — using the wrong one for a given code's origin makes
Apple's `/auth/token` reject with `invalid_client`/`invalid_grant`. This app
only has the native flow, so `APPLE_NATIVE_CLIENT_ID` is what's live today.

**Which Key ID matches the `.p8`**: `APPLE_KEY_ID` must be the Key ID shown
in Apple Developer → Certificates, Identifiers & Profiles → Keys for the
specific Sign in with Apple key whose `.p8` was used to populate
`APPLE_PRIVATE_KEY`. Apple lets a `.p8` be downloaded only once at creation;
if it's lost, the ONLY recovery is generating a NEW key (see rotation below).

**Rotation procedure**:
1. Apple Developer → Keys → create a NEW Sign in with Apple key (or use an
   existing spare if one was pre-provisioned) → download its `.p8` once.
2. `firebase functions:secrets:set APPLE_KEY_ID` (new Key ID) and
   `firebase functions:secrets:set APPLE_PRIVATE_KEY` (new `.p8` content,
   read from file, never pasted as a CLI arg) in project `ajfit-2f321`.
3. Redeploy `requestAccountDeletion`, `cleanupPendingAccountDeletions`,
   `onAccountDeletionRequested` (all three bind these secrets) —
   `firebase deploy --project ajfit-2f321 --only functions:requestAccountDeletion,functions:cleanupPendingAccountDeletions,functions:onAccountDeletionRequested`.
4. Old key can be revoked in Apple Developer once the new one is confirmed
   working (a real, non-destructive E2E attempt reaching `COMPLETED` for an
   Apple-linked test account).

**Impact if the key is revoked before rotation completes**: every Apple
`authorizationCode` exchange/revoke fails
(`MISSING_REQUIRED_CONFIGURATION`/`invalid_client`) — surfaced to the user as
`appleValidationFailed`, never as a false "session expired". No data is lost
or corrupted; the deletion request simply cannot complete `PROVIDER_REVOCATION`
for Apple-linked accounts until a valid key is restored. Email/Password and
Google-only deletions are entirely unaffected (they never touch these
secrets).

## 17. Key rotation (KMS)

Two KMS key rings, project `ajfit-2f321`, region `us-central1`, deliberately
SEPARATE (different security domain, different blast radius):

- `ajfit-photo-vault` / `photo-vault-kek` — wraps every user's Photo Vault DEK.
  Long-lived, shared across all users. **Never touched by account deletion
  code** — `vaultKeyDestruction.ts` only deletes the wrapped-DEK Firestore
  document, never calls KMS at all.
- `ajfit-account-deletion` / `apple-provider-revocation-kek` — wraps the
  Apple refresh token temporarily cached during `PROVIDER_REVOCATION`
  (`appleTokenCrypto.ts`). Short-lived, workflow-scoped material only.

Both: symmetric `ENCRYPT_DECRYPT`, `GOOGLE_SYMMETRIC_ENCRYPTION`, `SOFTWARE`
protection level. IAM: `roles/cloudkms.cryptoKeyEncrypterDecrypter` granted to
the project's default Cloud Functions service account
(`{project-number}-compute@developer.gserviceaccount.com`) on each key
individually — no cross-grant between the two.

No cryptographic material is ever logged, printed, or documented in plaintext
anywhere in this repository.

## 18. Firebase

- `requestAccountDeletion` — `onCall`, `us-central1`, secrets: the 4 Apple
  secrets above (excluding `APPLE_SERVICES_CLIENT_ID`).
- `onAccountDeletionRequested` — Firestore `onDocumentCreated` (Eventarc),
  `document: accountDeletions/{deletionId}`, `retry: true`, same secrets.
- `cleanupPendingAccountDeletions` — `onSchedule`, `every 15 minutes`,
  `timeZone: Etc/UTC`, `timeoutSeconds: 300`, same secrets.
- Firestore Rules: `accountDeletionLocks/{uid}` and `accountDeletions/{deletionId}`
  (+ subcollections) are `allow read, write: if false` unconditionally —
  backend (Admin SDK) only, no client path exists or is needed.
  `accountActive(userId)` gates read/write on every private
  `users/{uid}/**` path.
- Storage Rules: mirrors the same `accountActive(userId)` gate on
  avatar/progressPhotos/support-attachment paths.
- No Firestore composite indexes are required by this feature (the
  reconciliation candidate query is a single-field `in` query, auto-indexed).

## 19. Runbook

**1. Como verificar se uma exclusão está saudável?** Read
`accountDeletions/{deletionId}` in Firestore Console. Healthy = `status`
progressing (not stuck at the same value across multiple 15-minute windows)
and `updatedAt` advancing.

**2. Como encontrar deletionId por UID?** `accountDeletionLocks/{uid}` doc
has `activeDeletionId`. (Client never has a UI for this — Console/`gcloud
firestore` only.)

**3. REQUESTED?** Accepted, not yet processed by any worker. Normal only for
a few seconds/minutes after the request (immediate trigger should pick it up
right away); if it's REQUESTED for longer than one Scheduler cycle
(15+ min), see #9.

**4. PROCESSING?** A worker (immediate or scheduler) is actively advancing
steps, or was interrupted mid-way and will be picked up again (`lease`
expires after 5 minutes if the worker died).

**5. RETRY_SCHEDULED?** A step failed with a RETRYABLE code; will be retried
automatically per `policy.retry`'s exponential backoff (up to 8 attempts,
max 6h delay) by the next Scheduler tick that finds `nextAttemptAt` due. Not
an error requiring action unless it never progresses past several cycles.

**6. FAILED_TERMINAL?** A step failed with a TERMINAL code (e.g. Apple
`authorizationCode` genuinely expired/invalid, or a config problem). Read
`steps.{name}.lastErrorCode` to find which step and why. Requires
**investigation**, not automatic retry (`requestAccountDeletion` called
again for the same uid returns `requiresReconciliation: true` rather than
spawning a second record).

**7. COMPLETED?** Every required step reached `SUCCEEDED`/`SKIPPED_BY_POLICY`.
Auth user is gone, data is per the retention matrix (§11). Terminal, correct,
no action needed. A minimized copy is written to `accountDeletionAudit/{deletionId}`.

**8. Como descobrir qual step falhou?** `accountDeletions/{deletionId}.steps.{STEP_NAME}.status`
+ `.lastErrorCode` + `.lastAttemptAt`. For `PROVIDER_REVOCATION`, check
`.providerRevocation.apple.step`/`.google.step` instead.

**9. Eventarc não disparar (immediate dispatch never fires)?** Check Cloud
Functions logs for `onAccountDeletionRequested` around the record's
`createTime`. If nothing at all appears, this is a platform-level Eventarc
issue — the record is still safe: the 15-minute Scheduler will pick it up
regardless (it doesn't depend on Eventarc at all). No manual intervention
needed; just confirm the next Scheduler tick resolves it.

**10. Scheduler não executar?** Cloud Scheduler Console →
`firebase-schedule-cleanupPendingAccountDeletions-us-central1` → check
`state: ENABLED` and `lastAttemptTime`. If disabled/erroring, this is a
platform/IAM issue requiring investigation — do NOT manually trigger deletion
processing as a workaround (see #14/#15).

**11. Apple revoke falhar?** Check `steps.PROVIDER_REVOCATION.status` +
`.providerRevocation.apple.step.lastErrorCode`. `MISSING_REQUIRED_CONFIGURATION`
→ check the 4 Apple secrets are all still valid (§16). Any other terminal
code → the record needs a fresh `authorizationCode`, which only the ORIGINAL
user can provide by retrying deletion in-app; there is no admin-side retry
for Apple material.

**12. Storage cleanup falhar?** `RETRY_SCHEDULED` first (transient GCS
errors self-heal via backoff). If `FAILED_TERMINAL`, check
`steps.STORAGE_CLEANUP.lastErrorCode` — usually a permissions/quota issue on
the bucket, needs infra investigation, not a data-correctness one (the
engine is idempotent and allowlist-only, so partial progress is always safe
to resume).

**13. Auth ficar apenas disabled (não removido)?** Means `ACCOUNT_ACCESS_LOCK`
succeeded but the workflow never reached `AUTH_DELETION` (some earlier
required step is stuck). Diagnose via #8, don't manually delete the Auth
user — let the reconciler finish once the blocking step is resolved, since
deleting Auth out of order would strand cleanup steps that may still need
the uid to exist as a valid reference.

**14. Quando NÃO fazer intervenção manual?** Whenever the record is
`REQUESTED`/`PROCESSING`/`RETRY_SCHEDULED` and has been in that state for
less than ~3 Scheduler cycles (45 min) — this is normal operation, not an
incident. Also never manually re-trigger a step or call an executor
directly against a real user's record.

**15. Quais dados nunca devem ser alterados manualmente?** `accountDeletions/{deletionId}`,
`accountDeletionLocks/{uid}`, `accountDeletionAudit/{deletionId}` — these are
the control plane; any manual edit can desynchronize `revision`/CAS and
cause the reconciler to behave unpredictably. If a record is truly stuck
past all automatic retries, the fix is a code/config fix (per its
`lastErrorCode`) followed by the EXISTING reconciler picking it up — never a
hand-edited Firestore write.

## 20. Testing

- Unit (no emulator): `cd functions && npm run typecheck && npx vitest run src/accountDeletion --exclude "**/*.integration.test.ts"`.
- Client unit: `npm run typecheck && npx vitest run`.
- Rules: `npm run test:rules` (needs Java 21+ for the emulator — `JAVA_HOME=$(brew --prefix openjdk@21)` if the system default is older).
- Emulator integrations: `npm run test:integration:{firestoreCleanup,storageCleanup,retainedData,authDeletion,vaultKeyDestruction,backendAutonomy,faultInjection,accountDeletionReconciliation}`.
- Architectural invariants (regression guardrails):
  `functions/src/accountDeletion/__tests__/architecturalInvariants.test.ts`,
  `functions/src/accountDeletion/providerRevocation/__tests__/appleIdentityConfig.test.ts`,
  `functions/src/accountDeletion/reconciliation/__tests__/concurrentDispatch.test.ts`,
  `src/services/__tests__/accountDeletionOrchestrator.test.ts` (Apple-sheet invariant).

## Known limitations / decisions

- **Google server-side revoke (Option B) was rejected**: would require the
  client to request Google "offline access" (a visible extra consent
  scope) just to give the backend a revocable token. Client-side revoke
  (Option A, current) was judged sufficient; revisit only if Option A proves
  insufficient in practice.
- **`APPLE_SERVICES_CLIENT_ID` is provisioned but unused** — kept only in
  case a web Sign in with Apple flow is ever added; do not repurpose it for
  the native flow (that was the Fase 15 incident).
- **RevenueCat retention policy is `SKIP` (v1)** — a deliberate product/legal
  decision, not re-litigated by this document; changing it is a policy
  change, not a bug fix.
- **`photoVaultContentPresence.ts`'s per-uid AsyncStorage hint is not
  explicitly cleared on deletion** (§12) — accepted as a non-issue (no PII,
  uid-namespaced, unreachable by another account).
- **`firebase-functions` is on v5.x**; the Firebase CLI itself warns on every
  deploy that v6 exists with breaking changes. Not upgraded in this audit
  (no concrete failure today) — track before it becomes unsupported.
