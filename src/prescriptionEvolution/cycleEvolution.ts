import type { LimitationRegionId } from '../types/exercise';
import type { EquipmentContext } from '../workoutPrescription/equipment';
import type { LimitationCatalogExercise } from '../workoutPrescription/limitationResolver';
import type { FinalWorkoutExercise, FinalWorkoutSession } from '../workoutPrescription/types';
import { PRESCRIPTION_EVOLUTION_CONFIG, type PrescriptionEvolutionConfig } from './config';
import { candidatePoolFor, evaluateEquivalenceCandidate, rankCandidates } from './equivalence';

function slotKey(sessionIndex: number, exerciseIndex: number): string {
  return `${sessionIndex}:${exerciseIndex}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface ExerciseSubstitutionExplanation {
  sessionIndex: number;
  exerciseIndex: number;
  sourceExerciseId: string;
  targetExerciseId: string;
  reason: 'EQUIVALENT_MOVEMENT_VARIANT';
  matched: {
    movementPattern: boolean;
    primaryMuscle: boolean;
    equipment: boolean;
    declaredSimilar: boolean;
  };
  safetyValidated: true;
  recentlyUsedPenalty: boolean;
}

export interface CycleEvolutionResult {
  sessions: FinalWorkoutSession[];
  eligibleSlots: number;
  changedSlots: number;
  changeRatio: number;
  substitutions: ExerciseSubstitutionExplanation[];
  warnings: string[];
}

export interface RecentSlotHistory {
  /** exerciseIds seen at `sessionIndex:exerciseIndex` across the anti-ping-pong window (most recent prescriptions only). */
  bySlot: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Builds the anti-ping-pong lookup from up to `window` prior prescriptions,
 * most-recent-first. Pure — the caller resolves and orders the history
 * (docs §34/§92, ADR-008).
 */
export function buildRecentSlotHistory(
  priorSessions: readonly (readonly FinalWorkoutSession[])[],
  window: number = PRESCRIPTION_EVOLUTION_CONFIG.antiPingPongWindow,
): RecentSlotHistory {
  const bySlot = new Map<string, Set<string>>();
  for (const sessions of priorSessions.slice(0, window)) {
    sessions.forEach((session, sessionIndex) => {
      session.exercises.forEach((exercise, exerciseIndex) => {
        const key = slotKey(sessionIndex, exerciseIndex);
        const set = bySlot.get(key) ?? new Set<string>();
        set.add(exercise.exerciseId);
        bySlot.set(key, set);
      });
    });
  }
  return { bySlot };
}

/**
 * Pure Cycle Evolution transformer (docs prescription/02-05, ADR-008).
 *
 * Starts from the CURRENT prescription's sessions — never a fresh template
 * selection (docs §19) — and substitutes a controlled subset of exercise
 * slots for safe, structurally-equivalent variants. Level, frequency,
 * split, goal, session identity/order, and every slot's `sets/reps/
 * duration/cycles/intensity/restSeconds` are left completely untouched;
 * only `exerciseId`/`sourceExerciseId` can change (docs §18/§49/§55-60).
 *
 * No I/O, no randomness, no `Date.now()`. Same input (including
 * `targetCycleIdentity`) always produces the same output.
 */
export function evolveCycle(input: {
  sessions: readonly FinalWorkoutSession[];
  /** Deterministic salt identifying this evolution operation (e.g. `${cycleId}:${programInstanceId}`) — participates in slot ordering and tie-breaks so different target cycles can vary while retries of the same one never do (docs §32/§33). */
  targetCycleIdentity: string;
  limitationRegions: readonly LimitationRegionId[];
  equipmentContext: EquipmentContext;
  catalog: ReadonlyMap<string, LimitationCatalogExercise>;
  recentSlotHistory: RecentSlotHistory;
  config?: PrescriptionEvolutionConfig;
}): CycleEvolutionResult {
  const config = input.config ?? PRESCRIPTION_EVOLUTION_CONFIG;

  // Movement anchor rule (docs §37/§38/§43): the first exercise of each
  // session is the session's priority movement and is never eligible for
  // rotation. Every other slot is eligible.
  const eligibleSlots: Array<{ sessionIndex: number; exerciseIndex: number }> = [];
  input.sessions.forEach((session, sessionIndex) => {
    session.exercises.forEach((_exercise, exerciseIndex) => {
      if (exerciseIndex === 0) return;
      eligibleSlots.push({ sessionIndex, exerciseIndex });
    });
  });

  const targetChanges = eligibleSlots.length === 0
    ? 0
    : Math.min(eligibleSlots.length, Math.max(1, Math.round(eligibleSlots.length * config.noveltyTargetRatio)));

  // Deterministic slot processing order, salted by targetCycleIdentity.
  const orderedSlots = [...eligibleSlots].sort((a, b) => {
    const hashA = stableHash(`${slotKey(a.sessionIndex, a.exerciseIndex)}:${input.targetCycleIdentity}`);
    const hashB = stableHash(`${slotKey(b.sessionIndex, b.exerciseIndex)}:${input.targetCycleIdentity}`);
    return hashA === hashB ? 0 : hashA < hashB ? -1 : 1;
  });

  const sessions: FinalWorkoutSession[] = input.sessions.map((session) => ({
    ...session,
    exercises: session.exercises.map((exercise): FinalWorkoutExercise => ({ ...exercise })),
  }));
  // Duplicate prevention is scoped PER SESSION, not plan-wide — real
  // multi-session splits legitimately reuse the same exercise across
  // different sessions (e.g. squats on both Lower A and Lower B); docs §89
  // only requires that a slot never duplicate another exercise already in
  // the SAME session.
  const usedExerciseIdsBySession = sessions.map(
    (session) => new Set(session.exercises.map((exercise) => exercise.exerciseId)),
  );
  const substitutions: ExerciseSubstitutionExplanation[] = [];
  const warnings: string[] = [];

  for (const slot of orderedSlots) {
    if (substitutions.length >= targetChanges) break;
    const exercise = sessions[slot.sessionIndex].exercises[slot.exerciseIndex];
    const source = input.catalog.get(exercise.sourceExerciseId || exercise.exerciseId);
    if (!source) continue; // unknown exercise — never touch what we can't evaluate.

    const usedExerciseIds = usedExerciseIdsBySession[slot.sessionIndex];
    const recentExerciseIds = input.recentSlotHistory.bySlot.get(slotKey(slot.sessionIndex, slot.exerciseIndex)) ?? new Set<string>();
    const candidateIds = candidatePoolFor(source, input.catalog);
    const evaluations = candidateIds.map((candidateId) => evaluateEquivalenceCandidate({
      source,
      candidateId,
      catalog: input.catalog,
      regions: input.limitationRegions,
      equipmentContext: input.equipmentContext,
      usedExerciseIds,
      recentExerciseIds,
      slotContext: {
        sessionName: sessions[slot.sessionIndex].name,
        sessionType: sessions[slot.sessionIndex].type,
        exerciseIndex: slot.exerciseIndex,
        isMovementAnchor: slot.exerciseIndex === 0,
        sourceMovementPattern: source.movement.pattern,
        sourceMechanic: source.movement.mechanic,
      },
    }));
    const ranked = rankCandidates(
      evaluations,
      `${input.targetCycleIdentity}:${slotKey(slot.sessionIndex, slot.exerciseIndex)}`,
    );
    const chosen = ranked[0];
    // Fallback: no safe/equivalent candidate — preserve the current
    // exercise for this slot rather than force an unsafe or absurd swap
    // (docs §78/§79).
    if (!chosen) continue;

    const target = input.catalog.get(chosen.exerciseId);
    if (!target) continue;

    sessions[slot.sessionIndex].exercises[slot.exerciseIndex] = {
      ...exercise,
      exerciseId: target.id,
      sourceExerciseId: target.id,
    };
    usedExerciseIds.delete(exercise.exerciseId);
    usedExerciseIds.add(target.id);
    substitutions.push({
      sessionIndex: slot.sessionIndex,
      exerciseIndex: slot.exerciseIndex,
      sourceExerciseId: exercise.exerciseId,
      targetExerciseId: target.id,
      reason: 'EQUIVALENT_MOVEMENT_VARIANT',
      matched: {
        movementPattern: target.movement.pattern === source.movement.pattern,
        primaryMuscle: target.target.primaryMuscle === source.target.primaryMuscle,
        equipment: true,
        declaredSimilar: chosen.declaredSimilar,
      },
      safetyValidated: true,
      recentlyUsedPenalty: chosen.recentlyUsed,
    });
  }

  if (substitutions.length < targetChanges) {
    warnings.push('NOVELTY_TARGET_NOT_REACHED_SAFETY_CONSTRAINED');
  }

  return {
    sessions,
    eligibleSlots: eligibleSlots.length,
    changedSlots: substitutions.length,
    changeRatio: eligibleSlots.length === 0 ? 0 : substitutions.length / eligibleSlots.length,
    substitutions,
    warnings,
  };
}
