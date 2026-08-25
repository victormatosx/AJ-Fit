import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { ExerciseSeedInput, MuscleId } from '../types/exercise';
import type {
  CanonicalTemplate,
  ExerciseSubstitutionTrace,
  FinalWorkoutSession,
  QuestionnaireAnswers,
} from './types';

const exerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

const EQUIPMENT_MAP: Record<string, ExerciseSeedInput['equipment']> = {
  bodyweight: ['bodyweight'],
  dumbbells: ['dumbbell'],
  bands: ['resistance_band', 'mini_band'],
  bench_or_box: ['bench', 'chair', 'step'],
  barbell: ['barbell', 'ez_bar'],
  none: ['bodyweight'],
};

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

function availableEquipment(answers: QuestionnaireAnswers): Set<string> {
  const available = new Set<string>(['bodyweight']);
  for (const answer of answers.equipment) {
    for (const item of EQUIPMENT_MAP[answer] ?? []) available.add(item);
  }
  return available;
}

function isExecutable(exercise: ExerciseSeedInput, available: Set<string>): boolean {
  return exercise.equipment.every((equipment) => available.has(equipment));
}

function compatibleSubstitute(
  source: ExerciseSeedInput,
  available: Set<string>,
): ExerciseSeedInput | undefined {
  return source.substitution.similarExerciseIds
    .map((id) => exerciseById.get(id))
    .find((candidate): candidate is ExerciseSeedInput => Boolean(
      candidate
      && candidate.status === 'active'
      && candidate.availability.workoutGeneration
      && candidate.availability.substitution
      && candidate.movement.pattern === source.movement.pattern
      && candidate.target.primaryMuscle === source.target.primaryMuscle
      && isExecutable(candidate, available),
    ));
}

function priorityRank(exerciseId: string, priorities: string[]): number {
  const target = exerciseById.get(exerciseId)?.target.primaryMuscle;
  if (!target) return priorities.length;
  const index = priorities.findIndex((priority) => MUSCLE_FOCUS_MAP[priority]?.includes(target));
  return index < 0 ? priorities.length : index;
}

export type CompositionResult =
  | { status: 'COMPOSED'; sessions: FinalWorkoutSession[]; substitutions: ExerciseSubstitutionTrace[] }
  | { status: 'INVALID_CONFIGURATION'; reasonCodes: string[]; substitutions: ExerciseSubstitutionTrace[] }
  | { status: 'MISSING_EXERCISE'; reasonCodes: string[]; substitutions: ExerciseSubstitutionTrace[] };

export function composeTemplate(
  template: CanonicalTemplate,
  answers: QuestionnaireAnswers,
): CompositionResult {
  const substitutions: ExerciseSubstitutionTrace[] = [];
  const missing: string[] = [];
  const unresolved: string[] = [];
  const applyInventory = template.profile.environment === 'home';
  const available = availableEquipment(answers);
  const priorities = answers.muscleFocus.filter((value) => value !== 'none').slice(0, 2);

  const sessions = template.sessions.map((session, sessionIndex): FinalWorkoutSession => {
    const exercises = session.exercises.map((item) => {
      const source = exerciseById.get(item.exercise_id);
      if (!source) {
        missing.push(item.exercise_id);
        return {
          exerciseId: item.exercise_id,
          sourceExerciseId: item.exercise_id,
          sets: item.sets,
          reps: item.reps,
          duration: item.duration,
        };
      }
      let selected = source;
      if (applyInventory && !isExecutable(source, available)) {
        const replacement = compatibleSubstitute(source, available);
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
        exerciseId: selected.id,
        sourceExerciseId: source.id,
        sets: item.sets,
        reps: item.reps,
        duration: item.duration,
      };
    });

    // Reordering is safe and deterministic; the still-undefined volume
    // increase is represented separately as RULE_DEFINITION_REQUIRED.
    const ordered = exercises
      .map((exercise, index) => ({ exercise, index }))
      .sort((left, right) =>
        priorityRank(left.exercise.exerciseId, priorities) - priorityRank(right.exercise.exerciseId, priorities)
        || left.index - right.index,
      )
      .map(({ exercise }) => exercise);
    return { name: session.name, type: session.type, notes: session.notes, exercises: ordered };
  });

  if (missing.length) {
    return { status: 'MISSING_EXERCISE', reasonCodes: [...new Set(missing)].sort(), substitutions };
  }
  if (unresolved.length) {
    return { status: 'INVALID_CONFIGURATION', reasonCodes: [...new Set(unresolved)].sort(), substitutions };
  }
  return { status: 'COMPOSED', sessions, substitutions };
}

export function exerciseExists(exerciseId: string): boolean {
  return exerciseById.has(exerciseId);
}
