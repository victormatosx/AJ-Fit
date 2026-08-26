import {
  defaultQuiz,
  WEEKDAY_ORDER,
  type DizzinessScreening,
  type FunctionalScreening,
  type LipedemaScreening,
  type MedicalRestrictionScreening,
  type PostSurgicalScreening,
  type PostpartumScreening,
  type PregnancyScreening,
  type Quiz,
  type Weekday,
} from '../state/AppState';
import type { OnboardingStepId } from '../onboarding/steps';

export const HOME_EQUIPMENT_IDS = ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell', 'other', 'none'] as const;
export const LIMITATION_IDS = ['none', 'knee', 'hip', 'back', 'shoulder', 'elbow', 'wrist', 'ankle_foot', 'other'] as const;
export const POSTPARTUM_SIGN_IDS = ['pain', 'healing_problems', 'abnormal_bleeding', 'incontinence', 'vaginal_pressure', 'dizziness_weakness', 'none'] as const;
export const PREGNANCY_WARNING_SIGN_IDS = ['vaginal_bleeding', 'dizziness_fainting', 'chest_pain', 'unusual_shortness_of_breath', 'painful_regular_contractions', 'fluid_leakage', 'calf_pain_swelling', 'none'] as const;
export const FUNCTIONAL_SITUATION_IDS = ['walking_difficulty', 'support_needed', 'stairs_difficulty', 'balance_problems', 'recent_fall', 'sit_to_stand_difficulty', 'daily_activities_difficulty', 'none'] as const;

/** Dedupes, drops unknown values, and sorts to canonical chronological order — never the order the user clicked (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md). */
export function normalizeWeekdays(values: string[]): Weekday[] {
  const valid = new Set<string>(WEEKDAY_ORDER);
  const deduped = [...new Set(values.filter((value) => valid.has(value)))] as Weekday[];
  return WEEKDAY_ORDER.filter((day) => deduped.includes(day));
}

export function exclusiveNone(values: string[]): string[] {
  if (!values.includes('none')) return [...new Set(values)];
  return values.at(-1) === 'none' ? ['none'] : [...new Set(values.filter((value) => value !== 'none'))];
}

function normalizeSpecialConditions(values: string[]): Quiz['specialConditions'] {
  const normalized = exclusiveNone(values) as Quiz['specialConditions'];
  if (!normalized.includes('pregnancy') || !normalized.includes('postpartum')) return normalized;
  const lastStatus = [...normalized].reverse().find((value) => value === 'pregnancy' || value === 'postpartum');
  return normalized.filter((value) => (value !== 'pregnancy' && value !== 'postpartum') || value === lastStatus);
}

const emptyPregnancyScreening = (): PregnancyScreening => ({ weeks: null, prenatalCare: null, exerciseRestriction: null, complication: null, warningSigns: [] });
const emptyPostpartumScreening = (): PostpartumScreening => ({ timeSinceBirth: null, deliveryType: null, signs: [], returnClearance: null });
const emptyFunctionalScreening = (): FunctionalScreening => ({ situations: [] });
const emptyLipedemaScreening = (): LipedemaScreening => ({ symptomImpact: null, professionalGuidance: null });
const emptyDizzinessScreening = (): DizzinessScreening => ({ symptomFrequency: null, affectsBalance: null });
const emptyPostSurgicalScreening = (): PostSurgicalScreening => ({ recoveryStatus: null, bodyRegion: null, returnClearance: null });
const emptyMedicalRestrictionScreening = (): MedicalRestrictionScreening => ({ professionalExerciseRestriction: null });

/** Removes hidden branch answers after every edit and before persistence. */
export function cleanApplicableAnswers(input: Quiz): Quiz {
  let specialConditions = normalizeSpecialConditions(input.specialConditions);
  if (input.sex !== 'f') specialConditions = specialConditions.filter((value) => value !== 'pregnancy' && value !== 'postpartum');
  const has = (condition: Quiz['specialConditions'][number]) => specialConditions.includes(condition);
  const postpartum = has('postpartum') ? (input.postpartumScreening ?? emptyPostpartumScreening()) : null;
  const functional = has('functional_limitation') ? (input.functionalScreening ?? emptyFunctionalScreening()) : null;
  return {
    ...input,
    // days === 7 needs no explicit preference: every weekday is implied and
    // never asked (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Coleta
    // futura). For 2-6, keep whatever subset the user has picked so far —
    // the exact-count requirement is enforced by
    // `questionnaireValidationErrors`/`canContinueQuestion`, not silently
    // truncated here.
    trainingDays: input.days === 7
      ? [...WEEKDAY_ORDER]
      : input.days == null
        ? null
        : normalizeWeekdays(input.trainingDays ?? []),
    primaryPlace: input.place === 'both' ? input.primaryPlace : null,
    equipment: input.place === 'home' || input.place === 'both' ? exclusiveNone(input.equipment) : [],
    limits: has('musculoskeletal_limitation') ? exclusiveNone(input.limits) : [],
    limitationImpact: has('musculoskeletal_limitation') ? input.limitationImpact : null,
    muscleFocus: exclusiveNone(input.muscleFocus).slice(0, 2),
    specialConditions,
    pregnancyScreening: has('pregnancy')
      ? { ...(input.pregnancyScreening ?? emptyPregnancyScreening()), warningSigns: exclusiveNone(input.pregnancyScreening?.warningSigns ?? []) }
      : null,
    postpartumScreening: postpartum ? { ...postpartum, signs: exclusiveNone(postpartum.signs) } : null,
    functionalScreening: functional ? { ...functional, situations: exclusiveNone(functional.situations) } : null,
    lipedemaScreening: has('lipedema') ? (input.lipedemaScreening ?? emptyLipedemaScreening()) : null,
    dizzinessScreening: has('dizziness_or_vertigo') ? (input.dizzinessScreening ?? emptyDizzinessScreening()) : null,
    postSurgicalScreening: has('post_surgical') ? (input.postSurgicalScreening ?? emptyPostSurgicalScreening()) : null,
    medicalRestrictionScreening: has('medical_restriction') ? (input.medicalRestrictionScreening ?? emptyMedicalRestrictionScreening()) : null,
  };
}

/** Defensive read compatibility for sparse/malformed and all v1 questionnaires. */
export function normalizeLoadedQuiz(input: Partial<Quiz>): Quiz {
  const merged = { ...defaultQuiz, ...input };
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const allowedConditions: string[] = ['none', 'musculoskeletal_limitation', 'pregnancy', 'postpartum', 'lipedema', 'dizziness_or_vertigo', 'post_surgical', 'functional_limitation', 'medical_restriction'];
  const loadedLimits = strings(merged.limits);
  // Legacy questionnaires (pre-Schedule Engine) have no `trainingDays` at
  // all — never invent weekdays for them; the Schedule Engine treats a null
  // value as SCHEDULE_SETUP_REQUIRED rather than guessing a preference.
  const trainingDays = merged.days === 7
    ? [...WEEKDAY_ORDER]
    : Array.isArray(merged.trainingDays) && merged.trainingDays.length > 0
      ? normalizeWeekdays(strings(merged.trainingDays))
      : null;
  const loadedConditions = strings(merged.specialConditions).filter((value): value is Quiz['specialConditions'][number] => allowedConditions.includes(value));
  // Phase 1 asked `limits` before this condition existed in the router. Only
  // infer the new branch when the old document has no router answer at all;
  // an explicit `none` in a new document must continue to clear stale data.
  const specialConditions = loadedConditions.length === 0 && loadedLimits.some((value) => value !== 'none')
    ? ['musculoskeletal_limitation' as const]
    : loadedConditions;
  return {
    ...merged,
    limits: loadedLimits,
    trainingDays,
    equipment: strings(merged.equipment),
    style: strings(merged.style),
    muscleFocus: strings(merged.muscleFocus).slice(0, 2),
    specialConditions,
    pregnancyScreening: merged.pregnancyScreening && typeof merged.pregnancyScreening === 'object'
      ? { ...emptyPregnancyScreening(), ...merged.pregnancyScreening, warningSigns: strings(merged.pregnancyScreening.warningSigns) }
      : null,
    postpartumScreening: merged.postpartumScreening && typeof merged.postpartumScreening === 'object'
      ? { ...emptyPostpartumScreening(), ...merged.postpartumScreening, signs: strings(merged.postpartumScreening.signs) }
      : null,
    functionalScreening: merged.functionalScreening && typeof merged.functionalScreening === 'object'
      ? { ...emptyFunctionalScreening(), ...merged.functionalScreening, situations: strings(merged.functionalScreening.situations) }
      : null,
    lipedemaScreening: merged.lipedemaScreening && typeof merged.lipedemaScreening === 'object' ? { ...emptyLipedemaScreening(), ...merged.lipedemaScreening } : null,
    dizzinessScreening: merged.dizzinessScreening && typeof merged.dizzinessScreening === 'object' ? { ...emptyDizzinessScreening(), ...merged.dizzinessScreening } : null,
    postSurgicalScreening: merged.postSurgicalScreening && typeof merged.postSurgicalScreening === 'object' ? { ...emptyPostSurgicalScreening(), ...merged.postSurgicalScreening } : null,
    medicalRestrictionScreening: merged.medicalRestrictionScreening && typeof merged.medicalRestrictionScreening === 'object' ? { ...emptyMedicalRestrictionScreening(), ...merged.medicalRestrictionScreening } : null,
  };
}

export function updateQuizAnswer(quiz: Quiz, stepId: OnboardingStepId, value: unknown): Quiz {
  let next: Quiz;
  switch (stepId) {
    case 'days': next = { ...quiz, days: Number(value) }; break;
    case 'trainingDays': next = { ...quiz, trainingDays: normalizeWeekdays(value as string[]) }; break;
    case 'primaryPlace': next = { ...quiz, primaryPlace: value as Quiz['primaryPlace'] }; break;
    case 'limitationImpact': next = { ...quiz, limitationImpact: value as Quiz['limitationImpact'] }; break;
    case 'specialConditions': next = { ...quiz, specialConditions: normalizeSpecialConditions(value as string[]) }; break;
    case 'pregnancyWeeks': next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), weeks: value as number } }; break;
    case 'pregnancyCare': next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), ...(value as Pick<PregnancyScreening, 'prenatalCare' | 'exerciseRestriction' | 'complication'>) } }; break;
    case 'pregnancyWarningSigns': next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), warningSigns: exclusiveNone(value as string[]) } }; break;
    case 'postpartumContext': next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), ...(value as Pick<PostpartumScreening, 'timeSinceBirth' | 'deliveryType'>) } }; break;
    case 'postpartumSigns': next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), signs: exclusiveNone(value as string[]) } }; break;
    case 'postpartumReturnClearance': next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), returnClearance: value as PostpartumScreening['returnClearance'] } }; break;
    case 'functionalSituations': next = { ...quiz, functionalScreening: { situations: exclusiveNone(value as string[]) } }; break;
    case 'lipedemaScreening': next = { ...quiz, lipedemaScreening: value as LipedemaScreening }; break;
    case 'dizzinessScreening': next = { ...quiz, dizzinessScreening: value as DizzinessScreening }; break;
    case 'postSurgicalStatus': next = { ...quiz, postSurgicalScreening: { ...(quiz.postSurgicalScreening ?? emptyPostSurgicalScreening()), ...(value as Pick<PostSurgicalScreening, 'recoveryStatus' | 'returnClearance'>) } }; break;
    case 'postSurgicalRegion': next = { ...quiz, postSurgicalScreening: { ...(quiz.postSurgicalScreening ?? emptyPostSurgicalScreening()), bodyRegion: value as PostSurgicalScreening['bodyRegion'] } }; break;
    case 'medicalRestrictionDetails': next = { ...quiz, medicalRestrictionScreening: { professionalExerciseRestriction: value as MedicalRestrictionScreening['professionalExerciseRestriction'] } }; break;
    default: next = { ...quiz, [stepId]: value } as Quiz;
  }
  return cleanApplicableAnswers(next);
}

export function answerValueForStep(quiz: Quiz, stepId: OnboardingStepId): unknown {
  switch (stepId) {
    case 'days': return quiz.days == null ? null : String(quiz.days);
    case 'pregnancyWeeks': return quiz.pregnancyScreening?.weeks ?? null;
    case 'pregnancyCare': return { prenatalCare: quiz.pregnancyScreening?.prenatalCare ?? null, exerciseRestriction: quiz.pregnancyScreening?.exerciseRestriction ?? null, complication: quiz.pregnancyScreening?.complication ?? null };
    case 'pregnancyWarningSigns': return quiz.pregnancyScreening?.warningSigns ?? [];
    case 'postpartumContext': return { timeSinceBirth: quiz.postpartumScreening?.timeSinceBirth ?? null, deliveryType: quiz.postpartumScreening?.deliveryType ?? null };
    case 'postpartumSigns': return quiz.postpartumScreening?.signs ?? [];
    case 'postpartumReturnClearance': return quiz.postpartumScreening?.returnClearance ?? null;
    case 'functionalSituations': return quiz.functionalScreening?.situations ?? [];
    case 'lipedemaScreening': return quiz.lipedemaScreening ?? emptyLipedemaScreening();
    case 'dizzinessScreening': return quiz.dizzinessScreening ?? emptyDizzinessScreening();
    case 'postSurgicalStatus': return { recoveryStatus: quiz.postSurgicalScreening?.recoveryStatus ?? null, returnClearance: quiz.postSurgicalScreening?.returnClearance ?? null };
    case 'postSurgicalRegion': return quiz.postSurgicalScreening?.bodyRegion ?? null;
    case 'medicalRestrictionDetails': return quiz.medicalRestrictionScreening?.professionalExerciseRestriction ?? null;
    default: return quiz[stepId as keyof Quiz];
  }
}

export type QuestionnaireValidationCode =
  | 'unsupported_days' | 'too_many_muscle_priorities' | 'exclusive_none_conflict'
  | 'primary_place_required' | 'equipment_required' | 'limitations_required' | 'limitation_impact_required'
  | 'pregnancy_screening_incomplete' | 'postpartum_screening_incomplete' | 'functional_screening_incomplete'
  | 'lipedema_screening_incomplete' | 'dizziness_screening_incomplete'
  | 'post_surgical_screening_incomplete' | 'medical_restriction_screening_incomplete';

function hasNoneConflict(values: string[]): boolean { return values.includes('none') && values.length > 1; }

/**
 * Schedule Engine's own gate — deliberately NOT part of
 * `questionnaireValidationErrors`. Prescription (Selection/Safety/Modifiers/
 * Composition) must keep generating a plan even for a legacy user who has
 * never answered `trainingDays`; the Schedule Engine treats that case as
 * `SCHEDULE_SETUP_REQUIRED` on its own (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md), never by blocking the prescription pipeline.
 */
export function trainingDaysValid(quiz: Pick<Quiz, 'days' | 'trainingDays'>): boolean {
  if (quiz.days == null || ![2, 3, 4, 5, 6, 7].includes(quiz.days)) return false;
  return (quiz.trainingDays?.length ?? 0) === quiz.days;
}

/** Locale-free domain validation used by tests and persistence callers. */
export function questionnaireValidationErrors(quiz: Quiz): QuestionnaireValidationCode[] {
  const errors: QuestionnaireValidationCode[] = [];
  if (quiz.days == null || ![2, 3, 4, 5, 6, 7].includes(quiz.days)) errors.push('unsupported_days');
  if (quiz.muscleFocus.filter((value) => value !== 'none').length > 2) errors.push('too_many_muscle_priorities');
  if ([quiz.equipment, quiz.limits, quiz.muscleFocus, quiz.specialConditions, quiz.pregnancyScreening?.warningSigns ?? [], quiz.postpartumScreening?.signs ?? [], quiz.functionalScreening?.situations ?? []].some(hasNoneConflict)) errors.push('exclusive_none_conflict');
  if (quiz.place === 'both' && !quiz.primaryPlace) errors.push('primary_place_required');
  if ((quiz.place === 'home' || quiz.place === 'both') && quiz.equipment.length === 0) errors.push('equipment_required');
  if (quiz.specialConditions.includes('musculoskeletal_limitation')) {
    if (quiz.limits.length === 0 || quiz.limits.includes('none')) errors.push('limitations_required');
    if (!quiz.limitationImpact) errors.push('limitation_impact_required');
  }
  if (quiz.specialConditions.includes('pregnancy')) {
    const value = quiz.pregnancyScreening;
    if (!value || value.weeks == null || value.weeks < 1 || value.weeks > 42 || !value.prenatalCare || !value.exerciseRestriction || !value.complication || value.warningSigns.length === 0) errors.push('pregnancy_screening_incomplete');
  }
  if (quiz.specialConditions.includes('postpartum')) {
    const value = quiz.postpartumScreening;
    if (!value || !value.timeSinceBirth || !value.deliveryType || value.signs.length === 0 || !value.returnClearance) errors.push('postpartum_screening_incomplete');
  }
  if (quiz.specialConditions.includes('functional_limitation') && (!quiz.functionalScreening || quiz.functionalScreening.situations.length === 0)) errors.push('functional_screening_incomplete');
  if (quiz.specialConditions.includes('lipedema') && (!quiz.lipedemaScreening?.symptomImpact || !quiz.lipedemaScreening.professionalGuidance)) errors.push('lipedema_screening_incomplete');
  if (quiz.specialConditions.includes('dizziness_or_vertigo') && (!quiz.dizzinessScreening?.symptomFrequency || !quiz.dizzinessScreening.affectsBalance)) errors.push('dizziness_screening_incomplete');
  if (quiz.specialConditions.includes('post_surgical') && (!quiz.postSurgicalScreening?.recoveryStatus || !quiz.postSurgicalScreening.bodyRegion || !quiz.postSurgicalScreening.returnClearance)) errors.push('post_surgical_screening_incomplete');
  if (quiz.specialConditions.includes('medical_restriction') && !quiz.medicalRestrictionScreening?.professionalExerciseRestriction) errors.push('medical_restriction_screening_incomplete');
  return errors;
}
