import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addGuidedAssessment,
  addImportedAssessment,
  getAssessments,
  type AssessmentDoc,
  type GuidedAssessmentInput,
  type ImportedAssessmentInput,
} from '../services/assessments';
import { computeBmi, computeFatMass, computeLeanMass } from '../lib/skinfoldCalculator';
import { logError } from '../lib/logError';

/** An assessment with its derived fields (bmi/leanMass/fatMass) computed at read time. */
export type AssessmentView = AssessmentDoc & {
  bmi: number | null;
  leanMass: number | null;
  fatMass: number | null;
};

export type AssessmentDelta = {
  weightDelta: number;
  bodyFatDelta: number | null;
  leanMassDelta: number | null;
  fatMassDelta: number | null;
};

/**
 * Result of a save. The write is the source of truth: once it succeeds the
 * assessment IS saved, regardless of `refreshFailed`. Callers use this to
 * show "saved" vs. "saved, but the screen couldn't update itself right now"
 * — never a generic failure — when only the post-save reload didn't work.
 */
export type SaveOutcome = { refreshFailed: boolean };

function toView(a: AssessmentDoc): AssessmentView {
  return {
    ...a,
    bmi: computeBmi(a.weight, a.height),
    leanMass: computeLeanMass(a.weight, a.bodyFat),
    fatMass: computeFatMass(a.weight, a.bodyFat),
  };
}

/**
 * Delta between two assessments. Weight is always available (required on
 * every document), but bodyFat — and anything derived from it — may be
 * unknown on either side (an imported assessment can have `bodyFat: null`),
 * in which case the corresponding delta is `null`, never a fabricated 0.
 */
function delta(to: AssessmentView, from: AssessmentView): AssessmentDelta {
  return {
    weightDelta: to.weight - from.weight,
    bodyFatDelta: to.bodyFat != null && from.bodyFat != null ? to.bodyFat - from.bodyFat : null,
    leanMassDelta: to.leanMass != null && from.leanMass != null ? to.leanMass - from.leanMass : null,
    fatMassDelta: to.fatMass != null && from.fatMass != null ? to.fatMass - from.fatMass : null,
  };
}

/**
 * Loads and manages the current user's physical-assessment history.
 * The screen never talks to Firestore directly — this hook + the
 * `assessments` service are the only entry points.
 */
export function useAssessments(uid: string | null) {
  const [assessments, setAssessments] = useState<AssessmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Monotonic token so a slower/older fetch can never overwrite a newer one
  // — same pattern as AuthContext's `loadSeq`. Without this, two overlapping
  // refreshes (e.g. `uid` changing on a fast logout/login, or a double-tap
  // on "tentar novamente") could resolve out of order and leave stale data
  // on screen even though a newer, correct fetch already completed.
  const fetchSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    if (!uid) {
      setAssessments([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Server-ordered by measuredAt desc, createdAt desc — a fresh full
      // re-fetch after every write, so a back-dated (imported) assessment
      // always lands in its correct chronological position, not just at
      // the top of the list.
      const docs = await getAssessments(uid);
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      setAssessments(docs.map(toView));
      setError(null);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      logError('assessments:load', err);
      setError(err instanceof Error ? err : new Error('Failed to load assessments'));
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const latest = assessments[0] ?? null;
  const previous = assessments[1] ?? null;
  const first = assessments.length ? assessments[assessments.length - 1] : null;

  // Evolution since the previous assessment — the only view rendered today.
  const evolutionSincePrevious = latest && previous ? delta(latest, previous) : null;

  // Evolution since the very first assessment — computed but not yet surfaced
  // in the UI. Kept here so a future "desde a primeira avaliação" toggle only
  // needs a UI switch, no new data plumbing.
  const evolutionSinceFirst =
    latest && first && first.id !== latest.id ? delta(latest, first) : null;

  const saveGuided = useCallback(
    async (input: GuidedAssessmentInput): Promise<SaveOutcome> => {
      if (!uid) throw new Error('saveGuided called with no authenticated user');
      await addGuidedAssessment(uid, input);
      // The write already succeeded at this point — a failure reloading the
      // list must NOT be reported as a save failure (the caller would show
      // an error and the user could retry, creating a duplicate immutable
      // assessment). The stale list just gets picked up on the next refresh
      // (e.g. the next time this screen is opened). The caller uses the
      // returned flag to tell the user their data IS saved, just not shown yet.
      try {
        await refresh();
        return { refreshFailed: false };
      } catch (err) {
        logError('assessments:post-save-refresh', err, { source: 'guided' });
        return { refreshFailed: true };
      }
    },
    [uid, refresh],
  );

  const saveImported = useCallback(
    async (input: ImportedAssessmentInput): Promise<SaveOutcome> => {
      if (!uid) throw new Error('saveImported called with no authenticated user');
      await addImportedAssessment(uid, input);
      try {
        await refresh();
        return { refreshFailed: false };
      } catch (err) {
        logError('assessments:post-save-refresh', err, { source: 'imported' });
        return { refreshFailed: true };
      }
    },
    [uid, refresh],
  );

  return {
    assessments,
    loading,
    error,
    latest,
    previous,
    first,
    evolutionSincePrevious,
    evolutionSinceFirst,
    saveGuided,
    saveImported,
    refresh,
  };
}
