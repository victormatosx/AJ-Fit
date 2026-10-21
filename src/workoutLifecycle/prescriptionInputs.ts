import { defaultQuiz, type Quiz } from '../state/AppState';
import { normalizeLoadedQuiz } from '../lib/questionnaireSchema';
import {
  PRESCRIPTION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  type CurrentTrainingLevel,
  type EffectivePrescriptionInputs,
  type PrescriptionInputSnapshot,
  type PrescriptionInputSnapshotSource,
} from './types';

const SOURCES = new Set<PrescriptionInputSnapshotSource>([
  'QUESTIONNAIRE_BASELINE',
  'PROGRAM_ADAPTATION',
  'LEVEL_PROMOTION',
  'CYCLE_EVOLUTION',
  'MOTIVATIONAL_RENEWAL',
]);

const INPUT_KEYS: readonly (keyof EffectivePrescriptionInputs)[] = [
  'sex', 'goal', 'level', 'duration', 'days', 'scheduleMode', 'trainingDays',
  'place', 'equipment', 'style', 'muscleFocus',
  'specialConditions', 'pregnancyScreening', 'postpartumScreening',
  'functionalScreening', 'lipedemaScreening', 'dizzinessScreening',
  'postSurgicalScreening', 'medicalRestrictionScreening',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function questionnaireLevelForCurrentLevel(level: CurrentTrainingLevel): Quiz['level'] {
  if (level === 'BEGINNER') return 'beginner';
  if (level === 'INTERMEDIATE') return 'intermediate';
  return 'advanced';
}

function cloneNullableRecord<T extends Record<string, unknown>>(value: T | null): T | null {
  return value == null ? null : JSON.parse(JSON.stringify(value)) as T;
}

export function effectivePrescriptionInputsFromAnswers(
  answers: Quiz,
  currentTrainingLevel: CurrentTrainingLevel,
): EffectivePrescriptionInputs {
  return {
    sex: answers.sex,
    goal: answers.goal,
    level: questionnaireLevelForCurrentLevel(currentTrainingLevel),
    duration: answers.duration,
    days: answers.days,
    scheduleMode: answers.scheduleMode ?? 'fixed',
    trainingDays: answers.trainingDays ? [...answers.trainingDays] : null,
    place: answers.place,
    equipment: [...answers.equipment],
    style: [...answers.style],
    muscleFocus: [...answers.muscleFocus],
    specialConditions: answers.specialConditions.filter(value => value !== ('musculoskeletal_limitation' as string)),
    pregnancyScreening: cloneNullableRecord(answers.pregnancyScreening),
    postpartumScreening: cloneNullableRecord(answers.postpartumScreening),
    functionalScreening: cloneNullableRecord(answers.functionalScreening),
    lipedemaScreening: cloneNullableRecord(answers.lipedemaScreening),
    dizzinessScreening: cloneNullableRecord(answers.dizzinessScreening),
    postSurgicalScreening: cloneNullableRecord(answers.postSurgicalScreening),
    medicalRestrictionScreening: cloneNullableRecord(answers.medicalRestrictionScreening),
  };
}

export function buildPrescriptionInputSnapshot(input: {
  answers: Quiz;
  currentTrainingLevel: CurrentTrainingLevel;
  source: PrescriptionInputSnapshotSource;
}): PrescriptionInputSnapshot {
  const inputs = effectivePrescriptionInputsFromAnswers(input.answers, input.currentTrainingLevel);
  const identity = stableStringify({
    schemaVersion: PRESCRIPTION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    source: input.source,
    inputs,
  });
  return {
    snapshotId: `pis_${stableHash(identity)}`,
    schemaVersion: PRESCRIPTION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    source: input.source,
    inputs,
  };
}

export function questionnaireAnswersFromPrescriptionInputs(inputs: EffectivePrescriptionInputs): Quiz {
  const legacyInputs = inputs as EffectivePrescriptionInputs & { place: Quiz['place'] | 'both'; primaryPlace?: unknown };
  return normalizeLoadedQuiz({
    ...defaultQuiz,
    ...legacyInputs,
    scheduleMode: inputs.scheduleMode ?? 'fixed',
    trainingDays: inputs.trainingDays ? [...inputs.trainingDays] : null,
    equipment: [...inputs.equipment],
    style: [...inputs.style],
    muscleFocus: [...inputs.muscleFocus],
    // `musculoskeletal_limitation` is purely informational onboarding-UI
    // state (never part of `EffectivePrescriptionInputs` in practice —
    // `effectivePrescriptionInputsFromAnswers` above already filters it
    // out) — this is a defensive backstop against resurrecting it from a
    // malformed/legacy snapshot shape into live prescription-continuity state.
    specialConditions: inputs.specialConditions.filter(value => value !== ('musculoskeletal_limitation' as string)),
    pregnancyScreening: cloneNullableRecord(inputs.pregnancyScreening),
    postpartumScreening: cloneNullableRecord(inputs.postpartumScreening),
    functionalScreening: cloneNullableRecord(inputs.functionalScreening),
    lipedemaScreening: cloneNullableRecord(inputs.lipedemaScreening),
    dizzinessScreening: cloneNullableRecord(inputs.dizzinessScreening),
    postSurgicalScreening: cloneNullableRecord(inputs.postSurgicalScreening),
    medicalRestrictionScreening: cloneNullableRecord(inputs.medicalRestrictionScreening),
  });
}

export function isPrescriptionInputSnapshot(value: unknown): value is PrescriptionInputSnapshot {
  if (!isRecord(value) || !isRecord(value.inputs)) return false;
  const keys = Object.keys(value.inputs).filter(key => key !== 'limits').sort();
  const currentKeys = [...INPUT_KEYS];
  const withoutScheduleMode = currentKeys.filter((key) => key !== 'scheduleMode');
  const withLegacyPrimaryPlace = [...currentKeys, 'primaryPlace'];
  const legacyWithoutScheduleMode = withLegacyPrimaryPlace.filter((key) => key !== 'scheduleMode');
  const hasExactKeys = (expected: readonly string[]) =>
    keys.length === expected.length && expected.every((key) => keys.includes(key));
  if (![currentKeys, withoutScheduleMode, withLegacyPrimaryPlace, legacyWithoutScheduleMode].some(hasExactKeys)) return false;
  return typeof value.snapshotId === 'string' && value.snapshotId.startsWith('pis_')
    && value.schemaVersion === PRESCRIPTION_INPUT_SNAPSHOT_SCHEMA_VERSION
    && SOURCES.has(value.source as PrescriptionInputSnapshotSource)
    && Array.isArray(value.inputs.equipment)
    && Array.isArray(value.inputs.style)
    && Array.isArray(value.inputs.muscleFocus)
    && Array.isArray(value.inputs.specialConditions)
    && (value.inputs.scheduleMode === undefined || value.inputs.scheduleMode === 'fixed' || value.inputs.scheduleMode === 'flexible')
    && (value.inputs.trainingDays === null || Array.isArray(value.inputs.trainingDays));
}
