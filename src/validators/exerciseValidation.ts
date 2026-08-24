import {
  BODY_POSITIONS,
  EQUIPMENT_IDS,
  EXERCISE_DIFFICULTIES,
  EXERCISE_STATUSES,
  LATERALITIES,
  MECHANICS,
  MOVEMENT_PATTERNS,
  MUSCLE_IDS,
  MUSCLE_REGION_IDS,
  type ExerciseSeedInput,
} from '../types/exercise';

export interface ExerciseValidationResult {
  valid: boolean;
  errors: string[];
}

const asSet = <T extends string>(values: readonly T[]) => new Set<string>(values);

const MUSCLE_SET = asSet(MUSCLE_IDS);
const REGION_SET = asSet(MUSCLE_REGION_IDS);
const PATTERN_SET = asSet(MOVEMENT_PATTERNS);
const MECHANIC_SET = asSet(MECHANICS);
const LATERALITY_SET = asSet(LATERALITIES);
const EQUIPMENT_SET = asSet(EQUIPMENT_IDS);
const BODY_POSITION_SET = asSet(BODY_POSITIONS);
const DIFFICULTY_SET = asSet(EXERCISE_DIFFICULTIES);
const STATUS_SET = asSet(EXERCISE_STATUSES);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Blocks inline http(s)/data URLs — §11 of the seed task forbids inventing media URLs. */
const HAS_URL = (s: string) => /https?:\/\/|data:/i.test(s);

/**
 * Validates the full seed dataset as a set (not exercise-by-exercise):
 * catches duplicate ids/slugs/names and dangling `similarExerciseIds`
 * references, which can only be checked with the whole list in hand.
 * Used by both `scripts/seedExercises.ts` (pre-write gate) and the test
 * suite (`src/lib/__tests__/exercisesSeedData.test.ts`).
 */
export function validateExerciseSeed(exercises: ExerciseSeedInput[]): ExerciseValidationResult {
  const errors: string[] = [];

  const ids = new Set<string>();
  const slugs = new Set<string>();
  const namesPtBR = new Set<string>();

  for (const ex of exercises) {
    const tag = `[${ex.id || '(missing id)'}]`;

    if (!ex.id || !SLUG_RE.test(ex.id)) {
      errors.push(`${tag} id inválido (esperado slug kebab-case): "${ex.id}"`);
    } else if (ids.has(ex.id)) {
      errors.push(`${tag} id duplicado`);
    } else {
      ids.add(ex.id);
    }

    if (!ex.slug || !SLUG_RE.test(ex.slug)) {
      errors.push(`${tag} slug inválido: "${ex.slug}"`);
    } else if (slugs.has(ex.slug)) {
      errors.push(`${tag} slug duplicado: "${ex.slug}"`);
    } else {
      slugs.add(ex.slug);
    }

    if (ex.id && ex.slug && ex.id !== ex.slug) {
      errors.push(`${tag} id e slug devem ser iguais (id="${ex.id}", slug="${ex.slug}")`);
    }

    if (!ex.name?.ptBR?.trim()) {
      errors.push(`${tag} nome ptBR ausente`);
    } else if (namesPtBR.has(ex.name.ptBR)) {
      errors.push(`${tag} nome ptBR duplicado: "${ex.name.ptBR}"`);
    } else {
      namesPtBR.add(ex.name.ptBR);
    }
    if (!ex.name?.en?.trim()) errors.push(`${tag} nome en ausente`);
    if (!ex.name?.es?.trim()) errors.push(`${tag} nome es ausente`);

    if (!STATUS_SET.has(ex.status)) errors.push(`${tag} status inválido: "${ex.status}"`);
    if (!DIFFICULTY_SET.has(ex.difficulty)) errors.push(`${tag} difficulty inválida: "${ex.difficulty}"`);

    if (!MUSCLE_SET.has(ex.target?.primaryMuscle)) {
      errors.push(`${tag} target.primaryMuscle inválido: "${ex.target?.primaryMuscle}"`);
    }
    if (ex.target?.primaryRegion && !REGION_SET.has(ex.target.primaryRegion)) {
      errors.push(`${tag} target.primaryRegion inválido: "${ex.target.primaryRegion}"`);
    }
    for (const m of ex.target?.secondaryMuscles ?? []) {
      if (!MUSCLE_SET.has(m)) errors.push(`${tag} target.secondaryMuscles contém id inválido: "${m}"`);
    }
    if (ex.target?.secondaryMuscles?.includes(ex.target?.primaryMuscle)) {
      errors.push(`${tag} primaryMuscle repetido em secondaryMuscles`);
    }

    if (!PATTERN_SET.has(ex.movement?.pattern)) {
      errors.push(`${tag} movement.pattern inválido: "${ex.movement?.pattern}"`);
    }
    if (!MECHANIC_SET.has(ex.movement?.mechanic)) {
      errors.push(`${tag} movement.mechanic inválido: "${ex.movement?.mechanic}"`);
    }
    if (!LATERALITY_SET.has(ex.movement?.laterality)) {
      errors.push(`${tag} movement.laterality inválida: "${ex.movement?.laterality}"`);
    }

    if (!ex.equipment?.length) {
      errors.push(`${tag} equipment vazio`);
    } else {
      for (const eq of ex.equipment) {
        if (!EQUIPMENT_SET.has(eq)) errors.push(`${tag} equipment contém id inválido: "${eq}"`);
      }
    }

    if (ex.bodyPosition && !BODY_POSITION_SET.has(ex.bodyPosition)) {
      errors.push(`${tag} bodyPosition inválido: "${ex.bodyPosition}"`);
    }

    for (const orientation of ['vertical', 'horizontal'] as const) {
      const video = ex.execution?.videos?.[orientation];
      if (!video) continue;
      if (!video.url || !HAS_URL(video.url)) {
        errors.push(`${tag} execution.videos.${orientation}.url presente mas não parece uma URL válida`);
      }
      if (!video.storagePath || typeof video.storagePath !== 'string' || HAS_URL(video.storagePath)) {
        errors.push(`${tag} execution.videos.${orientation}.storagePath ausente ou inválido (esperado path do Storage, não URL)`);
      }
    }

    if (!ex.execution || typeof ex.execution !== 'object') {
      errors.push(`${tag} execution ausente`);
    }

    if (ex.instructions) {
      for (const locale of ['ptBR', 'en', 'es'] as const) {
        const steps = ex.instructions[locale];
        if (!steps?.length || steps.some((step) => !step.trim())) {
          errors.push(`${tag} instructions.${locale} ausente ou vazia`);
        }
      }
    }

    if (!ex.availability) {
      errors.push(`${tag} availability ausente`);
    } else {
      for (const key of ['workoutGeneration', 'manualSelection', 'substitution'] as const) {
        if (typeof ex.availability[key] !== 'boolean') {
          errors.push(`${tag} availability.${key} ausente ou inválida`);
        }
      }
    }

    if (!ex.substitution || !Array.isArray(ex.substitution.similarExerciseIds)) {
      errors.push(`${tag} substitution.similarExerciseIds ausente ou inválido`);
    }

    if (ex.substitution?.similarExerciseIds?.includes(ex.id)) {
      errors.push(`${tag} similarExerciseIds contém autorreferência`);
    }
  }

  for (const ex of exercises) {
    for (const simId of ex.substitution?.similarExerciseIds ?? []) {
      if (!ids.has(simId)) {
        errors.push(`[${ex.id}] similarExerciseIds referencia id inexistente: "${simId}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
