import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { ExerciseSeedInput, MovementPattern, MuscleId } from '../types/exercise';
import { equipmentContextFor, isExerciseExecutable } from './equipment';
import {
  evaluateDirectLimitationCandidate,
  resolveExerciseLimitations,
  type LimitationCatalog,
  type LimitationCatalogExercise,
} from './limitationResolver';
import { adaptationStage, beginnerKeepFactor, durationKeepFactor, isBeginnerExperience, keepCount } from './personalization';
import type {
  CompositionDecision,
  CanonicalTemplate,
  ExerciseSubstitutionTrace,
  FinalWorkoutExercise,
  FinalWorkoutSession,
  QuestionnaireAnswers,
  SafetyDecision,
  TemplateEnvironment,
} from './types';
import type { LimitationDecisionTrace } from './limitationResolver';
import type { LimitationRegionId } from '../types/exercise';

const exerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

const MUSCLE_FOCUS_MAP: Record<string, MuscleId[]> = {
  chest: ['chest'],
  back: ['lats', 'upper_back', 'traps', 'lower_back'],
  shoulders: ['front_deltoid', 'side_deltoid', 'rear_deltoid'],
  arms: ['biceps', 'triceps', 'forearms'],
  glutes: ['glutes'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  calves: ['calves'],
};

type ResolvedSlot = {
  exercise: FinalWorkoutExercise;
  originalIndex: number;
  primaryMuscle?: MuscleId;
  movementPattern?: MovementPattern;
};

type PriorityCandidate = { priority: string; slotIndex: number };

export type CompositionResult =
  | { status: 'COMPOSED'; sessions: FinalWorkoutSession[]; substitutions: ExerciseSubstitutionTrace[]; limitationDecisions: LimitationDecisionTrace[]; decisions: CompositionDecision[] }
  | { status: 'INVALID_CONFIGURATION'; reasonCodes: string[]; substitutions: ExerciseSubstitutionTrace[]; limitationDecisions: LimitationDecisionTrace[]; decisions: CompositionDecision[] }
  | { status: 'MISSING_EXERCISE'; reasonCodes: string[]; substitutions: ExerciseSubstitutionTrace[]; limitationDecisions: LimitationDecisionTrace[]; decisions: CompositionDecision[] };

function compatibleSubstitute(
  source: LimitationCatalogExercise,
  catalog: LimitationCatalog,
  executable: (exercise: LimitationCatalogExercise) => boolean,
  limitationRegions: LimitationRegionId[],
  visitedExerciseIds: ReadonlySet<string>,
): LimitationCatalogExercise | undefined {
  return source.substitution.similarExerciseIds
    .map((id) => catalog.get(id))
    .find((candidate): candidate is LimitationCatalogExercise => Boolean(
      candidate
      && candidate.status === 'active'
      && candidate.availability.workoutGeneration
      && candidate.availability.substitution
      && candidate.movement.pattern === source.movement.pattern
      && candidate.target.primaryMuscle === source.target.primaryMuscle
      && executable(candidate)
      && (
        limitationRegions.length === 0
        || evaluateDirectLimitationCandidate({
          source,
          candidateId: candidate.id,
          regions: limitationRegions,
          catalog,
          isExecutable: executable,
          visitedExerciseIds,
        }).accepted
      ),
    ));
}

function priorityCandidates(slots: ResolvedSlot[], priorities: string[]): PriorityCandidate[] {
  const usedSlots = new Set<number>();
  const result: PriorityCandidate[] = [];
  for (const priority of priorities) {
    const muscles = MUSCLE_FOCUS_MAP[priority] ?? [];
    const slotIndex = slots.findIndex((slot, index) =>
      !usedSlots.has(index) && slot.primaryMuscle != null && muscles.includes(slot.primaryMuscle),
    );
    if (slotIndex >= 0) {
      usedSlots.add(slotIndex);
      result.push({ priority, slotIndex });
    }
  }
  return result;
}

function selectSlotIndices(
  slots: ResolvedSlot[],
  target: number,
  candidates: PriorityCandidate[],
): Set<number> {
  const selected = new Set<number>();
  const protectedIndices = new Set<number>();
  if (target > 0 && slots.length > 0) {
    selected.add(0);
    protectedIndices.add(0);
  }
  for (const candidate of candidates) {
    if (selected.size >= target) break;
    selected.add(candidate.slotIndex);
    protectedIndices.add(candidate.slotIndex);
  }
  for (let index = 0; index < slots.length && selected.size < target; index += 1) {
    selected.add(index);
  }

  if (selected.size >= 2) {
    const selectedPatterns = new Set([...selected].map((index) => slots[index].movementPattern).filter(Boolean));
    const allPatterns = new Set(slots.map((slot) => slot.movementPattern).filter(Boolean));
    if (selectedPatterns.size === 1 && allPatterns.size > 1) {
      const retainedPattern = [...selectedPatterns][0];
      const replacement = slots.findIndex((slot, index) =>
        !selected.has(index) && slot.movementPattern != null && slot.movementPattern !== retainedPattern,
      );
      const replaceable = [...selected]
        .sort((left, right) => right - left)
        .find((index) => !protectedIndices.has(index));
      if (replacement >= 0 && replaceable != null) {
        selected.delete(replaceable);
        selected.add(replacement);
      }
    }
  }
  return selected;
}

function orderedSlotIndices(selected: Set<number>, candidates: PriorityCandidate[]): number[] {
  const result: number[] = [];
  const append = (index: number) => {
    if (selected.has(index) && !result.includes(index)) result.push(index);
  };
  append(0);
  for (const candidate of candidates) append(candidate.slotIndex);
  for (const index of [...selected].sort((left, right) => left - right)) append(index);
  return result;
}

export function composeTemplate(
  template: CanonicalTemplate,
  answers: QuestionnaireAnswers,
  options: {
    adaptationWeek?: number;
    safety: SafetyDecision;
    environment?: TemplateEnvironment;
    limitationRegions?: LimitationRegionId[];
    exerciseCatalog?: readonly LimitationCatalogExercise[];
  },
): CompositionResult {
  const substitutions: ExerciseSubstitutionTrace[] = [];
  const limitationDecisions: LimitationDecisionTrace[] = [];
  const decisions: CompositionDecision[] = [];
  const missing: string[] = [];
  const unresolved: string[] = [];
  const environment = options.environment ?? template.profile.environment;
  const equipment = equipmentContextFor(answers, environment);
  const applyInventory = environment === 'home';
  const catalog = new Map<string, LimitationCatalogExercise>(
    (options.exerciseCatalog ?? EXERCISES_SEED).map((exercise) => [exercise.id, exercise]),
  );
  const limitationRegions = options.limitationRegions ?? [];
  const executable = (exercise: LimitationCatalogExercise) => isExerciseExecutable(exercise, equipment);
  const priorities = answers.muscleFocus.filter((value) => value !== 'none').slice(0, 2);
  const beginner = isBeginnerExperience(answers);
  const stage = adaptationStage(options.adaptationWeek);
  const beginnerActive = beginner && stage < 3;

  const sessions = template.sessions.map((session, sessionIndex): FinalWorkoutSession => {
    const slots = session.exercises.map((item, originalIndex): ResolvedSlot => {
      const source = catalog.get(item.exercise_id);
      if (!source) {
        missing.push(item.exercise_id);
        return {
          originalIndex,
          exercise: {
            exerciseId: item.exercise_id,
            sourceExerciseId: item.exercise_id,
            sets: item.sets,
            reps: item.reps,
            duration: item.duration,
            cycles: item.cycles,
            intensity: item.intensity,
            notes: item.notes,
          },
        };
      }
      let selected = source;
      const visitedExerciseIds = new Set<string>([source.id]);
      if (limitationRegions.length) {
        const limitation = resolveExerciseLimitations({
          exerciseId: source.id,
          regions: limitationRegions,
          catalog,
          isExecutable: executable,
          visitedExerciseIds,
        });
        if (limitation.status === 'FAILED') {
          unresolved.push(...limitation.reasonCodes.map((code) => `${code}:${source.id}`));
        } else {
          selected = limitation.exercise;
          visitedExerciseIds.add(selected.id);
          limitationDecisions.push({ sessionIndex, ...limitation.trace });
        }
      }
      if (applyInventory && !executable(selected)) {
        const replacement = compatibleSubstitute(
          selected,
          catalog,
          executable,
          limitationRegions,
          visitedExerciseIds,
        );
        if (!replacement) unresolved.push(`NO_SAFE_EQUIPMENT_SUBSTITUTE:${source.id}`);
        else {
          selected = replacement;
          substitutions.push({
            sessionIndex,
            fromExerciseId: source.id,
            toExerciseId: replacement.id,
            reasonCode: 'EQUIPMENT_UNAVAILABLE',
          });
        }
      }
      return {
        originalIndex,
        primaryMuscle: selected.target.primaryMuscle,
        movementPattern: selected.movement.pattern,
        exercise: {
          exerciseId: selected.id,
          sourceExerciseId: source.id,
          sets: item.sets,
          reps: item.reps,
          duration: item.duration,
          cycles: item.cycles,
          intensity: item.intensity,
          notes: item.notes,
        },
      };
    });

    const baseCount = slots.length;
    const durationTarget = keepCount(baseCount, durationKeepFactor(answers.duration));
    const beginnerTarget = beginnerActive ? keepCount(baseCount, beginnerKeepFactor(stage)) : baseCount;
    const target = Math.min(baseCount, durationTarget, beginnerTarget);
    const candidates = priorityCandidates(slots, priorities);
    const selected = selectSlotIndices(slots, target, candidates);

    if (beginnerTarget < baseCount) {
      decisions.push({
        reasonCode: 'BEGINNER_SESSION_REDUCED', sessionIndex,
        baseExerciseCount: baseCount, targetExerciseCount: beginnerTarget,
      });
    }
    if (durationTarget < baseCount) {
      decisions.push({
        reasonCode: 'DURATION_SESSION_REDUCED', sessionIndex,
        baseExerciseCount: baseCount, targetExerciseCount: durationTarget,
      });
    }
    for (const candidate of candidates) {
      if (selected.has(candidate.slotIndex) && target < baseCount) {
        decisions.push({
          reasonCode: 'MUSCLE_PRIORITY_PRESERVED', sessionIndex,
          priority: candidate.priority, exerciseId: slots[candidate.slotIndex].exercise.exerciseId,
        });
      }
    }

    let fallbackUsed = false;
    if (
      (answers.duration === '30' || answers.duration === '45')
      && durationTarget === baseCount
      && !beginnerActive
      && options.safety.status === 'CLEAR'
    ) {
      const fallbackIndex = [...selected]
        .sort((left, right) => right - left)
        .find((index) => (slots[index].exercise.sets ?? 0) > 1);
      if (fallbackIndex != null) {
        const exercise = slots[fallbackIndex].exercise;
        const beforeSets = exercise.sets as number;
        slots[fallbackIndex] = {
          ...slots[fallbackIndex],
          exercise: { ...exercise, sets: beforeSets - 1 },
        };
        fallbackUsed = true;
        decisions.push({
          reasonCode: 'DURATION_SET_FALLBACK', sessionIndex,
          exerciseId: exercise.exerciseId, beforeSets, afterSets: beforeSets - 1,
        });
      }
    }

    const canonicalSelected = [...selected].sort((left, right) => left - right);
    const orderedIndices = orderedSlotIndices(selected, candidates);
    for (const candidate of candidates) {
      if (
        selected.has(candidate.slotIndex)
        && canonicalSelected.indexOf(candidate.slotIndex) !== orderedIndices.indexOf(candidate.slotIndex)
      ) {
        decisions.push({
          reasonCode: 'MUSCLE_PRIORITY_REORDERED', sessionIndex,
          priority: candidate.priority, exerciseId: slots[candidate.slotIndex].exercise.exerciseId,
        });
      }
    }

    const extraAppliedTo = new Set<number>();
    for (const candidate of candidates) {
      if (!selected.has(candidate.slotIndex) || extraAppliedTo.has(candidate.slotIndex)) continue;
      const slot = slots[candidate.slotIndex];
      if (beginnerActive) {
        decisions.push({
          reasonCode: 'PRIORITY_SET_SKIPPED_BEGINNER', sessionIndex,
          priority: candidate.priority, exerciseId: slot.exercise.exerciseId,
        });
        continue;
      }
      if (
        answers.duration === '30'
        || (answers.duration === '45' && (durationTarget < baseCount || fallbackUsed))
      ) {
        decisions.push({
          reasonCode: 'PRIORITY_SET_SKIPPED_DURATION', sessionIndex,
          priority: candidate.priority, exerciseId: slot.exercise.exerciseId,
        });
        continue;
      }
      if (options.safety.status !== 'CLEAR') {
        decisions.push({
          reasonCode: 'PRIORITY_SET_SKIPPED_SAFETY', sessionIndex,
          priority: candidate.priority, exerciseId: slot.exercise.exerciseId,
        });
        continue;
      }
      if (slot.exercise.sets == null) continue;
      const beforeSets = slot.exercise.sets;
      slots[candidate.slotIndex] = {
        ...slot,
        exercise: { ...slot.exercise, sets: beforeSets + 1 },
      };
      extraAppliedTo.add(candidate.slotIndex);
      decisions.push({
        reasonCode: 'MUSCLE_PRIORITY_SET_ADDED', sessionIndex,
        priority: candidate.priority, exerciseId: slot.exercise.exerciseId,
        beforeSets, afterSets: beforeSets + 1,
      });
    }

    return {
      name: session.name,
      type: session.type,
      notes: session.notes,
      exercises: orderedIndices.map((index) => slots[index].exercise),
    };
  });

  if (missing.length) {
    return { status: 'MISSING_EXERCISE', reasonCodes: [...new Set(missing)].sort(), substitutions, limitationDecisions, decisions };
  }
  if (unresolved.length) {
    return { status: 'INVALID_CONFIGURATION', reasonCodes: [...new Set(unresolved)].sort(), substitutions, limitationDecisions, decisions };
  }
  return { status: 'COMPOSED', sessions, substitutions, limitationDecisions, decisions };
}

export function exerciseExists(exerciseId: string): boolean {
  return exerciseById.has(exerciseId);
}
