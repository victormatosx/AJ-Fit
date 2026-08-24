import {
  defaultQuiz,
  type FunctionalScreening,
  type PostpartumScreening,
  type PregnancyScreening,
  type Quiz,
} from '../state/AppState';
import type { OnboardingStepId } from '../onboarding/steps';

export const HOME_EQUIPMENT_IDS = [
  'bodyweight',
  'dumbbells',
  'bands',
  'bench_or_box',
  'barbell',
  'other',
  'none',
] as const;

export const LIMITATION_IDS = [
  'none',
  'knee',
  'hip',
  'back',
  'shoulder',
  'elbow',
  'wrist',
  'ankle_foot',
  'other',
] as const;

export const POSTPARTUM_SIGN_IDS = [
  'pain',
  'healing_problems',
  'abnormal_bleeding',
  'incontinence',
  'vaginal_pressure',
  'dizziness_weakness',
  'none',
] as const;

export const PREGNANCY_WARNING_SIGN_IDS = [
  'vaginal_bleeding',
  'dizziness_fainting',
  'chest_pain',
  'unusual_shortness_of_breath',
  'painful_regular_contractions',
  'fluid_leakage',
  'calf_pain_swelling',
  'none',
] as const;

export const FUNCTIONAL_SITUATION_IDS = [
  'walking_difficulty',
  'support_needed',
  'stairs_difficulty',
  'balance_problems',
  'recent_fall',
  'sit_to_stand_difficulty',
  'daily_activities_difficulty',
  'none',
] as const;

export function exclusiveNone(values: string[]): string[] {
  if (!values.includes('none')) return [...new Set(values)];
  return values.at(-1) === 'none' ? ['none'] : [...new Set(values.filter((value) => value !== 'none'))];
}

function normalizeSpecialConditions(values: string[]): Quiz['specialConditions'] {
  const normalized = exclusiveNone(values) as Quiz['specialConditions'];
  if (!normalized.includes('pregnancy') || !normalized.includes('postpartum')) return normalized;
  const lastReproductiveStatus = [...normalized].reverse().find(
    (value) => value === 'pregnancy' || value === 'postpartum',
  );
  return normalized.filter(
    (value) => (value !== 'pregnancy' && value !== 'postpartum') || value === lastReproductiveStatus,
  );
}

function emptyPregnancyScreening(): PregnancyScreening {
  return { weeks: null, prenatalCare: null, exerciseRestriction: null, complication: null, warningSigns: [] };
}

function emptyPostpartumScreening(): PostpartumScreening {
  return { timeSinceBirth: null, deliveryType: null, signs: [], returnClearance: null };
}

function emptyFunctionalScreening(): FunctionalScreening {
  return { situations: [] };
}

/**
 * Removes answers whose branch is no longer applicable. This is intentionally
 * run after every onboarding edit and before persistence, so going back and
 * changing a router answer cannot leave hidden health data active.
 */
export function cleanApplicableAnswers(input: Quiz): Quiz {
  let specialConditions = normalizeSpecialConditions(input.specialConditions);
  if (input.sex !== 'f') {
    specialConditions = specialConditions.filter((value) => value !== 'pregnancy' && value !== 'postpartum');
  }

  const hasLimitations = input.limits.length > 0 && !input.limits.includes('none');
  const hasPregnancy = specialConditions.includes('pregnancy');
  const hasPostpartum = specialConditions.includes('postpartum');
  const hasFunctionalLimitation = specialConditions.includes('functional_limitation');
  const muscleFocus = exclusiveNone(input.muscleFocus).slice(0, 2);
  const postpartumScreening = hasPostpartum
    ? (input.postpartumScreening ?? emptyPostpartumScreening())
    : null;
  const functionalScreening = hasFunctionalLimitation
    ? (input.functionalScreening ?? emptyFunctionalScreening())
    : null;

  return {
    ...input,
    primaryPlace: input.place === 'both' ? input.primaryPlace : null,
    equipment: input.place === 'home' || input.place === 'both' ? exclusiveNone(input.equipment) : [],
    limits: exclusiveNone(input.limits),
    limitationImpact: hasLimitations ? input.limitationImpact : null,
    muscleFocus,
    specialConditions,
    pregnancyScreening: hasPregnancy
      ? {
          ...(input.pregnancyScreening ?? emptyPregnancyScreening()),
          warningSigns: exclusiveNone(input.pregnancyScreening?.warningSigns ?? []),
        }
      : null,
    postpartumScreening: postpartumScreening
      ? { ...postpartumScreening, signs: exclusiveNone(postpartumScreening.signs) }
      : null,
    functionalScreening: functionalScreening
      ? { ...functionalScreening, situations: exclusiveNone(functionalScreening.situations) }
      : null,
  };
}

/** Defensive read compatibility for sparse/malformed and all v1 questionnaires. */
export function normalizeLoadedQuiz(input: Partial<Quiz>): Quiz {
  const merged = { ...defaultQuiz, ...input };
  return {
    ...merged,
    limits: Array.isArray(merged.limits) ? merged.limits.filter((value): value is string => typeof value === 'string') : [],
    equipment: Array.isArray(merged.equipment)
      ? merged.equipment.filter((value): value is string => typeof value === 'string')
      : [],
    style: Array.isArray(merged.style) ? merged.style.filter((value): value is string => typeof value === 'string') : [],
    muscleFocus: Array.isArray(merged.muscleFocus)
      ? merged.muscleFocus.filter((value): value is string => typeof value === 'string').slice(0, 2)
      : [],
    specialConditions: Array.isArray(merged.specialConditions)
      ? merged.specialConditions.filter((value): value is Quiz['specialConditions'][number] =>
          ['none', 'pregnancy', 'postpartum', 'functional_limitation', 'medical_restriction'].includes(String(value)),
        )
      : [],
    pregnancyScreening:
      merged.pregnancyScreening && typeof merged.pregnancyScreening === 'object'
        ? {
            ...emptyPregnancyScreening(),
            ...merged.pregnancyScreening,
            warningSigns: Array.isArray(merged.pregnancyScreening.warningSigns)
              ? merged.pregnancyScreening.warningSigns
              : [],
          }
        : null,
    postpartumScreening:
      merged.postpartumScreening && typeof merged.postpartumScreening === 'object'
        ? {
            ...emptyPostpartumScreening(),
            ...merged.postpartumScreening,
            signs: Array.isArray(merged.postpartumScreening.signs) ? merged.postpartumScreening.signs : [],
          }
        : null,
    functionalScreening:
      merged.functionalScreening && typeof merged.functionalScreening === 'object'
        ? {
            ...emptyFunctionalScreening(),
            ...merged.functionalScreening,
            situations: Array.isArray(merged.functionalScreening.situations)
              ? merged.functionalScreening.situations
              : [],
          }
        : null,
  };
}

export function updateQuizAnswer(quiz: Quiz, stepId: OnboardingStepId, value: unknown): Quiz {
  let next: Quiz;
  switch (stepId) {
    case 'days':
      next = { ...quiz, days: Number(value) };
      break;
    case 'primaryPlace':
      next = { ...quiz, primaryPlace: value as Quiz['primaryPlace'] };
      break;
    case 'limitationImpact':
      next = { ...quiz, limitationImpact: value as Quiz['limitationImpact'] };
      break;
    case 'specialConditions':
      next = { ...quiz, specialConditions: normalizeSpecialConditions(value as string[]) };
      break;
    case 'pregnancyWeeks':
      next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), weeks: value as number } };
      break;
    case 'pregnancyPrenatalCare':
      next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), prenatalCare: value as PregnancyScreening['prenatalCare'] } };
      break;
    case 'pregnancyExerciseRestriction':
      next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), exerciseRestriction: value as PregnancyScreening['exerciseRestriction'] } };
      break;
    case 'pregnancyComplication':
      next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), complication: value as PregnancyScreening['complication'] } };
      break;
    case 'pregnancyWarningSigns':
      next = { ...quiz, pregnancyScreening: { ...(quiz.pregnancyScreening ?? emptyPregnancyScreening()), warningSigns: exclusiveNone(value as string[]) } };
      break;
    case 'postpartumTimeSinceBirth':
      next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), timeSinceBirth: value as PostpartumScreening['timeSinceBirth'] } };
      break;
    case 'postpartumDeliveryType':
      next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), deliveryType: value as PostpartumScreening['deliveryType'] } };
      break;
    case 'postpartumSigns':
      next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), signs: exclusiveNone(value as string[]) } };
      break;
    case 'postpartumReturnClearance':
      next = { ...quiz, postpartumScreening: { ...(quiz.postpartumScreening ?? emptyPostpartumScreening()), returnClearance: value as PostpartumScreening['returnClearance'] } };
      break;
    case 'functionalSituations':
      next = { ...quiz, functionalScreening: { situations: exclusiveNone(value as string[]) } };
      break;
    default:
      next = { ...quiz, [stepId]: value } as Quiz;
  }
  return cleanApplicableAnswers(next);
}

export function answerValueForStep(quiz: Quiz, stepId: OnboardingStepId): unknown {
  switch (stepId) {
    case 'days': return quiz.days == null ? null : String(quiz.days);
    case 'pregnancyWeeks': return quiz.pregnancyScreening?.weeks ?? null;
    case 'pregnancyPrenatalCare': return quiz.pregnancyScreening?.prenatalCare ?? null;
    case 'pregnancyExerciseRestriction': return quiz.pregnancyScreening?.exerciseRestriction ?? null;
    case 'pregnancyComplication': return quiz.pregnancyScreening?.complication ?? null;
    case 'pregnancyWarningSigns': return quiz.pregnancyScreening?.warningSigns ?? [];
    case 'postpartumTimeSinceBirth': return quiz.postpartumScreening?.timeSinceBirth ?? null;
    case 'postpartumDeliveryType': return quiz.postpartumScreening?.deliveryType ?? null;
    case 'postpartumSigns': return quiz.postpartumScreening?.signs ?? [];
    case 'postpartumReturnClearance': return quiz.postpartumScreening?.returnClearance ?? null;
    case 'functionalSituations': return quiz.functionalScreening?.situations ?? [];
    default: return quiz[stepId as keyof Quiz];
  }
}

export type QuestionnaireValidationCode =
  | 'unsupported_days'
  | 'too_many_muscle_priorities'
  | 'exclusive_none_conflict'
  | 'primary_place_required'
  | 'equipment_required'
  | 'limitation_impact_required'
  | 'pregnancy_screening_incomplete'
  | 'postpartum_screening_incomplete'
  | 'functional_screening_incomplete';

function hasNoneConflict(values: string[]): boolean {
  return values.includes('none') && values.length > 1;
}

/** Locale-free domain validation used by tests and available to persistence callers. */
export function questionnaireValidationErrors(quiz: Quiz): QuestionnaireValidationCode[] {
  const errors: QuestionnaireValidationCode[] = [];
  if (quiz.days == null || ![2, 3, 4, 5, 6, 7].includes(quiz.days)) errors.push('unsupported_days');
  if (quiz.muscleFocus.filter((value) => value !== 'none').length > 2) errors.push('too_many_muscle_priorities');
  if (
    [
      quiz.equipment,
      quiz.limits,
      quiz.muscleFocus,
      quiz.specialConditions,
      quiz.pregnancyScreening?.warningSigns ?? [],
      quiz.postpartumScreening?.signs ?? [],
      quiz.functionalScreening?.situations ?? [],
    ].some(hasNoneConflict)
  ) {
    errors.push('exclusive_none_conflict');
  }
  if (quiz.place === 'both' && !quiz.primaryPlace) errors.push('primary_place_required');
  if ((quiz.place === 'home' || quiz.place === 'both') && quiz.equipment.length === 0) errors.push('equipment_required');
  if (quiz.limits.some((value) => value !== 'none') && !quiz.limitationImpact) {
    errors.push('limitation_impact_required');
  }
  if (quiz.specialConditions.includes('pregnancy')) {
    const screening = quiz.pregnancyScreening;
    if (
      !screening ||
      screening.weeks == null ||
      screening.weeks < 1 ||
      screening.weeks > 42 ||
      !screening.prenatalCare ||
      !screening.exerciseRestriction ||
      !screening.complication ||
      screening.warningSigns.length === 0
    ) {
      errors.push('pregnancy_screening_incomplete');
    }
  }
  if (quiz.specialConditions.includes('postpartum')) {
    const screening = quiz.postpartumScreening;
    if (
      !screening ||
      !screening.timeSinceBirth ||
      !screening.deliveryType ||
      screening.signs.length === 0 ||
      !screening.returnClearance
    ) {
      errors.push('postpartum_screening_incomplete');
    }
  }
  if (
    quiz.specialConditions.includes('functional_limitation') &&
    (!quiz.functionalScreening || quiz.functionalScreening.situations.length === 0)
  ) {
    errors.push('functional_screening_incomplete');
  }
  return errors;
}
