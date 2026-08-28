import { useCallback, useEffect, useState } from 'react';
import { logInfo, logWarn } from '../lib/logger';
import {
  generateAndPersistWorkoutProgram,
  generateAndPersistWorkoutProgramDeduped,
  loadActiveWorkoutProgram,
} from '../services/workoutPrograms';
import { useAuth } from '../state/AuthContext';
import type { QuestionnaireDoc } from '../services/userProfile';
import type { QuestionnaireAnswers, PrescriptionResult } from './types';

/**
 * Placeholder returned ONLY while `resolved` belongs to a different identity
 * than the one currently rendering (a genuine "we haven't looked at this
 * account yet" gap, e.g. the render right after a uid change and before
 * `reload()`'s effect has re-run). Never committed as a real resolution —
 * `loading` (below) is what callers must check before ever reading
 * `prescription.status` as meaningful. Kept as `NEEDS_QUESTIONNAIRE_UPDATE`
 * only for backward type-compatibility with `PrescriptionResult`'s closed
 * union; no UI may treat this specific value as an actionable outcome (see
 * `loading`'s doc comment — this was the exact root cause of two real,
 * reported bugs: the Home flashing "Atualize suas informações" on cold
 * start, and "Preparando seu treino" leaking into the happy path — both
 * came from callers reading this placeholder's `status` before checking
 * `loading`).
 */
const loadingResult: PrescriptionResult = {
  status: 'NEEDS_QUESTIONNAIRE_UPDATE',
  reasonCodes: ['ACTIVE_WORKOUT_PROGRAM_LOADING'],
};

export interface WorkoutPrescriptionController {
  prescription: PrescriptionResult;
  /**
   * True from the moment this identity starts resolving until its FIRST
   * real outcome (success or a genuine, confirmed failure) commits —
   * covers both the initial `loadActiveWorkoutProgram` read AND, when it
   * falls through to automatic reconciliation, that attempt too. Callers
   * MUST check this (or `generating`) BEFORE reading `prescription.status`
   * — while `true`, `prescription` may still be the internal loading
   * placeholder, which is NOT a real `NEEDS_QUESTIONNAIRE_UPDATE` outcome
   * despite its shape.
   */
  loading: boolean;
  /**
   * True while a generation attempt is in flight — automatic reconciliation
   * on load AND the manual `generate()` fallback both set this. The UI
   * should show a single "gerando seu treino" state for either source; it
   * never needs to know which one triggered it. Implies `loading` too.
   */
  generating: boolean;
  /** Explicit fallback retry — never the normal path for a first program (see module doc comment). */
  generate: () => Promise<PrescriptionResult>;
  reload: () => Promise<void>;
}

function toPrescription(result: Awaited<ReturnType<typeof generateAndPersistWorkoutProgram>>): PrescriptionResult {
  return result.status === 'SUCCESS' ? { status: 'SUCCESS', plan: result.program } : result;
}

/**
 * Standalone (non-React) version of `useWorkoutPrescription`'s reconciliation
 * policy — authenticated + questionnaire loaded + no active program →
 * generate now, via the SAME deduped/idempotent path
 * (`generateAndPersistWorkoutProgramDeduped`). Extracted so the first-app-entry
 * readiness gate (`useWorkoutReadinessGate`) can await this exact resolution
 * BEFORE the navigation gate ever opens `AppShell`, instead of duplicating
 * the branch logic. `useWorkoutPrescription`'s `reload()` below calls this
 * too — this function is the ONE place the policy lives now.
 *
 * `onGenerationStart` fires only when a real fallback generation is about to
 * run (never on the fast "program already exists" path) — callers use it
 * purely for their own `generating`/instrumentation state; it changes no
 * behavior here.
 */
export async function resolveWorkoutPrescription(
  uid: string,
  questionnaire: QuestionnaireDoc | null,
  options?: { onGenerationStart?: () => void },
): Promise<PrescriptionResult> {
  let program;
  try {
    program = await loadActiveWorkoutProgram(uid);
    logInfo('workout_program', 'active_workout_program_loaded', { found: Boolean(program), templateId: program?.templateId });
  } catch (error) {
    logWarn('workout_program', 'active_workout_program_load_failed', { error });
    return { status: 'INVALID_CONFIGURATION', reasonCodes: ['ACTIVE_WORKOUT_PROGRAM_LOAD_FAILED'] };
  }
  if (program) return { status: 'SUCCESS', plan: program };
  if (!questionnaire) return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: ['QUESTIONNAIRE_NOT_LOADED'] };

  // Automatic reconciliation (fallback, Phase 3): authenticated + valid
  // questionnaire loaded + no active program → generate now.
  options?.onGenerationStart?.();
  try {
    const result = await generateAndPersistWorkoutProgramDeduped({
      uid,
      questionnaireId: questionnaire.id,
      questionnaireVersion: questionnaire.version,
      answers: questionnaire.answers,
      source: 'automatic_reconciliation',
    });
    logInfo('workout_program', 'workout_program_generation_attempted', {
      source: 'automatic_reconciliation',
      outcome: result.status,
      // Absent only on SUCCESS — every failure outcome carries these so a
      // generic `INVALID_CONFIGURATION` in the logs is distinguishable from
      // e.g. `MISSING_TEMPLATE`/`NEEDS_QUESTIONNAIRE_UPDATE`, and from each
      // other's specific cause, without exposing anything to the end user.
      reasonCodes: result.status === 'SUCCESS' ? undefined : result.reasonCodes,
    });
    return toPrescription(result);
  } catch (error) {
    logWarn('workout_program', 'workout_program_generation_failed', { source: 'automatic_reconciliation', error });
    return { status: 'INVALID_CONFIGURATION', reasonCodes: ['PROGRAM_PERSIST_FAILED'] };
  }
}

/**
 * Loading this hook never runs the engine on its own — but finding NO
 * active program for an otherwise-valid questionnaire immediately attempts
 * to generate one (`reload`'s automatic reconciliation, below). This is the
 * ONLY place that policy lives:
 *
 *   authenticated + questionnaire loaded + no active program → generate.
 *
 * Phase 3 made this a FALLBACK, not the normal path — a happy-path
 * onboarding already has its program persisted before Home ever mounts
 * (`persistPreparedWorkoutProgram`, called from `signUp()`). This hook's
 * `reload()` still always does its own `loadActiveWorkoutProgram` read
 * first, on every mount — that real Firestore round-trip takes non-zero
 * time on a real device (unlike the emulator), so a brief `loading` window
 * is unavoidable and NOT itself a bug. What IS a bug — fixed here — is
 * that window being indistinguishable from a real, actionable
 * `NEEDS_QUESTIONNAIRE_UPDATE`/`INVALID_CONFIGURATION` outcome: `loading`
 * is the one thing every caller must check first.
 *
 * This hook only ever mounts inside `AppShell`, which the root navigation
 * gate (`src/lib/premiumGate.ts`) never opens until auth, the questionnaire,
 * and the commercial/premium gate are ALL resolved — so "this hook is
 * mounted" already IS the "ready to reconcile" signal; no separate
 * premium/commercial check is needed here.
 *
 * Concurrency/idempotency is NOT reimplemented here — `generateAndPersist-
 * WorkoutProgram` already derives a deterministic `programId` from the
 * questionnaire+template+prescription identity and persists it inside a
 * Firestore transaction (`saveAndActivateWorkoutProgram`), so two concurrent
 * calls for the same identity converge on the same document (proven by the
 * Progression Engine's own concurrent-apply integration test). On top of
 * that, `generateAndPersistWorkoutProgramDeduped` (module-level, in
 * `services/workoutPrograms.ts`) collapses concurrent callers across
 * DIFFERENT instances of this hook (e.g. `AppShell` unmounting/remounting
 * mid-transition) into one shared Firestore transaction instead of two —
 * this hook no longer needs its own per-instance in-flight guard at all.
 */
export function useWorkoutPrescription(): WorkoutPrescriptionController {
  const { user, questionnaire } = useAuth();
  const identity = user?.uid ?? 'signed-out';
  const [resolved, setResolved] = useState<{ identity: string; result: PrescriptionResult }>({
    identity: 'unresolved',
    result: loadingResult,
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const runGeneration = useCallback(async (
    uid: string,
    questionnaireId: string,
    questionnaireVersion: number,
    answers: QuestionnaireAnswers,
    source: 'onboarding' | 'manual_regeneration' | 'automatic_reconciliation',
  ): Promise<PrescriptionResult> => {
    setGenerating(true);
    try {
      const result = await generateAndPersistWorkoutProgramDeduped({
        uid,
        questionnaireId,
        questionnaireVersion,
        answers,
        source,
      });
      const prescription = toPrescription(result);
      setResolved({ identity: uid, result: prescription });
      logInfo('workout_program', 'workout_program_generation_attempted', {
        source,
        outcome: result.status,
        reasonCodes: result.status === 'SUCCESS' ? undefined : result.reasonCodes,
      });
      return prescription;
    } catch (error) {
      logWarn('workout_program', 'workout_program_generation_failed', { source, error });
      const result: PrescriptionResult = { status: 'INVALID_CONFIGURATION', reasonCodes: ['PROGRAM_PERSIST_FAILED'] };
      setResolved({ identity: uid, result });
      return result;
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    if (!user) {
      setResolved({ identity, result: { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: ['AUTHENTICATION_REQUIRED'] } });
      setLoading(false);
      return;
    }
    // `loading` stays true through the whole resolution (including a
    // fallback generation, if one runs) — the UI never sees a stale
    // pre-generation state in between.
    const result = await resolveWorkoutPrescription(user.uid, questionnaire, {
      onGenerationStart: () => setGenerating(true),
    });
    setResolved({ identity, result });
    setGenerating(false);
    setLoading(false);
  }, [identity, questionnaire, user]);

  useEffect(() => { void reload(); }, [reload]);

  const generate = useCallback(async (): Promise<PrescriptionResult> => {
    if (!user || !questionnaire) {
      return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: ['QUESTIONNAIRE_NOT_LOADED'] };
    }
    return runGeneration(user.uid, questionnaire.id, questionnaire.version, questionnaire.answers, 'manual_regeneration');
  }, [questionnaire, user, runGeneration]);

  const identityResolved = resolved.identity === identity;
  return {
    prescription: identityResolved ? resolved.result : loadingResult,
    loading: identityResolved ? loading : true,
    generating,
    generate,
    reload,
  };
}
