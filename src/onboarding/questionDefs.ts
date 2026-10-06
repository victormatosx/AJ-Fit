import type { Question } from '../components/onboarding/QuestionRenderer';
import { MAX_MUSCLE_FOCUS, type OnboardingStepId } from './steps';

/**
 * Question structure/config for every questionnaire step. Most ids map 1:1
 * to a `Quiz` field; screening steps are mapped into their nested object by
 * `questionnaireSchema.ts`. Copy lives in i18n (`quiz:${id}.*`) — nothing
 * here is user-visible text.
 */
export const FUNNEL_QUESTIONS: Partial<Record<OnboardingStepId, Question>> = {
  goal: {
    id: 'goal',
    kind: 'choice-large',
    options: [
      { v: 'gain_muscle', icon: 'dumbbell' },
      { v: 'lose_fat', icon: 'flame' },
      { v: 'strength', icon: 'bolt' },
      { v: 'conditioning', icon: 'heart' },
      { v: 'health', icon: 'target' },
    ],
  },
  level: {
    id: 'level',
    kind: 'choice-large',
    options: [
      { v: 'beginner' },
      { v: 'intermediate' },
      { v: 'intermediate_experienced' },
      { v: 'advanced' },
    ],
  },
  sex: { id: 'sex', kind: 'choice', options: [{ v: 'm' }, { v: 'f' }] },
  birthDate: { id: 'birthDate', kind: 'date', minAge: 18, maxAge: 75 },
  height: { id: 'height', kind: 'wheel', min: 140, max: 220, default: 178, digits: { min: 3, max: 3 } },
  weight: { id: 'weight', kind: 'wheel', min: 40, max: 180, default: 78, digits: { min: 2, max: 3 } },
  days: {
    id: 'days',
    kind: 'choice',
    options: [{ v: '2' }, { v: '3' }, { v: '4' }, { v: '5' }, { v: '6' }, { v: '7' }],
  },
  duration: {
    id: 'duration',
    kind: 'choice-large',
    options: [{ v: '30' }, { v: '45' }, { v: '60' }, { v: '90' }],
  },
  place: {
    id: 'place',
    kind: 'choice-large',
    options: [
      { v: 'gym', icon: 'dumbbell' },
      { v: 'home', icon: 'heart' },
    ],
  },
  equipment: {
    id: 'equipment',
    kind: 'multi',
    exclusiveOption: 'none',
    options: [
      { v: 'bodyweight' },
      { v: 'dumbbells' },
      { v: 'bands' },
      { v: 'bench_or_box' },
      { v: 'barbell' },
      { v: 'other' },
      { v: 'none' },
    ],
  },
  limits: {
    id: 'limits',
    kind: 'multi',
    exclusiveOption: 'none',
    layout: 'list',
    options: [
      { v: 'knee' },
      { v: 'hip' },
      { v: 'back' },
      { v: 'shoulder' },
      { v: 'elbow' },
      { v: 'wrist' },
      { v: 'ankle_foot' },
      { v: 'other' },
    ],
  },
  specialConditions: {
    id: 'specialConditions',
    kind: 'multi',
    exclusiveOption: 'none',
    layout: 'list',
    options: [
      { v: 'none' },
      { v: 'musculoskeletal_limitation' },
      { v: 'pregnancy' },
      { v: 'postpartum' },
      { v: 'lipedema' },
      { v: 'dizziness_or_vertigo' },
      { v: 'post_surgical' },
      { v: 'functional_limitation' },
      { v: 'medical_restriction' },
    ],
  },
  pregnancyWeeks: {
    id: 'pregnancyWeeks',
    kind: 'wheel',
    min: 1,
    max: 42,
    default: 12,
    digits: { min: 1, max: 2 },
  },
  pregnancyCare: {
    id: 'pregnancyCare',
    kind: 'compound-choice',
    showOptionShort: false,
    fields: [
      { id: 'prenatalCare', options: [{ v: 'yes' }, { v: 'no' }] },
      { id: 'exerciseRestriction', options: [{ v: 'no' }, { v: 'yes' }] },
      { id: 'complication', options: [{ v: 'no' }, { v: 'yes' }, { v: 'unsure' }] },
    ],
  },
  pregnancyWarningSigns: {
    id: 'pregnancyWarningSigns',
    kind: 'multi',
    exclusiveOption: 'none',
    layout: 'list',
    options: [
      { v: 'vaginal_bleeding' },
      { v: 'dizziness_fainting' },
      { v: 'chest_pain' },
      { v: 'unusual_shortness_of_breath' },
      { v: 'painful_regular_contractions' },
      { v: 'fluid_leakage' },
      { v: 'calf_pain_swelling' },
      { v: 'none' },
    ],
  },
  postpartumContext: {
    id: 'postpartumContext',
    kind: 'compound-choice',
    showOptionShort: false,
    fields: [
      {
        id: 'timeSinceBirth',
        options: [
          { v: 'under_6_weeks' },
          { v: '6_12_weeks' },
          { v: '3_6_months' },
          { v: '6_12_months' },
          { v: 'over_1_year' },
        ],
      },
      { id: 'deliveryType', options: [{ v: 'vaginal' }, { v: 'cesarean' }, { v: 'prefer_not_to_say' }] },
    ],
  },
  postpartumSigns: {
    id: 'postpartumSigns',
    kind: 'multi',
    exclusiveOption: 'none',
    layout: 'list',
    options: [
      { v: 'pain' },
      { v: 'healing_problems' },
      { v: 'abnormal_bleeding' },
      { v: 'incontinence' },
      { v: 'vaginal_pressure' },
      { v: 'dizziness_weakness' },
      { v: 'none' },
    ],
  },
  postpartumReturnClearance: {
    id: 'postpartumReturnClearance',
    kind: 'choice-large',
    options: [{ v: 'yes' }, { v: 'not_yet' }, { v: 'with_restrictions' }],
  },
  functionalSituations: {
    id: 'functionalSituations',
    kind: 'multi',
    exclusiveOption: 'none',
    layout: 'list',
    options: [
      { v: 'walking_difficulty' },
      { v: 'support_needed' },
      { v: 'stairs_difficulty' },
      { v: 'balance_problems' },
      { v: 'recent_fall' },
      { v: 'sit_to_stand_difficulty' },
      { v: 'daily_activities_difficulty' },
      { v: 'none' },
    ],
  },
  lipedemaScreening: {
    id: 'lipedemaScreening',
    kind: 'compound-choice',
    showOptionShort: false,
    fields: [
      {
        id: 'symptomImpact',
        options: [
          { v: 'none' },
          { v: 'mild_or_occasional' },
          { v: 'interferes_with_exercises' },
          { v: 'unknown' },
        ],
      },
      { id: 'professionalGuidance', options: [{ v: 'no' }, { v: 'yes' }, { v: 'unsure' }] },
    ],
  },
  dizzinessScreening: {
    id: 'dizzinessScreening',
    kind: 'compound-choice',
    showOptionShort: false,
    fields: [
      {
        id: 'symptomFrequency',
        options: [
          { v: 'history_only' },
          { v: 'occasional' },
          { v: 'frequent' },
          { v: 'current_or_recent' },
        ],
      },
      { id: 'affectsBalance', options: [{ v: 'no' }, { v: 'yes' }, { v: 'unknown' }] },
    ],
  },
  postSurgicalStatus: {
    id: 'postSurgicalStatus',
    kind: 'compound-choice',
    showOptionShort: false,
    fields: [
      { id: 'recoveryStatus', options: [{ v: 'completed' }, { v: 'in_progress' }, { v: 'unsure' }] },
      {
        id: 'returnClearance',
        options: [
          { v: 'cleared_no_restrictions' },
          { v: 'cleared_with_restrictions' },
          { v: 'not_yet' },
          { v: 'unsure' },
        ],
      },
    ],
  },
  postSurgicalRegion: {
    id: 'postSurgicalRegion',
    kind: 'choice-large',
    options: [
      { v: 'knee' },
      { v: 'hip' },
      { v: 'back' },
      { v: 'shoulder' },
      { v: 'elbow' },
      { v: 'wrist' },
      { v: 'ankle_foot' },
      { v: 'abdomen' },
      { v: 'chest' },
      { v: 'other' },
    ],
  },
  medicalRestrictionDetails: {
    id: 'medicalRestrictionDetails',
    kind: 'choice',
    showOptionShort: false,
    options: [{ v: 'yes' }, { v: 'no' }, { v: 'unsure' }],
  },
  muscleFocus: {
    id: 'muscleFocus',
    kind: 'multi',
    maxSelections: MAX_MUSCLE_FOCUS,
    exclusiveOption: 'none',
    options: [
      { v: 'chest' },
      { v: 'back' },
      { v: 'shoulders' },
      { v: 'arms' },
      { v: 'glutes' },
      { v: 'quads' },
      { v: 'hamstrings' },
      { v: 'calves' },
      { v: 'none' },
    ],
  },
  commitment: {
    id: 'commitment',
    kind: 'choice-large',
    options: [{ v: 'ownPace' }, { v: 'committed' }, { v: 'allIn' }],
  },
};
