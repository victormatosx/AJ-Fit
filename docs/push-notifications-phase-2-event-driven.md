# Push Notifications — Phase 2 event-driven product notifications

## Scope

This phase connects exactly four product notification types to facts already
persisted by AJ Fit. It creates no cron, changes no workout/subscription
decision, and does not bypass the Phase-1 dispatcher:

| Persisted fact | Notification type | Category |
| --- | --- | --- |
| `EVOLUTION_EARNED` | `EVOLUTION_UNLOCKED` | `EVOLUTION_AND_ACHIEVEMENTS` |
| `MOTIVATIONAL_RENEWAL_OFFERED` | `EVOLUTION_UNLOCKED` | `EVOLUTION_AND_ACHIEVEMENTS` |
| `PROGRAM_ADAPTED` | `PROGRAM_UPDATED` | `EVOLUTION_AND_ACHIEVEMENTS` |
| RevenueCat `BILLING_ISSUE` for `premium` | `BILLING_ISSUE` | `OPERATIONAL` |
| RevenueCat `EXPIRATION` for `premium`, entitlement inactive | `PREMIUM_ENDED` | `OPERATIONAL` |

All other planned product types remain unregistered and unsendable. `QA_TEST`
remains an isolated admin/dev self-test and is not a bypass for product events.

## Workout lifecycle source

The immutable source is
`users/{uid}/workoutLifecycleEvents/{eventId}`. The existing trusted document
trigger first processes telemetry and then evaluates the persisted event for a
notification. Activation and promotion events are explicitly ineligible, so
an unlock is not repeated on `EVOLUTION_ACTIVATED`, `LEVEL_PROMOTED`, or
`MOTIVATIONAL_RENEWAL_ACTIVATED`.

`MOTIVATIONAL_RENEWAL_OFFERED` uses separate copy because it is a renewal
offer, not proof that a new workout has already been activated. A
`PROGRAM_ADAPTED` fact is different from earning or activating an evolution
and is the only workout event that emits `PROGRAM_UPDATED`.

An immutable lifecycle document has one event type. Unlock and adaptation can
occur in the same wider workflow only as separate facts. They are not
automatically collapsed: their notification type and source event identity
produce distinct semantic idempotency contracts, while replay of either fact
deduplicates independently.

## RevenueCat source and ordering

The existing RevenueCat webhook remains the sole subscription source. It
validates the HMAC signature, resolves Firebase identity, normalizes and
validates the event, then applies the subscription mirror in the existing
ordering-aware Firestore transaction. Notification evaluation happens only
after that transaction returns `processed` or `duplicate`.

- `BILLING_ISSUE` may retain an active entitlement during grace. Its copy says
  renewal could not be confirmed and never says Premium has ended.
- `CANCELLATION` is always filtered out; turning off renewal is not expiration.
- `PREMIUM_ENDED` requires the real `EXPIRATION` event and the normalized final
  `entitlementActive === false` result.

Notification errors are caught after the business fact is committed. They do
not roll back lifecycle state, the subscription mirror, entitlement, or the
webhook response.

## Candidate, policy and dispatch

Each eligible fact flows through the same path:

1. resolve active-account policy and the stored `preferences.language`;
2. enforce the product category toggle, or mandatory `OPERATIONAL` policy;
3. construct an allowlisted PT-BR, English, or Spanish request;
4. claim semantic idempotency using UID + notification type + hashed source
   event identity + notification identity;
5. use the Phase-1 dispatcher for eligible devices, Expo tickets and receipts.

Raw source IDs are SHA-256 hashed before becoming notification identities or
notification-specific log context. Product payload `data` is empty: it carries
no UID, RevenueCat payload/product/transaction data, health or body data,
photos, tokens, or private URLs.

Localized title/body are presentation, not semantic identity. The first
allowlisted request is persisted; a replay after a language change therefore
deduplicates instead of conflicting or creating a second notification. The
legacy `QA_TEST` contract hash remains compatible with Phase-1 records.

## Deep links

Product destinations are deliberately deferred. Payloads contain no component
or screen names and no new domain intent. A future navigation change must map
stable domain intents through the existing `DeepLinkProvider` only after each
destination is approved.

## Deployment boundary

This phase changes no Firestore Rules or indexes and requires no new native
configuration. Functions, Rules, indexes, Storage, Hosting, secrets and TTL are
not deployed as part of implementation or local validation.
