import type { ExerciseSeedInput } from '../types/exercise';
import type { QuestionnaireAnswers, TemplateEnvironment } from './types';

const EQUIPMENT_MAP: Record<string, ExerciseSeedInput['equipment']> = {
  bodyweight: ['bodyweight'],
  dumbbells: ['dumbbell'],
  bands: ['resistance_band', 'mini_band'],
  bench_or_box: ['bench', 'chair', 'step'],
  barbell: ['barbell', 'ez_bar'],
  none: ['bodyweight'],
};

/** Every equipment tag any `EQUIPMENT_MAP` answer could ever unlock — i.e. the full common-home-kit assumption, deliberately excluding true gym-only machinery (`machine`, `cable`, `smith_machine`, etc., which have no entry in `EQUIPMENT_MAP` at all). */
const ALL_HOME_ANSWERABLE_EQUIPMENT: readonly string[] = [...new Set(Object.values(EQUIPMENT_MAP).flat())];

export interface EquipmentContext {
  environment: TemplateEnvironment;
  availableEquipment: ReadonlySet<string>;
}

export function equipmentContextFor(
  answers: QuestionnaireAnswers,
  environment: TemplateEnvironment,
): EquipmentContext {
  const availableEquipment = new Set<string>(['bodyweight']);
  for (const answer of answers.equipment) {
    for (const item of EQUIPMENT_MAP[answer] ?? []) availableEquipment.add(item);
  }
  return { environment, availableEquipment };
}

/**
 * An `EquipmentContext` that is blind to `answers.equipment` — every home
 * equipment tag the (removed) questionnaire question could ever have
 * unlocked is assumed present, so no candidate is ever rejected for a
 * "missing home item" reason. Gym-only machinery (`machine`, `cable`,
 * `smith_machine`, etc.) is deliberately NOT included: this context still
 * respects the gym/home environment boundary (a home program can never
 * evolve into a machine-based exercise) — it only stops gating on WHICH
 * specific home items the user claims to own, which is the actual product
 * decision under audit.
 *
 * Used where an authoritative v1.27 program needs an `EquipmentContext`
 * value for a shared (v2-and-v1.27) code path (e.g. `evolveCycle`'s
 * substitution candidate filtering) but must not let `answers.equipment`
 * influence the outcome: v1.27 never considers a home equipment inventory
 * at any lifecycle stage (selection, composition, or cycle evolution) — the
 * decision is which engine version generated the active program, never
 * client input (see docs/workout-modifiers equipment audit).
 */
export function unrestrictedEquipmentContext(environment: TemplateEnvironment): EquipmentContext {
  return { environment, availableEquipment: new Set<string>(ALL_HOME_ANSWERABLE_EQUIPMENT) };
}

export function isExerciseExecutable(
  exercise: Pick<ExerciseSeedInput, 'equipment'>,
  context: EquipmentContext,
): boolean {
  return context.environment === 'gym'
    || exercise.equipment.every((equipment) => context.availableEquipment.has(equipment));
}
