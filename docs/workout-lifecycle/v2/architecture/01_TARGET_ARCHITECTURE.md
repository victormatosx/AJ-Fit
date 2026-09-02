# Target Architecture

**Implementation:** IMPLEMENTED and remediated through Phase 9; analytics/gamification remain future boundaries.

Target separation:

`Questionnaire/Profile → Prescription Engine → Program Content/Instance → Schedule → Execution → Progression Evaluation → Evolution Decision → Prescription/Activation`

Cross-cutting outputs flow through domain events to Analytics/Gamification.

Key boundary: **Program content identity, ProgramInstance lifecycle identity and TrainingCycle identity are distinct concepts.** The V1 `programId` currently conflates content and lifecycle in normal rotation; V2 must not rely on that ambiguity.

Progression decides **whether/what kind of transition** is eligible. Prescription decides **what the next workout contains**. Gamification decides **what rewards the event earns**.

## Phase 8B operational authority

The real completion path is `WorkoutScreen → AppShell →
completeWorkoutSessionFlow → execution.finish → schedule.completeSession →
processWorkoutLifecycleAfterSession`. The final operation delegates to the
same idempotent `reconcileWorkoutLifecycle` used at cold start. It ensures or
minimally recovers V2, evaluates Progression V2, durably records an earned
fact, prepares with optimistic expected-base checks and reconciles activation
deadlines. A lifecycle follow-up failure is retryable and never rolls back the
already-durable workout/schedule facts.

For every account with V2 state, V2 is the sole mutating lifecycle authority.
V1 is readable compatibility/bootstrap input only; its remaining evaluator is
not production-reachable and `applyProgression` refuses every V1 mutation,
including Beginner stages, once V2 exists.

## Phase 8C operational boundary

New enrollment now traverses the versioned rollout config and deterministic
UID cohort only when V2 state is absent. Existing V2 state is sticky and
bypasses rollout. The production telemetry adapter sends bounded operational
events to an authenticated, App Check-protected callable and structured Cloud
Logging; it never becomes a domain source of truth. Firestore Rules protect
closed schemas, immutable identities, feasible transition semantics, active
referents, append-only events, and pending-plan relationships. Root Node 20,
Functions Node 22, Java 21, and exact Firebase CLI 15.26.0 are enforced by
local preflight and CI.

## Phase 9 trust boundary

Critical V2 mutations require `authorizeWorkoutLifecycleMutation`: an Auth +
App Check callable that independently validates authoritative state and issues
a short-lived, one-operation grant. The client transaction must match and
atomically consume that grant under Rules. The owner cannot create grants.
Trusted success telemetry is projected by a backend trigger from immutable
lifecycle events; the client callable accepts diagnostics only. See ADR-015.
