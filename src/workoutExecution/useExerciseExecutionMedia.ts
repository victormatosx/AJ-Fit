import { useEffect, useState } from 'react';
import { loadExerciseExecutionMedia } from '../services/exerciseExecutionMedia';
import type { ExerciseExecution } from '../types/exercise';

export interface ExerciseExecutionMediaState {
  media: Record<string, ExerciseExecution>;
  /**
   * True until this exact `exerciseIds` set has resolved (success or
   * failure) at least once. `ExerciseGif` MUST check this before treating
   * `media[id]` as "confirmed no own video" — while it's `true`, an absent
   * entry only means "haven't checked yet", not "there is none". Reading
   * `media` alone here was the exact cause of a real bug: the free-
   * exercise-db fallback frames flashed for the brief window between mount
   * and this Firestore read landing, even for an exercise that DOES have
   * an own video, because `media[id]` was indistinguishable from `{}`
   * (genuinely no video) during that window.
   */
  loading: boolean;
}

/**
 * Fetches the admin-registered "own video" slots for exactly the exercise
 * ids in the current session, once per distinct id set — never the whole
 * catalog (see `services/exerciseExecutionMedia.ts`). A failed/incomplete
 * load resolves to `{}`, which `ExerciseGif` treats identically to "no own
 * video for this exercise" ONLY once `loading` is `false` — it never
 * blocks rendering the session, it only tells callers when `media` is
 * actually trustworthy yet.
 */
export function useExerciseExecutionMedia(exerciseIds: string[]): ExerciseExecutionMediaState {
  const key = [...new Set(exerciseIds)].sort().join(',');
  const [resolved, setResolved] = useState<{ key: string; media: Record<string, ExerciseExecution> }>({
    key: '',
    media: {},
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void loadExerciseExecutionMedia(key.split(',')).then((media) => {
      if (!cancelled) setResolved({ key, media });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const identityResolved = resolved.key === key;
  return {
    media: identityResolved ? resolved.media : {},
    loading: !identityResolved,
  };
}
