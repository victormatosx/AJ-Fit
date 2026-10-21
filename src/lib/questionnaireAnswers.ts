import { Timestamp } from 'firebase/firestore';
import { defaultQuiz, type Quiz } from '../state/AppState';
import { birthDateFromLegacyAge } from './ageCalculator';
import { cleanApplicableAnswers, normalizeLoadedQuiz } from './questionnaireSchema';

/**
 * Firestore ⇄ client conversion for the questionnaire's `answers` map.
 * Pulled out of userProfile.ts (imports bare `Timestamp` from
 * `firebase/firestore`, not the initialized app in `../lib/firebase`) so it
 * has no Firebase-app-initialization side effect and can be unit tested in
 * isolation — see src/lib/__tests__/questionnaireAnswers.test.ts.
 *
 * Migração birthDate (docs/04_contratos_de_api.md §5, docs/08_log_de_evolucao.md):
 * questionnaires written before this change have `age: number` and no
 * `birthDate`. Both shapes are read here; only the new shape is ever written.
 */

/**
 * Firestore-persisted shape of `answers`. Same as `Quiz` except `birthDate`
 * is a `Timestamp` (Firestore has no native `Date`), plus the legacy `age`
 * field kept ONLY for reading pre-migration documents — never written again.
 */
export type PersistedQuizAnswers = Omit<Quiz, 'birthDate' | 'place' | 'limits'> & {
  birthDate?: Timestamp | null;
  place?: Quiz['place'] | 'both' | null;
  /** @deprecated removed questionnaire field — used only to resolve legacy `place: both`. */
  primaryPlace?: unknown;
  /** @deprecated legacy pre-migration field — read-only compat, never written. */
  age?: number;
  /** @deprecated removed questionnaire field — ignored on read, never written. */
  limitationImpact?: unknown;
  /** @deprecated removed questionnaire field — ignored on read, never written. */
  motivation?: unknown;
  /**
   * `limits` (and `musculoskeletal_limitation` inside `specialConditions`)
   * is the purely-informational, frontend-only physical-limitations
   * question — onboarding local state ONLY (see `Quiz['limits']`). It must
   * never be written to Firestore. Kept here read-only so a pre-removal or
   * accidentally-written legacy document can still be loaded without
   * throwing; `toPersistedAnswers` never sets it.
   */
  limits?: unknown;
};

/**
 * `Quiz` (client shape, `birthDate: Date | null`) → Firestore shape.
 *
 * `limits`/`musculoskeletal_limitation` are deliberately stripped here even
 * though `cleanApplicableAnswers` keeps them for local in-session state —
 * the physical-limitations question is purely informational (onboarding UI
 * only) and must never reach Firestore or, downstream, the prescription
 * Cloud Functions. See `src/workoutPrescription/input.ts`'s
 * `sanitizeAnswersForEngine` for the matching read-side strip.
 */
export function toPersistedAnswers(answers: Quiz): PersistedQuizAnswers {
  const { birthDate, limits: _limits, specialConditions, ...rest } = cleanApplicableAnswers(answers);
  return {
    ...rest,
    specialConditions: specialConditions.filter((value) => value !== 'musculoskeletal_limitation'),
    birthDate: birthDate ? Timestamp.fromDate(birthDate) : null,
  };
}

/**
 * Firestore shape → `Quiz` (client shape). Legacy docs that only have `age`
 * get a `birthDate` approximated from that age anchored to the
 * questionnaire's own `createdAt` (see `birthDateFromLegacyAge` for why
 * anchoring to the doc's date — not "today" — is what makes the derived age
 * keep advancing correctly instead of staying frozen).
 *
 * `raw` is defensively allowed to be missing/malformed (e.g. a document
 * edited by hand or corrupted outside the app) — this must never throw;
 * fields it can't recover simply fall back to safe defaults instead of
 * crashing the whole profile load.
 */
export function fromPersistedAnswers(
  raw: Partial<PersistedQuizAnswers> | undefined | null,
  createdAt: Timestamp | null,
): Quiz {
  const {
    birthDate,
    age,
    primaryPlace: legacyPrimaryPlace,
    limitationImpact: _legacyLimitationImpact,
    motivation: _legacyMotivation,
    limits: _legacyLimits,
    ...rest
  } = raw ?? {};
  const resolvedBirthDate = birthDate
    ? birthDate.toDate()
    : age != null
      ? birthDateFromLegacyAge(age, createdAt?.toDate() ?? new Date())
      : null;
  // `defaultQuiz` backfills any field missing from a sparse/corrupted doc —
  // never throws, never leaves a field silently `undefined` for downstream
  // code (e.g. `.map()`/`.includes()` on the array fields) to crash on.
  const quiz = normalizeLoadedQuiz({
    ...defaultQuiz,
    ...rest,
    primaryPlace: legacyPrimaryPlace,
    birthDate: resolvedBirthDate,
  });
  // Mirror of the strip in `toPersistedAnswers`: never resurrect
  // `musculoskeletal_limitation`/`limits` into live state from a Firestore
  // document, even a legacy one written before this field was removed from
  // persistence. This is independent from (and stricter than)
  // `normalizeLoadedQuiz`'s own legacy-inference logic, which only governs
  // same-session local state (draft resume via `fromDraftAnswers`).
  return {
    ...quiz,
    limits: [],
    specialConditions: quiz.specialConditions.filter((value) => value !== 'musculoskeletal_limitation'),
  };
}
