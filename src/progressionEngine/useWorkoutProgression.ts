import { useCallback, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import { applyProgression, evaluateActiveProgression } from '../services/workoutProgression';
import type { ProgressionFeedbackKind } from '../components/progression/ProgressionFeedbackModal';

export interface WorkoutProgressionController {
  feedback: ProgressionFeedbackKind | null;
  /** Evaluate + apply (if eligible) for `programId`. Only call at a safe boundary — after a session finishes, never while one is IN_PROGRESS (docs §23-25). Returns whether a transition was actually applied, so the caller can reload its active program. */
  checkAndApply: (programId: string) => Promise<{ applied: boolean }>;
  dismissFeedback: () => void;
}

/**
 * Bridges the Progression Engine service (src/services/workoutProgression.ts)
 * to a safe UI boundary. Owned by `AppShell`, mirroring `useWorkoutSchedule`/
 * `useWorkoutExecution` — evaluation and application are both explicit calls,
 * never triggered by merely rendering/opening the app (docs §76/§99).
 */
export function useWorkoutProgression(): WorkoutProgressionController {
  const { user } = useAuth();
  const [feedback, setFeedback] = useState<ProgressionFeedbackKind | null>(null);

  const checkAndApply = useCallback(async (programId: string): Promise<{ applied: boolean }> => {
    if (!user) return { applied: false };
    try {
      const { resolution } = await evaluateActiveProgression(user.uid);
      if (resolution.status !== 'BEGINNER_STAGE_PROGRESSION_AVAILABLE' && resolution.status !== 'NORMAL_ROTATION_AVAILABLE') {
        return { applied: false };
      }
      const result = await applyProgression({ uid: user.uid, expectedProgramId: programId });
      if (result.applied) {
        setFeedback(resolution.status === 'BEGINNER_STAGE_PROGRESSION_AVAILABLE' ? 'BEGINNER_STAGE_ADVANCED' : 'NORMAL_ROTATED');
        return { applied: true };
      }
      return { applied: false };
    } catch (error) {
      logWarn('workout_progression', 'check_and_apply_failed', { error });
      return { applied: false };
    }
  }, [user]);

  const dismissFeedback = useCallback(() => setFeedback(null), []);

  return { feedback, checkAndApply, dismissFeedback };
}
