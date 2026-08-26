import React, { createContext, useContext, useState, useMemo, useRef } from 'react';
import { nextValueForIdentity } from '../lib/quizIdentityScope';

export type Sex = 'm' | 'f';
export type PrimaryGoal =
  | 'gain_muscle'
  | 'lose_fat'
  | 'strength'
  | 'conditioning'
  | 'body_composition'
  | 'return_to_training';
export type LegacyGoal = 'hyper' | 'cut' | 'perf' | 'def' | 'recon';
export type ExperienceLevel = 'never_or_starting' | 'beginner' | 'intermediate' | 'advanced';
export type LegacyExperienceLevel = 'beg' | 'int' | 'adv' | 'elite';
export type TrainingEnvironment = 'gym' | 'home' | 'both';
export type PrimaryTrainingEnvironment = Exclude<TrainingEnvironment, 'both'>;
/** Canonical chronological order (Monday-first). Persisted values never depend on locale or click order — see questionnaireSchema.ts `normalizeWeekdays`. */
export const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAY_ORDER)[number];
export type LimitationImpact =
  | 'mild'
  | 'requires_adaptation'
  | 'professional_restriction'
  | 'unknown';
export type SpecialCondition =
  | 'musculoskeletal_limitation'
  | 'pregnancy'
  | 'postpartum'
  | 'lipedema'
  | 'dizziness_or_vertigo'
  | 'post_surgical'
  | 'functional_limitation'
  | 'medical_restriction'
  | 'none';
export type PregnancyScreening = {
  weeks: number | null;
  prenatalCare: 'yes' | 'no' | null;
  exerciseRestriction: 'yes' | 'no' | null;
  complication: 'yes' | 'no' | 'unsure' | null;
  warningSigns: string[];
};
export type PostpartumScreening = {
  timeSinceBirth: 'under_6_weeks' | '6_12_weeks' | '3_6_months' | '6_12_months' | 'over_1_year' | null;
  deliveryType: 'vaginal' | 'cesarean' | 'prefer_not_to_say' | null;
  signs: string[];
  returnClearance: 'yes' | 'not_yet' | 'with_restrictions' | null;
};
export type FunctionalScreening = {
  situations: string[];
};
export type LipedemaScreening = {
  symptomImpact: 'none' | 'mild_or_occasional' | 'interferes_with_exercises' | 'unknown' | null;
  professionalGuidance: 'no' | 'yes' | 'unsure' | null;
};
export type DizzinessScreening = {
  symptomFrequency: 'history_only' | 'occasional' | 'frequent' | 'current_or_recent' | null;
  affectsBalance: 'no' | 'yes' | 'unknown' | null;
};
export type PostSurgicalScreening = {
  recoveryStatus: 'completed' | 'in_progress' | 'unsure' | null;
  bodyRegion:
    | 'knee'
    | 'hip'
    | 'back'
    | 'shoulder'
    | 'elbow'
    | 'wrist'
    | 'ankle_foot'
    | 'abdomen'
    | 'chest'
    | 'other'
    | null;
  returnClearance: 'cleared_no_restrictions' | 'cleared_with_restrictions' | 'not_yet' | 'unsure' | null;
};
export type MedicalRestrictionScreening = {
  professionalExerciseRestriction: 'yes' | 'no' | 'unsure' | null;
};

export type Quiz = {
  sex: 'm' | 'f' | null;
  /**
   * Replaces the old `age: number` field (see ageCalculator.ts /
   * docs/08_log_de_evolucao.md, migração birthDate). A stored age goes stale
   * the moment time passes; a birth date doesn't. Age is always derived via
   * `computeAge(birthDate, referenceDate)`, never stored directly again.
   */
  birthDate: Date | null;
  height: number;
  weight: number;
  /** New writes use `PrimaryGoal`; legacy IDs remain readable until a future explicit migration. */
  goal: PrimaryGoal | LegacyGoal | null;
  frequency: string | null;
  /** Experience modifier. `elite` and the other short IDs are read-only legacy values. */
  level: ExperienceLevel | LegacyExperienceLevel | null;
  limits: string[];
  duration: '30' | '45' | '60' | '90' | null;
  days: number | null;
  /**
   * Schedule Engine input (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md).
   * `null` means not collected yet (legacy questionnaire, or funnel not
   * reached this step). For `days === 7` this always holds all seven
   * `WEEKDAY_ORDER` values; for 2-6 it holds exactly `days` distinct values,
   * always normalized to canonical chronological order.
   */
  trainingDays: Weekday[] | null;
  place: TrainingEnvironment | null;
  /** Required only when `place === 'both'`; always resolves the future base selector to gym/home. */
  primaryPlace: PrimaryTrainingEnvironment | null;
  equipment: string[];
  style: string[];
  /** Etapa 4 do novo funil — distinto de `goal`: motivo emocional/contextual que trouxe o usuário, não o resultado técnico buscado. */
  motivation: string | null;
  /** Etapa 19 — até 2 grupos musculares prioritários (ver docs/onboarding_funnel_architecture.md para a justificativa do limite). */
  muscleFocus: string[];
  /** Etapa 22 — nível de compromisso declarado. Onboarding-only: não influencia nenhum algoritmo de treino hoje. */
  commitment: string | null;
  limitationImpact: LimitationImpact | null;
  specialConditions: SpecialCondition[];
  pregnancyScreening: PregnancyScreening | null;
  postpartumScreening: PostpartumScreening | null;
  functionalScreening: FunctionalScreening | null;
  lipedemaScreening: LipedemaScreening | null;
  dizzinessScreening: DizzinessScreening | null;
  postSurgicalScreening: PostSurgicalScreening | null;
  medicalRestrictionScreening: MedicalRestrictionScreening | null;
};

export type TabId = 'home' | 'workout' | 'progress' | 'profile';

type Ctx = {
  quiz: Quiz;
  setQuiz: (q: Quiz) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
};

/** Exported so userProfile.ts can fall back to it when normalizing a sparse/corrupted questionnaire doc. */
export const defaultQuiz: Quiz = {
  sex: null,
  birthDate: null,
  height: 178,
  weight: 78,
  goal: null,
  frequency: null,
  level: null,
  limits: [],
  duration: null,
  days: null,
  trainingDays: null,
  place: null,
  primaryPlace: null,
  equipment: [],
  style: [],
  motivation: null,
  muscleFocus: [],
  commitment: null,
  limitationImpact: null,
  specialConditions: [],
  pregnancyScreening: null,
  postpartumScreening: null,
  functionalScreening: null,
  lipedemaScreening: null,
  dizzinessScreening: null,
  postSurgicalScreening: null,
  medicalRestrictionScreening: null,
};

const AppStateContext = createContext<Ctx | null>(null);

/**
 * `uid`: the currently authenticated Firebase uid, or `null` when signed
 * out. Deliberately a plain prop rather than this file reaching for
 * `useAuth()` itself — `App.tsx` (the one place that already wires
 * AuthContext to everything else) passes it down, keeping this module free
 * of any Firebase/React Native import so it stays testable as pure state
 * logic. See `nextValueForIdentity`'s doc comment for the incident this
 * fixes: `quiz` is read directly by AuthScreen's signup/link calls, so a
 * stale value here becomes a cross-account Firestore write, not just a UI
 * glitch.
 */
export function AppStateProvider({
  uid,
  children,
}: {
  uid: string | null;
  children: React.ReactNode;
}) {
  const [quiz, setQuiz] = useState<Quiz>(defaultQuiz);
  const [tab, setTab] = useState<TabId>('home');

  // Adjusting a component's own state during its own render in response to a
  // prop change (React's sanctioned pattern) — not an effect — so there is
  // no committed render, not even one, where a child can read `quiz` against
  // the wrong identity. Covers every uid transition: logout (uid -> null), a
  // fresh login (null -> uid), and a fast account switch (uidA -> uidB).
  const lastUidRef = useRef<string | null>(uid);
  if (lastUidRef.current !== uid) {
    const nextQuiz = nextValueForIdentity(lastUidRef.current, uid, quiz, defaultQuiz);
    lastUidRef.current = uid;
    if (nextQuiz !== quiz) setQuiz(nextQuiz);
  }

  const value = useMemo(() => ({ quiz, setQuiz, tab, setTab }), [quiz, tab]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState outside provider');
  return ctx;
}
