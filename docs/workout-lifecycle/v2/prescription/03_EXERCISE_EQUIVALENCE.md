# Exercise Equivalence

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED (`src/prescriptionEvolution/equivalence.ts`) — movement pattern, primary muscle, role/mechanic proximity, equipment, difficulty, and safety/limitations all participate in candidate evaluation and ranking; reuses the existing safety resolver rather than a second taxonomy (architecture/09_PHASE_3_IMPLEMENTATION.md).

An exercise may replace another only through a validated equivalence relationship. Relevant dimensions include primary movement pattern, primary/secondary muscles, role in the session, equipment, difficulty class, safety constraints, user limitations and prescription context.

The goal is to preserve the **movement role**, not necessarily the exact exercise. Examples of intended families may include barbell bench → dumbbell bench → compatible chest press machine, or squat → compatible hack/Smith variation, only when the exercise dataset and safety resolver confirm equivalence.

Safety and limitations always override novelty. The implementation must use explicit data/rules rather than `randomExerciseSameMuscle()`.

## Phase 8A hard role constraints

Movement mechanic is a hard constraint: compound cannot silently become
isolation (or the reverse), even when `similarExerciseIds` declares the edge.
The active session slot contributes anchor status, source movement pattern and
source mechanic; anchors are immutable and candidates that violate slot
context are rejected before novelty ranking. Equipment and limitation gates
remain hard and take precedence over role-compatible novelty. The real
hip-thrust → cable-glute-kickback counterexample is an explicit regression;
real compound → compound alternatives remain accepted.
