import { useEffect, useRef, useState } from 'react';
import { logInfo, logWarn } from '../lib/logger';
import { normalizeWeekdays, trainingDaysValid } from '../lib/questionnaireSchema';
import { ensureScheduleConfigFromQuestionnaire, loadScheduleConfig } from '../services/workoutSchedule';
import type { QuestionnaireDoc } from '../services/userProfile';
import { resolveWorkoutPrescription } from './useWorkoutPrescription';
import { readinessStatusForPrescription, type WorkoutReadinessGateStatus } from './readiness';

export { readinessStatusForPrescription, type WorkoutReadinessGateStatus };

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
 * Resolves to `'ready'` on every terminal outcome EXCEPT
 * `NEEDS_QUESTIONNAIRE_UPDATE` (see `readinessStatusForPrescription` above) —
 * that one specific outcome means the questionnaire on file is missing data
 * the engine hard-requires (e.g. `sex`), which `resolvePremiumGate`
 * (src/lib/premiumGate.ts) routes back to `'onboardingFunnel'` instead of
 * ever opening AppShell. Root-cause fix, not just this gate: this used to
 * ALSO resolve `'ready'` for `NEEDS_QUESTIONNAIRE_UPDATE`, which is exactly
 * how a Fluxo B account with a missing required field (`useOnboardingFunnel`
 * used to start the forced questionnaire at `'goal'`, skipping `sex` —
 * fixed separately) could reach Home with an "insufficient information" card
 * instead of being sent back to actually complete it. Every OTHER terminal
 * outcome (a genuine, confirmed safety `BLOCKED`/`REQUIRES_CLEARANCE`, a
 * catalog/config error) still resolves `'ready'`: AppShell already renders a
 * correct, non-crashing degraded UI for those (see
 * `StartWorkoutConfirmation`'s `canRetryGeneration` fallback), and second-
 * guessing the Prescription/Safety layer's OWN outcomes from navigation is
 * out of scope here — only "we don't have enough data to even try" gets
 * special-cased.
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
  const [resolved, setResolved] = useState<{
    identity: string;
    status: WorkoutReadinessGateStatus;
    /**
     * The exact `questionnaire` reference this resolution was computed for.
     * Needed because `'needsQuestionnaire'` — unlike `'ready'` — is NOT
     * skipped by identity alone below: after a repair re-submission,
     * `refreshProfile()` produces a NEW `questionnaire` object for the SAME
     * uid, and that must re-trigger a real re-check, not be silently treated
     * as "already resolved". Comparing this instead of `status` is what lets
     * the skip condition tell "still the same stale resolution" apart from
     * "a fresh questionnaire arrived" without re-deriving completeness here
     * (that stays the engine's job via `resolveWorkoutPrescription`).
     */
    questionnaire: QuestionnaireDoc | null;
  }>({
    identity: 'unresolved',
    status: 'idle',
    questionnaire: null,
  });
  // Guards against re-kicking a fresh check on every render while one is
  // already in flight for this identity (this effect's deps include
  // `questionnaire`, which a write this same check triggers can change).
  const checkingIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !uid) return;
    if (checkingIdentityRef.current === uid) return;
    if (resolved.identity === uid && resolved.status !== 'checking' && resolved.questionnaire === questionnaire) {
      return;
    }
    checkingIdentityRef.current = uid;
    const startedAt = Date.now();
    setResolved({ identity: uid, status: 'checking', questionnaire });

    void (async () => {
      // `true` only means a fallback generation attempt STARTED (the
      // `resolveWorkoutPrescription` "no active program yet" branch ran) —
      // NOT that it produced a usable program. Log this as
      // `generationAttempted`, never `generated`: a prior version of this
      // log used the latter and the resulting `{ generated: true, outcome:
      // 'INVALID_CONFIGURATION' }` reads as "a program was created" when a
      // generation attempt in fact failed — exactly the ambiguity that
      // masked the first-app-entry regression in device logs.
      let generationAttempted = false;
      const prescription = await resolveWorkoutPrescription(uid, questionnaire, {
        onGenerationStart: () => { generationAttempted = true; },
      });
      const prescribedTrainingDays = prescription.status === 'SUCCESS'
        ? prescription.plan.weeklySchedule
          ?.filter((day) => day.state === 'TRAINING')
          .map((day) => day.weekday) ?? []
        : [];
      const scheduleMode = prescription.status === 'SUCCESS'
        ? prescription.plan.scheduleMode ?? 'fixed'
        : questionnaire?.answers.scheduleMode ?? 'fixed';

      // Mirrors `useWorkoutSchedule`'s own bootstrap exactly (docs/
      // workout-lifecycle/03_SCHEDULE_ENGINE.md) — create-only, never
      // overwrites an existing/user-edited config.
      if (questionnaire && (scheduleMode === 'flexible' || prescribedTrainingDays.length > 0 || trainingDaysValid(questionnaire.answers))) {
        try {
          const existingConfig = await loadScheduleConfig(uid);
          if (!existingConfig) {
            await ensureScheduleConfigFromQuestionnaire(
              uid,
              prescribedTrainingDays.length > 0
                ? prescribedTrainingDays
                : normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
              deviceTimezone(),
              scheduleMode,
            );
          }
        } catch (error) {
          // Non-fatal — `useWorkoutSchedule` retries this same idempotent
          // call on AppShell mount; a legacy/unset schedule degrades to
          // SCHEDULE_SETUP_REQUIRED, never a crash.
          logWarn('workout_schedule', 'first_app_entry_schedule_config_failed', { error });
        }
      }

      const readinessStatus = readinessStatusForPrescription(prescription.status);
      logInfo('workout_program', 'first_app_entry_readiness_resolved', {
        outcome: prescription.status,
        generationAttempted,
        // Explicit success signal, distinct from `generationAttempted` —
        // a program actually exists and is usable only when this is true.
        programReady: prescription.status === 'SUCCESS',
        reasonCodes: prescription.status === 'SUCCESS' ? undefined : prescription.reasonCodes,
        // Distinguishes "sent back to complete the questionnaire" from every
        // other non-SUCCESS outcome in the logs — see
        // `readinessStatusForPrescription`'s doc comment.
        readinessStatus,
        durationMs: Date.now() - startedAt,
      });
      checkingIdentityRef.current = null;
      setResolved({ identity: uid, status: readinessStatus, questionnaire });
    })();
    // `resolved.questionnaire` (not `resolved.status`) is what the
    // early-return above compares against `questionnaire` to decide whether
    // this is a genuinely new check or a self-triggered rerun of an already-
    // settled resolution — see its doc comment. Both are still listed here
    // so the effect reacts to either changing.
  }, [enabled, uid, questionnaire, resolved.identity, resolved.status, resolved.questionnaire]);

  if (!enabled) return 'idle';
  return resolved.identity === identity ? resolved.status : 'checking';
}
