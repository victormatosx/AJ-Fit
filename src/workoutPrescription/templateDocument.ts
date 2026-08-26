import type { CanonicalTemplate, TemplateId } from './types';

export const WORKOUT_TEMPLATE_DOCUMENT_VERSION = 1;
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
  };
  split: string;
  rationale: string;
  assumptions?: unknown;
  safety?: unknown;
  sessions: Array<{
    name: string;
    type: string;
    notes?: string;
    exercises: Array<{
      exerciseId: string;
      sets?: number;
      reps?: string;
      duration?: string;
      cycles?: number;
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
    },
    split: template.split,
    rationale: template.rationale,
    assumptions: template.assumptions,
    safety: template.safety,
    sessions: template.sessions.map((session) => ({
      name: session.name,
      type: session.type,
      notes: session.notes,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exercise_id,
        sets: exercise.sets,
        reps: exercise.reps,
        duration: exercise.duration,
        cycles: exercise.cycles,
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
    },
    split: doc.split,
    rationale: doc.rationale,
    ...(doc.assumptions !== undefined ? { assumptions: doc.assumptions } : {}),
    ...(doc.safety !== undefined ? { safety: doc.safety } : {}),
    sessions: doc.sessions.map((session) => ({
      name: session.name,
      type: session.type,
      ...(session.notes ? { notes: session.notes } : {}),
      exercises: session.exercises.map((exercise) => ({
        name: exercise.exerciseId,
        exercise_id: exercise.exerciseId,
        ...(exercise.sets !== undefined ? { sets: exercise.sets } : {}),
        ...(exercise.reps !== undefined ? { reps: exercise.reps } : {}),
        ...(exercise.duration !== undefined ? { duration: exercise.duration } : {}),
        ...(exercise.cycles !== undefined ? { cycles: exercise.cycles } : {}),
        ...(exercise.intensity !== undefined ? { intensity: exercise.intensity } : {}),
        ...(exercise.notes !== undefined ? { notes: exercise.notes } : {}),
      })),
    })),
  };
}
