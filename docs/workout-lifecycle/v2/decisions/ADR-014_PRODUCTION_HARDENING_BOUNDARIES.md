# ADR-014 — Production Hardening Boundaries

**Status:** HISTORICAL; telemetry/trust-boundary portions SUPERSEDED by ADR-015

> Rollout and toolchain decisions remain current. Phase 9 split telemetry by
> trust level and requires backend authorization capabilities for critical V2
> writes; the centralized client telemetry contract is diagnostics-only.

## Context

Before Phase 8C, rollout code existed but was not authoritative in the real
enrollment hot path, telemetry had no production destination, Rules primarily
protected ownership/schema rather than feasible lifecycle semantics, and the
repository mixed root, Functions, Java, and Firebase CLI assumptions. Those
gaps made correct domain code operationally unsafe to ramp.

## Decision

1. Rollout gates only a new V1→V2 migration. Presence of valid V2 state is the
   durable enrollment fact and bypasses the flag forever. Missing, malformed,
   or unavailable config fails closed for new enrollment while preserving the
   legacy workout.
2. Rollout uses one Admin-owned, versioned Firestore document and a stable UID
   hash bucket. There is no client cache and no client write authority.
3. Operational events use one centralized, bounded client contract and an
   authenticated, App Check-enforced callable that writes structured Cloud
   Logging entries. Aggregate operations do not require logging UID or PII.
   Telemetry remains best-effort and cannot affect domain commits.
4. Firestore Rules enforce ownership, closed schemas, immutable identities,
   referential coherence, append-only history, bounded transitions, and
   feasible pending-plan semantics. Rules do not duplicate the progression or
   prescription engines.
5. Root tooling is Node 20, Functions tooling is Node 22, emulator tooling is
   Java 21+, and Firebase CLI is an exact repository dependency. CI installs
   deterministically and exercises every critical emulator suite explicitly.

## Consequences

- Operators can stop new enrollment without deploying and without damaging
  existing V2 users.
- Rollout health is observable through PII-free aggregate signals, while the
  durable domain ledger remains a separate source of truth.
- Admin SDK writes remain a trusted backend boundary and must validate domain
  input before bypassing client Rules.
- A staged soak is still required before 100%; production hardening does not
  manufacture live traffic evidence.
- Device-level visual truthfulness and accessibility validation remain Phase
  8D scope; XP, load progression, and push notifications remain out of scope.
