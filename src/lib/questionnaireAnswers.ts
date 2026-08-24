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
export type PersistedQuizAnswers = Omit<Quiz, 'birthDate'> & {
  birthDate?: Timestamp | null;
  /** @deprecated legacy pre-migration field — read-only compat, never written. */
  age?: number;
};

/** `Quiz` (client shape, `birthDate: Date | null`) → Firestore shape. */
export function toPersistedAnswers(answers: Quiz): PersistedQuizAnswers {
  const { birthDate, ...rest } = cleanApplicableAnswers(answers);
  return { ...rest, birthDate: birthDate ? Timestamp.fromDate(birthDate) : null };
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
  const { birthDate, age, ...rest } = raw ?? {};
  const resolvedBirthDate = birthDate
    ? birthDate.toDate()
    : age != null
      ? birthDateFromLegacyAge(age, createdAt?.toDate() ?? new Date())
      : null;
  // `defaultQuiz` backfills any field missing from a sparse/corrupted doc —
  // never throws, never leaves a field silently `undefined` for downstream
  // code (e.g. `.map()`/`.includes()` on the array fields) to crash on.
  return normalizeLoadedQuiz({ ...defaultQuiz, ...rest, birthDate: resolvedBirthDate });
}
