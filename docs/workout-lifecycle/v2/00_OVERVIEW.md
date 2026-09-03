# Workout Progression System V2 — Overview

**Status:** TARGET_SPEC  
**Implementation:** PRODUCTION-HARDENED THROUGH PHASE 8C — Phase 8A established correctness and safety; Phase 8B established sole V2 lifecycle authority and convergent concurrent transitions; Phase 8C integrates deterministic rollout into the real hot path, provides a live kill switch and rollback runbook, semantic Rules, real PII-free operational telemetry, reproducible toolchains, explicit CI gates, and long-run regression proof. See `architecture/14_PHASE_8A_CORRECTNESS_SAFETY_REMEDIATION.md`, `architecture/15_PHASE_8B_LIFECYCLE_AUTHORITY_CONCURRENCY_REMEDIATION.md`, `architecture/16_PHASE_8C_PRODUCTION_HARDENING.md`, ADR-012 through ADR-014, and the operations runbook. Still future: XP/gamification economy, load progression, push notifications, and Phase 8D device-level UX truthfulness/visual validation.
**Version:** 2.0

## Purpose
AJ Fit should make long-term strength training feel like an ongoing journey. Progression exists primarily to reinforce motivation and consistency while keeping prescriptions technically coherent and safe. It is not an automatic load-progression system and must not pretend to infer physiological advancement from data the app does not collect.

## Core model
`Starting Level → Current Training Level → Current Cycle → Program Instance → Cycle Progress → Evolution Decision`

Three outcomes are distinct:
1. **Level Promotion:** Beginner→Intermediate or Intermediate→Advanced. A materially new prescription may be generated from the template appropriate to the new level.
2. **Cycle Evolution:** a new cycle inside the same level. Difficulty stays approximately stable; 20–30% of the program may rotate through equivalent exercises, controlled ordering and small volume redistribution.
3. **Motivational Renewal:** a low-adherence user gets a refreshed program to encourage return. It is not an earned evolution and does not advance level-promotion credit.

## Infinite journey
Beginner is an adaptation period. Intermediate contains earned cycles and promotes to Advanced after four valid Intermediate cycles. Advanced cycles continue indefinitely. The app may show continuous progression without inventing endless public phase names.

## Eligibility summary
- Beginner: approximately four active weeks plus at least 70% of prescribed valid sessions.
- Intermediate/Advanced: earliest earned evolution around 85 active days plus at least 70% adherence.
- 85%+ adherence may earn a higher achievement/reward tier.
- Extra workouts never accelerate progression.
- Prolonged inactivity pauses active-time accumulation.
- Low adherence can eventually lead to motivational renewal rather than an earned evolution.

## Deferred activation
When a new program is ready, the user may keep the old program for two weeks, then defer once more for two weeks. After four weeks total, the new program activates automatically.

## Future boundary
Workout Progression emits domain facts. A future global Gamification system owns XP, ranking, global level, badges and reward economics.
