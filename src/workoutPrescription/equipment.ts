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

export function isExerciseExecutable(
  exercise: Pick<ExerciseSeedInput, 'equipment'>,
  context: EquipmentContext,
): boolean {
  return context.environment === 'gym'
    || exercise.equipment.every((equipment) => context.availableEquipment.has(equipment));
}
