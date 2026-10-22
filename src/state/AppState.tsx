import React, { createContext, useContext, useState, useMemo, useRef } from 'react';
import { nextValueForIdentity } from '../lib/quizIdentityScope';
// Type-only — erased at compile time, no Firebase/RN runtime dependency
// leaks into this module (see the `uid` prop doc comment below for why
// that matters here).
import type { PrepareWorkoutProgramResult } from '../services/workoutPrograms';

export type Sex = 'm' | 'f';
export type PrimaryGoal =
  | 'gain_muscle'
  | 'lose_fat'
  | 'strength'
  | 'conditioning'
  | 'health';
/** Former canonical values kept read-only so existing questionnaires remain usable and presentable. */
export type DeprecatedGoal = 'body_composition' | 'return_to_training';
export type LegacyGoal = 'hyper' | 'cut' | 'perf' | 'def' | 'recon';
/**
 * `intermediate_experienced` is a UI-only refinement of `intermediate` for
 * better self-identification in the questionnaire; prescription logic always
 * normalizes it back to `intermediate` via `normalizeExperience` and must
 * never branch on it directly.
 */
export type ExperienceLevel = 'beginner' | 'intermediate' | 'intermediate_experienced' | 'advanced';
/** Former canonical value kept read-only so existing questionnaires remain usable and presentable. */
export type DeprecatedExperienceLevel = 'never_or_starting';
export type LegacyExperienceLevel = 'beg' | 'int' | 'adv' | 'elite';
export type TrainingEnvironment = 'gym' | 'home';
/** Canonical chronological order (Monday-first). Persisted values never depend on locale or click order — see questionnaireSchema.ts `normalizeWeekdays`. */
export const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAY_ORDER)[number];
export type ScheduleMode = 'fixed' | 'flexible';
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
  /** New writes use `PrimaryGoal`; deprecated/legacy IDs remain readable until a future explicit migration. */
  goal: PrimaryGoal | DeprecatedGoal | LegacyGoal | null;
  frequency: string | null;
  /** New writes use `ExperienceLevel`; deprecated/legacy IDs remain readable for existing questionnaires. */
  level: ExperienceLevel | DeprecatedExperienceLevel | LegacyExperienceLevel | null;
  duration: '30' | '45' | '60' | '90' | null;
  days: number | null;
  /** Explicit schedule semantics. `null` exists only while a new draft has not answered the onboarding step. */
  scheduleMode: ScheduleMode | null;
  /**
   * Schedule Engine input (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md).
   * `null` means not collected yet (legacy questionnaire, or funnel not
   * reached this step, or an explicit flexible schedule). For fixed
   * `days === 7` this holds all seven `WEEKDAY_ORDER` values; for fixed 2-6
   * it holds exactly `days` distinct values, always normalized to canonical
   * chronological order.
   */
  trainingDays: Weekday[] | null;
  place: TrainingEnvironment | null;
  equipment: string[];
  style: string[];
  /** Etapa 18 — até 2 grupos musculares prioritários (ver docs/onboarding_funnel_architecture.md para a justificativa do limite). */
  muscleFocus: string[];
  /** Etapa 21 — nível de compromisso declarado. Onboarding-only: não influencia nenhum algoritmo de treino hoje. */
  commitment: string | null;
  specialConditions: SpecialCondition[];
  pregnancyScreening: PregnancyScreening | null;
  postpartumScreening: PostpartumScreening | null;
  functionalScreening: FunctionalScreening | null;
  lipedemaScreening: LipedemaScreening | null;
  dizzinessScreening: DizzinessScreening | null;
  postSurgicalScreening: PostSurgicalScreening | null;
  medicalRestrictionScreening: MedicalRestrictionScreening | null;
};

export type TabId = 'home' | 'workout' | 'progress' | 'profile' | 'nutrition';

type Ctx = {
  quiz: Quiz;
  setQuiz: (q: Quiz) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  /**
   * Phase 3 — the Analysis screen's real, pre-auth `prepareWorkoutProgram`
   * result, held in memory only (never AsyncStorage — see
   * `src/services/workoutPrograms.ts`'s `PreparedWorkoutProgram` doc
   * comment: it is a transient onboarding-lifecycle optimization, never a
   * new source of truth). `signUp()` reads it once to fast-path persistence
   * and always validates it against the actually-persisted questionnaire
   * before trusting it (fingerprint + version check) — never assumed valid
   * just because it exists. Reset on every identity transition, exactly
   * like `quiz`, so it can never leak across accounts.
   */
  preparedWorkoutProgram: PrepareWorkoutProgramResult | null;
  setPreparedWorkoutProgram: (p: PrepareWorkoutProgramResult | null) => void;
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
  duration: null,
  days: null,
  scheduleMode: null,
  trainingDays: null,
  place: null,
  equipment: [],
  style: [],
  muscleFocus: [],
  commitment: null,
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
  const [preparedWorkoutProgram, setPreparedWorkoutProgram] = useState<PrepareWorkoutProgramResult | null>(null);

  // Adjusting a component's own state during its own render in response to a
  // prop change (React's sanctioned pattern) — not an effect — so there is
  // no committed render, not even one, where a child can read `quiz` against
  // the wrong identity. Covers every uid transition: logout (uid -> null), a
  // fresh login (null -> uid), and a fast account switch (uidA -> uidB).
  // `preparedWorkoutProgram` rides along on the exact same reset — it was
  // computed FOR whatever `quiz` looked like under the previous identity,
  // so it is exactly as stale as `quiz` would be. `tab` rides along too:
  // without this, logging out from the profile/settings tab and back in
  // (same or different account) reopens that same tab instead of home,
  // since this provider never unmounts across the transition.
  const lastUidRef = useRef<string | null>(uid);
  if (lastUidRef.current !== uid) {
    const nextQuiz = nextValueForIdentity(lastUidRef.current, uid, quiz, defaultQuiz);
    const nextPrepared = nextValueForIdentity(lastUidRef.current, uid, preparedWorkoutProgram, null);
    const nextTab = nextValueForIdentity(lastUidRef.current, uid, tab, 'home');
    lastUidRef.current = uid;
    if (nextQuiz !== quiz) setQuiz(nextQuiz);
    if (nextPrepared !== preparedWorkoutProgram) setPreparedWorkoutProgram(nextPrepared);
    if (nextTab !== tab) setTab(nextTab);
  }

  const value = useMemo(
    () => ({ quiz, setQuiz, tab, setTab, preparedWorkoutProgram, setPreparedWorkoutProgram }),
    [quiz, tab, preparedWorkoutProgram],
  );
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState outside provider');
  return ctx;
}
