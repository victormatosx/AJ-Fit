# Push notification QA preview

## Scope

This is a development-only, self-targeted visual QA surface. It does not
create workout, lifecycle, progression, billing, subscription, schedule or
achievement facts. It does not write `notificationProductWindows`.

The path is:

`Settings > Developer > Push Notifications`

→ `dispatchTestNotification` (Auth + verified-email policy + server-side admin role + App Check)

→ canonical notification builder/content policy

→ central dispatcher in `QA_PREVIEW` mode

→ Expo Push Service

→ registered devices

→ ticket/delivery/receipt/retry infrastructure.

The callable accepts exactly `notificationType` and `qaRequestId`. The target
is always `request.auth.uid`. Title, body, data, UID and push token are never
accepted from the client.

## Behavior that intentionally differs from product dispatch

- Product notification preferences are ignored because the authorized tester
  explicitly requested the preview.
- Product-fact preflight is skipped. For example, an
  `EVOLUTION_APPROACHING` preview does not require or create a real progression
  window.
- Product rate limits and achievement milestones are not entered.
- Idempotency is namespaced as `qa-preview`. One UUID is generated per tap;
  retrying the same callable payload is idempotent, while a later tap gets a
  new UUID and can deliver again.

All other central pipeline protections remain active, including content
allowlisting, device ownership/eligibility, provider tickets, token
invalidation, retries and receipts.

## Locale and payload

The callable reads `users/{request.auth.uid}.preferences.language`. Supported
values are `pt-BR`, `en` and `es`; the existing fallback is `pt-BR`.
`QA_TEST` retains its existing fixed foundation copy. Every product type uses
the same canonical builder as production. Current canonical builders have no
intent/deep link and use an empty type-specific `data` object, so the final
Expo payload remains `type` + `notificationId`, exactly as in production.
`EVOLUTION_UNLOCKED` uses the canonical `EVOLUTION` variant as its explicit QA
fixture; no lifecycle event or pending evolution is created.

## Device diagnostics

The panel shows notification permission, existing device-registration result
and whether an Expo token is present. It never renders the token. “Atualizar
registro” reuses the existing permission/token/device registration services.

The callable response can show dispatch/ticket state. Receipt reconciliation
remains backend-only; no Firestore Rules are opened for this panel.

## Manual foreground/background/terminated QA

For foreground, keep the panel open and tap “Enviar notificação”. For
background, tap and immediately put the app in the background while the remote
round trip is in progress.

No delayed sender was added. A reliable server-side delay would require new
scheduling infrastructure; an in-process Function timer would be unreliable.
For a terminated-state test, authenticate the same QA/admin account on a
second development device/session, terminate the target app, and trigger the
preview from the second session. The dispatcher targets every eligible device
owned by that same account, while remaining self-targeted.

## Activation

No native dependency or config changed. The UI is JS-only and works by Fast
Refresh in an already-correct SDK 56 development build. If the installed build
does not already contain the existing `expo-notifications` native config and
valid push credentials, rebuild that development client for the existing push
foundation—not for this QA panel itself.

Deploy the changed callable and the retry worker that preserves `QA_PREVIEW`
mode across a provider retry:

```sh
firebase deploy --only functions:dispatchTestNotification,functions:retryNotificationDispatches
```

No Firestore Rules, indexes, new scheduler, receipt-function deployment or
native app deployment is introduced by this change.
