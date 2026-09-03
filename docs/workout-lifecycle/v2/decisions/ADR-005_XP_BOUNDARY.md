# ADR-005 — XP Belongs to Global Gamification

**Status:** Accepted

## Decision
Workout Progression emits semantic events; it does not calculate or mutate XP balances.

## Rationale
Future XP will also come from assessments, sharing, challenges, consistency and other domains. Reward economics must evolve independently of workout prescription.

## Consequence
Events require stable IDs and sufficient context for idempotent reward consumption.
