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
export type PersistedQuizAnswers = Omit<Quiz, 'birthDate' | 'place'> & {
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
   * The retired physical-limitations question. It no longer exists anywhere
   * in the app — not in `Quiz`, not in onboarding — but a pre-removal or
   * accidentally-written legacy document can still carry it, so it stays
   * declared read-only to keep such a document loadable without throwing.
   * `toPersistedAnswers` never sets it.
   */
  limits?: unknown;
};

/**
 * `Quiz` (client shape, `birthDate: Date | null`) → Firestore shape.
 *
 * `musculoskeletal_limitation` is stripped here as defence in depth: the
 * question that collected it is gone, so live `Quiz` cannot hold it, but a
 * value recovered from a legacy document must never be written back. See
 * `src/workoutPrescription/input.ts`'s `sanitizeAnswersForEngine` for the
 * matching read-side strip.
 */
export function toPersistedAnswers(answers: Quiz): PersistedQuizAnswers {
  // `limits` is no longer declared in `Quiz`, so it is stripped through a
  // cast rather than by type: a value recovered from a legacy document could
  // still ride along at runtime, and Firestore Rules reject any questionnaire
  // write that carries it.
  const { birthDate, specialConditions, limits: _retiredLimits, ...rest } =
    cleanApplicableAnswers(answers) as Quiz & { limits?: unknown };
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
  // `musculoskeletal_limitation` into live state from a Firestore document,
  // even a legacy one written before the question was removed.
  return {
    ...quiz,
    specialConditions: quiz.specialConditions.filter((value) => value !== 'musculoskeletal_limitation'),
  };
}
