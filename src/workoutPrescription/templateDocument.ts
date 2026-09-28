import type { CanonicalCardioFinisher, CanonicalTemplate, TemplateId } from './types';

export const WORKOUT_TEMPLATE_DOCUMENT_VERSION = 2;
export const WORKOUT_TEMPLATE_STATUS = 'active' as const;

export interface WorkoutTemplateDocumentBody {
  id: TemplateId;
  version: number;
  sourceVersion: string;
  libraryId: string;
  status: typeof WORKOUT_TEMPLATE_STATUS;
  profile: {
    sex: CanonicalTemplate['profile']['sex'];
    environment: CanonicalTemplate['profile']['environment'];
    primaryGoal: CanonicalTemplate['profile']['primary_goal'];
    daysPerWeek: number;
    specialPopulation?: NonNullable<CanonicalTemplate['profile']['special_population']>;
    experienceLevel?: 'beginner';
  };
  split: string;
  rationale: string;
  assumptions?: unknown;
  safety?: unknown;
  sessions: Array<{
    name: string;
    displayName?: string;
    type: string;
    notes?: string;
    techniqueGuideline?: string;
    effortGuideline?: string;
    restGuideline?: string;
    progressionGuideline?: string;
    cardioFinisher?: {
      mode: string;
      exerciseOptions?: string[];
      duration?: string;
      intensity?: string;
      required: boolean;
      safetyGated?: boolean;
      notes?: string;
    };
    exercises: Array<{
      exerciseId: string;
      name?: string;
      sets?: number;
      reps?: string;
      duration?: string;
      cycles?: number;
      cycleRange?: { min: number; max: number };
      distance?: string;
      intensity?: string;
      notes?: string;
    }>;
  }>;
}

export interface WorkoutTemplateDocument extends WorkoutTemplateDocumentBody {
  contentHash: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    ) as T;
  }
  return value;
}

export function toWorkoutTemplateDocumentBody(
  template: CanonicalTemplate,
  sourceVersion: string,
  libraryId: string,
): WorkoutTemplateDocumentBody {
  return withoutUndefined({
    id: template.id,
    version: WORKOUT_TEMPLATE_DOCUMENT_VERSION,
    sourceVersion,
    libraryId,
    status: WORKOUT_TEMPLATE_STATUS,
    profile: {
      sex: template.profile.sex,
      environment: template.profile.environment,
      primaryGoal: template.profile.primary_goal,
      daysPerWeek: template.profile.days_per_week,
      specialPopulation: template.profile.special_population,
      experienceLevel: template.profile.experience_level,
    },
    split: template.split,
    rationale: template.rationale,
    assumptions: template.assumptions,
    safety: template.safety,
    sessions: template.sessions.map((session) => ({
      name: session.name,
      displayName: session.display_name ?? session.name,
      type: session.type,
      notes: session.notes,
      techniqueGuideline: session.technique_guideline,
      effortGuideline: session.effort_guideline,
      restGuideline: session.rest_guideline,
      progressionGuideline: session.progression_guideline,
      cardioFinisher: session.cardio_finisher ? {
        mode: session.cardio_finisher.mode,
        exerciseOptions: session.cardio_finisher.exercise_options,
        duration: session.cardio_finisher.duration,
        intensity: session.cardio_finisher.intensity,
        required: session.cardio_finisher.required,
        safetyGated: session.cardio_finisher.safety_gated,
        notes: session.cardio_finisher.notes,
      } : undefined,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exercise_id,
        // Keep v2.0 document hashes stable; v1.27 persists its authored name.
        name: sourceVersion === '1.27.0' ? exercise.name : undefined,
        sets: exercise.sets,
        reps: exercise.reps,
        duration: exercise.duration,
        cycles: exercise.cycles,
        cycleRange: exercise.cycleRange,
        distance: exercise.distance,
        intensity: exercise.intensity,
        notes: exercise.notes,
      })),
    })),
  });
}

export function fromWorkoutTemplateDocument(doc: WorkoutTemplateDocument): CanonicalTemplate {
  return {
    id: doc.id,
    profile: {
      sex: doc.profile.sex,
      environment: doc.profile.environment,
      primary_goal: doc.profile.primaryGoal,
      days_per_week: doc.profile.daysPerWeek,
      ...(doc.profile.specialPopulation ? { special_population: doc.profile.specialPopulation } : {}),
      ...(doc.profile.experienceLevel ? { experience_level: doc.profile.experienceLevel } : {}),
    },
    split: doc.split,
    rationale: doc.rationale,
    ...(doc.assumptions !== undefined ? { assumptions: doc.assumptions } : {}),
    ...(doc.safety !== undefined ? { safety: doc.safety } : {}),
    sessions: doc.sessions.map((session) => ({
      name: session.name,
      display_name: session.displayName ?? session.name,
      type: session.type,
      ...(session.notes ? { notes: session.notes } : {}),
      ...(session.techniqueGuideline ? { technique_guideline: session.techniqueGuideline } : {}),
      ...(session.effortGuideline ? { effort_guideline: session.effortGuideline } : {}),
      ...(session.restGuideline ? { rest_guideline: session.restGuideline } : {}),
      ...(session.progressionGuideline ? { progression_guideline: session.progressionGuideline } : {}),
      ...(session.cardioFinisher ? {
        cardio_finisher: {
          mode: session.cardioFinisher.mode,
          ...(session.cardioFinisher.exerciseOptions
            ? { exercise_options: [...session.cardioFinisher.exerciseOptions] }
            : {}),
          ...(session.cardioFinisher.duration ? { duration: session.cardioFinisher.duration } : {}),
          ...(session.cardioFinisher.intensity ? { intensity: session.cardioFinisher.intensity } : {}),
          required: session.cardioFinisher.required,
          ...(session.cardioFinisher.safetyGated !== undefined
            ? { safety_gated: session.cardioFinisher.safetyGated }
            : {}),
          ...(session.cardioFinisher.notes !== undefined ? { notes: session.cardioFinisher.notes } : {}),
        } satisfies CanonicalCardioFinisher,
      } : {}),
      exercises: session.exercises.map((exercise) => ({
        name: exercise.name ?? exercise.exerciseId,
        exercise_id: exercise.exerciseId,
        ...(exercise.sets !== undefined ? { sets: exercise.sets } : {}),
        ...(exercise.reps !== undefined ? { reps: exercise.reps } : {}),
        ...(exercise.duration !== undefined ? { duration: exercise.duration } : {}),
        ...(exercise.cycles !== undefined ? { cycles: exercise.cycles } : {}),
        ...(exercise.cycleRange !== undefined ? { cycleRange: exercise.cycleRange } : {}),
        ...(exercise.distance !== undefined ? { distance: exercise.distance } : {}),
        ...(exercise.intensity !== undefined ? { intensity: exercise.intensity } : {}),
        ...(exercise.notes !== undefined ? { notes: exercise.notes } : {}),
      })),
    })),
  };
}
