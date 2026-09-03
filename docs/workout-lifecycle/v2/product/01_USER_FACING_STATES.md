# User-Facing States

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED (Fase 8D) — `EvolutionViewModel` (`src/workoutEvolution/types.ts`) implements `LOADING`/`UNAVAILABLE`/`ERROR`/`PROGRESSING`/`EVOLUTION_READY`/`EVOLUTION_DEFERRED`/`AUTO_ACTIVATION_NOTICE`. `UNAVAILABLE` is the neutral, non-fabricated state for a rollout-off legacy account. Motivational Renewal reuses ready/deferred with `pending.type`; the auto notice is reconstructed from the immutable activation event and remains visible until a device-local acknowledgement. `BUILDING`/`ON_TRACK`/`READY` are semantic presenter states mapped from the engine outcome, never percentage buckets. See architecture/17_PHASE_8D_UX_TRUTHFULNESS.md.

Recommended semantic states: `IN_PROGRESS`, `EVOLUTION_APPROACHING`, `EVOLUTION_EARNED`, `DEFERRED`, `AUTO_ACTIVATION_APPROACHING`, `BELOW_TARGET`, `MOTIVATIONAL_RENEWAL_AVAILABLE`, `NEW_PROGRAM_ACTIVE`.

UI should expose current training level and meaningful progress without requiring endless named phases. Cycle numbering or a subtler “current evolution” representation may continue indefinitely.

Internal states and exact day thresholds do not need to be exposed verbatim.
