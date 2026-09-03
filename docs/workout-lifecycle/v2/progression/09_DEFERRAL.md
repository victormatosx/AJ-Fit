# Evolution Deferral

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED (Fase 4) — `pendingEvolutions/current` + `src/workoutLifecycle/deferral.ts` (ADR-009). Two 14-day windows, auto-activation via `reconcileWorkoutLifecycle` on any trusted runtime entry, never a third deferral. `ProgressionDecision` (Fase 2) itself still carries no deferral state by design — deferral is Fase 4's application-layer concern, not the pure decision engine's. Copy/UX framing is not implemented (future phase).

When a new earned program is ready, the user may continue the current program temporarily.

1. Unlock is announced; user may activate now or defer for 2 weeks.
2. After 2 weeks, prompt again; one additional 2-week deferral is allowed.
3. After 4 total weeks, the new program activates automatically.

Deferral must not revoke the earned achievement. The old program remains executable during the deferral window. Copy should say the previous program completed its role, not that it became “bad” or unsafe.
