# Workout Progression System V2 — Overview

**Status:** TARGET_SPEC  
**Implementation:** NOT_IMPLEMENTED  
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
