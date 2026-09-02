# ADR-015 — Workout Lifecycle Trust Boundary

- Status: Accepted — CURRENT
- Date: 2026-08-31
- Supersedes: the client-authority portions of ADR-010, ADR-013 and ADR-014
- Scope: Workout Lifecycle V2 final blocker remediation (Phase 9)

## Context

An authenticated owner with a valid App Check token is still untrusted for
domain facts. Before Phase 9, the client could assemble structurally valid
writes that declared a level change, completed cycle, pending evolution,
activation, qualifying execution, or operational success. Firestore Rules
checked identity and shape but could not independently recompute progression,
prescription safety, calendar opportunities and immutable session content.

## Decision

The client may request a lifecycle action, but a trusted backend must validate
the exact action against authoritative persisted state before any critical V2
client transaction can commit. The callable `authorizeWorkoutLifecycleMutation`
requires Auth and App Check, reads the relevant lifecycle/cycle/instance,
execution, schedule, questionnaire, template, exercise catalog and limitation
profiles as required, recomputes the semantic predicate, and issues a
short-lived, one-operation capability at
`users/{uid}/workoutLifecycleAuthorityGrants/current`.

The subsequent client transaction must match every granted identity and
payload constrained by Rules and delete the grant atomically. A grant is not a
general write permission. It is bound to the operation, source identities,
target identities, event identity and, where applicable, authoritative earned
fact, plan and prescription-input snapshot. It expires after sixty seconds and
is single-use.

For operations that install immutable prescription content, the backend first
validates safety and seals the exact target `workoutPrograms/{contentIdentity}`
with Admin SDK semantics. A modified client cannot substitute another plan
after authorization.

## Authority table

| Operation | Client action | Domain authority |
| --- | --- | --- |
| record set | submit execution evidence | client write remains evidence, never eligibility by itself |
| finish V2 execution | request finish | backend validates exact prescribed session/exercises/sets; grant authorizes atomic finish |
| complete V2 schedule opportunity | request completion | backend validates execution and opportunity; grant authorizes atomic schedule update |
| evaluate progression | request/reconcile | backend validates the earned fact used by the granted transition |
| complete cycle | no direct declaration | only a granted activation transaction may complete the exact active cycle |
| prepare evolution | request preparation | backend validates earned fact, source snapshot and safe target |
| promote level | request activation | backend validates pending, adjacency, target cycle and plan; Rules bind the write |
| defer | user chooses defer | backend validates exact pending and event; Rules constrain the increment/timeline |
| activate | user chooses start/automatic reconcile | backend validates exact pending/source/target and seals content |
| adaptation | submit changed answers | backend re-derives effective inputs and safe plan, then grants exact activation |
| lifecycle event creation | none independently | only as part of a matching granted domain transaction |

## What the client may write directly

Non-authoritative UI state and bounded execution evidence may be written under
their existing schema. Critical V2 facts require and consume a backend grant.
The owner cannot create a grant because Rules deny all client writes to the
grant collection. Direct writes to lifecycle, cycles, instances, events and
pending evolution without a matching grant are denied.

## What only the backend may declare

The backend alone may attest eligibility, completion of a prescribed session,
cycle completion, earned evolution, promotion, safe target content, activation
and trusted-domain telemetry. The final multi-document mutation may still be a
client Firestore transaction for compatibility, but its semantic authority is
the backend capability and its exact Rules binding, not the client.

## Firestore Rules guarantee

Rules guarantee owner isolation, immutable history and starting level,
operation-specific capability consumption, exact source/target/event binding,
coherent lifecycle/cycle level and number, coherent supersession, and denial of
arbitrary active instances, pending documents and lifecycle events. Rules do
not reimplement the progression or prescription engines.

## App Check guarantee

App Check raises the cost of calling the backend from an unrecognized app
environment. Auth establishes the UID. Neither proves that a domain claim sent
by the client is true. Backend revalidation remains mandatory.

## Prescribed opportunity and execution evidence

Adherence counts concrete schedule opportunities generated from authoritative
training weekdays inside the active ProgramInstance window. Qualification
compares execution evidence with the immutable session snapshot: omitted
exercises and sets remain in the denominator; duplicates, unknown exercises,
extra exercises, wrong sessions and wrong instances never add credit. Legacy
records without sufficient identity/evidence fail conservatively.

## Concurrency

Capabilities are intentionally single-use. If another command replaces the
grant during a benign race, the application recomputes once from current
authoritative state. Adaptation invalidates stale pending content, preserves
the immutable earned fact and deferral timeline, and causes a racing activation
to converge as `STALE_PENDING`. Safety inputs always win.

## Telemetry

The client callable accepts only bounded `CLIENT_DIAGNOSTIC` events. Trusted
domain names are rejected. Immutable lifecycle event creation triggers backend
mapping to `TRUSTED_DOMAIN` telemetry only after persistence. Per-user receipt
documents deduplicate event IDs. Receipt creation precedes provider delivery,
so provider failure cannot roll back or duplicate the domain transition.
Payloads are allowlisted and exclude unnecessary PII.

## Account deletion

Authority grants and trusted-telemetry receipts are per-user operational data.
Both collections are included in idempotent Firestore cleanup and the account
deletion reconciliation tests.

## Consequences

- Authenticated owner is treated as an untrusted semantic input.
- Rules stay bounded instead of duplicating complex engines.
- V2 remains the sole progression authority; V1 is compatibility-only.
- Backend availability is required to authorize new critical V2 writes.
- No rollout or production configuration is changed by this decision.

