import { useEffect, useRef, useState } from 'react';
import { logInfo, logWarn } from '../lib/logger';
import { normalizeWeekdays, trainingDaysValid } from '../lib/questionnaireSchema';
import { ensureScheduleConfigFromQuestionnaire, loadScheduleConfig } from '../services/workoutSchedule';
import type { QuestionnaireDoc } from '../services/userProfile';
import { resolveWorkoutPrescription } from './useWorkoutPrescription';

export type WorkoutReadinessGateStatus = 'idle' | 'checking' | 'ready';

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * First-app-entry readiness gate (docs: audit of the onboarding→Home
 * lifecycle). This is the ONE thing standing between "auth + questionnaire +
 * commercial gate resolved" and `resolvePremiumGate` returning `'app'` —
 * without it, `AppShell` mounts, `useWorkoutPrescription` finds no program,
 * and Home becomes the trigger for the first generation (the exact
 * anti-pattern this gate exists to remove).
 *
 * Deliberately NOT a second engine and NOT a duplicated policy: it awaits
 * `resolveWorkoutPrescription` (the same standalone function
 * `useWorkoutPrescription`'s `reload()` calls) and mirrors the exact
 * scheduleConfig bootstrap `useWorkoutSchedule` already does on mount
 * (`ensureScheduleConfigFromQuestionnaire`, create-only/idempotent). Running
 * the same reads/fallbacks here just means AppShell's own hooks find
 * everything already there when THEY mount right after — no double
 * generation: `generateAndPersistWorkoutProgramDeduped`'s module-level
 * in-flight registry (`src/services/workoutPrograms.ts`) collapses this
 * call with any signup-time `persistPreparedWorkoutProgram` or a concurrent
 * `AppShell` mount into one shared attempt.
 *
 * Resolves to `'ready'` on ANY terminal outcome — a genuine, confirmed
 * generation failure included. This gate only ever delays WHEN AppShell
 * mounts, never blocks it forever: AppShell already renders a correct,
 * non-crashing degraded UI for a non-SUCCESS prescription (see
 * `StartWorkoutConfirmation`'s `canRetryGeneration` fallback). Fail-closed
 * behavior belongs to the Prescription Engine/Safety layer, not to
 * navigation.
 *
 * `enabled` should be `true` only once auth + questionnaire are already
 * confirmed resolved (`questionnaireResolution === 'found'`) — the same
 * prerequisite `resolvePremiumGate` already requires before it would ever
 * consider returning `'app'`. Starting as soon as that's true (rather than
 * waiting for the commercial/premium gate too) lets this overlap with the
 * user's time on Paywall — for an established account (program already
 * exists) this resolves in one fast read regardless of when it starts, so
 * starting early adds no risk, only a head start.
 */
export function useWorkoutReadinessGate(input: {
  enabled: boolean;
  uid: string | null;
  questionnaire: QuestionnaireDoc | null;
}): WorkoutReadinessGateStatus {
  const { enabled, uid, questionnaire } = input;
  const identity = uid ?? 'signed-out';
  const [resolved, setResolved] = useState<{ identity: string; status: WorkoutReadinessGateStatus }>({
    identity: 'unresolved',
    status: 'idle',
  });
  // Guards against re-kicking a fresh check on every render while one is
  // already in flight for this identity (this effect's deps include
  // `questionnaire`, which a write this same check triggers can change).
  const checkingIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !uid) return;
    if (checkingIdentityRef.current === uid) return;
    if (resolved.identity === uid && resolved.status === 'ready') return;
    checkingIdentityRef.current = uid;
    const startedAt = Date.now();
    setResolved({ identity: uid, status: 'checking' });

    void (async () => {
      let generated = false;
      const prescription = await resolveWorkoutPrescription(uid, questionnaire, {
        onGenerationStart: () => { generated = true; },
      });
      const prescribedTrainingDays = prescription.status === 'SUCCESS'
        ? prescription.plan.weeklySchedule
          ?.filter((day) => day.state === 'TRAINING')
          .map((day) => day.weekday) ?? []
        : [];

      // Mirrors `useWorkoutSchedule`'s own bootstrap exactly (docs/
      // workout-lifecycle/03_SCHEDULE_ENGINE.md) — create-only, never
      // overwrites an existing/user-edited config.
      if (questionnaire && (prescribedTrainingDays.length > 0 || trainingDaysValid(questionnaire.answers))) {
        try {
          const existingConfig = await loadScheduleConfig(uid);
          if (!existingConfig) {
            await ensureScheduleConfigFromQuestionnaire(
              uid,
              prescribedTrainingDays.length > 0
                ? prescribedTrainingDays
                : normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
              deviceTimezone(),
            );
          }
        } catch (error) {
          // Non-fatal — `useWorkoutSchedule` retries this same idempotent
          // call on AppShell mount; a legacy/unset schedule degrades to
          // SCHEDULE_SETUP_REQUIRED, never a crash.
          logWarn('workout_schedule', 'first_app_entry_schedule_config_failed', { error });
        }
      }

      logInfo('workout_program', 'first_app_entry_readiness_resolved', {
        outcome: prescription.status,
        generated,
        durationMs: Date.now() - startedAt,
      });
      checkingIdentityRef.current = null;
      setResolved({ identity: uid, status: 'ready' });
    })();
  }, [enabled, uid, questionnaire, resolved.identity, resolved.status]);

  if (!enabled) return 'idle';
  return resolved.identity === identity ? resolved.status : 'checking';
}
