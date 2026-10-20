import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AjMoment, type AjMomentOption } from '../aj/AjMoment';
import type { WorkoutSessionRecoveryState } from '../../workoutExecution/useWorkoutSessionRecovery';
import {
  computeWorkoutElapsedSeconds,
  formatWorkoutSessionDuration,
  isLongWorkoutSession,
  safeStartedAtMs,
} from '../../lib/workoutSessionTimer';

/**
 * Workout Recovery / Resume após process death — shown proactively at
 * bootstrap (before the user ever taps "Iniciar treino") whenever
 * `useWorkoutSessionRecovery` finds `workoutExecutionState/current`
 * pointing at a session that was never finished or abandoned. Unlike
 * `WorkoutExecutionPendingModal` (a reactive, abandon-only dead end shown
 * when `start()` itself throws a mutex conflict), this modal DOES offer
 * "Continuar" — `AppShell` hydrates `WorkoutScreen` straight from the
 * loaded execution via `useWorkoutExecution().adoptExecution`, never a new
 * `start()` call, so `startedAt`/progress/logged loads are all preserved
 * exactly as persisted.
 *
 * Presentation only: the AJ assistant (`AjMoment`) speaks the exact same
 * body copy this modal always chose and offers the same actions as answers.
 * Nothing about which actions exist, when they are offered, or what they do
 * changed — in particular AJ never promises anything the app cannot do (no
 * "save the sets and don't break the streak": discarding keeps logged sets
 * in history but doesn't count as completed, which is what
 * `discardConfirmBody` already says, and nothing freezes the cycle).
 *
 * Three explicit actions, never conflated:
 * - `onResume` — only ever wired live for `status === 'pending'` with a
 *   matching program; hydrates and never writes to Firestore itself.
 * - `onFinish` — finalizes the recovered execution through the same
 *   authoritative callable used by WorkoutScreen, then exposes the normal
 *   completion experience only after durable success.
 * - `onDiscard` — the real destructive action (`abandonWorkoutExecution`);
 *   only offered when a real execution doc exists to abandon (`pending` or
 *   `inconsistent`/`EXECUTION_TERMINAL` — the latter is a safe no-op
 *   self-heal of a dangling pointer, never touches the terminal record) and
 *   still only reached through its own confirmation sub-step.
 *
 * There is deliberately no dismiss action for a real execution:
 * `dismissible={false}` is what makes backdrop taps and Android Back inert
 * while recovery is unresolved — a pending execution must be continued,
 * finalized, or explicitly discarded. The separate `onAcknowledgeMissing`
 * escape exists only for the defensive EXECUTION_MISSING state, where there
 * is no workout document to act on.
 *
 * How far into the session the user got ("x de y séries") is deliberately
 * NOT spoken: `execution` carries the raw logged sets, but no shared helper
 * answers "how many of the prescribed sets count as done" for an
 * `IN_PROGRESS` execution (`completion` is written only at finalization), and
 * deriving one here would be a new rule. The session's name and date — the
 * identity this modal always showed — are spoken instead.
 *
 * Long-session alert: `execution.startedAt` (Firestore) is the ONLY source
 * of truth for how long a session has been open — never a second, locally
 * tracked instant. `elapsedSeconds` is computed fresh from it at render
 * time (no `setInterval`/ticking owned by this modal — it's a short-lived
 * decision surface, not the workout's own running timer) via the exact same
 * `computeWorkoutElapsedSeconds` WorkoutScreen's timer already uses, so
 * background/locked/process-death time counts identically in both places.
 * `safeStartedAtMs` never throws and collapses anything not a genuine
 * finite instant (missing, malformed, clock-skewed into the future) to a
 * value that simply never crosses the long-session threshold — this modal
 * fails closed to the plain, non-alarming copy, never to a crash or a
 * nonsensical duration.
 */
export function WorkoutSessionRecoveryModal({
  state,
  canResume,
  canFinalize,
  resuming,
  finishing,
  discarding,
  finishError,
  discardError,
  onResume,
  onFinish,
  onDiscard,
  onAcknowledgeMissing,
}: {
  state: WorkoutSessionRecoveryState;
  /** False when the pending execution's program no longer matches the account's active program — resume would render the wrong session. */
  canResume: boolean;
  /** Requires a real, finishable execution whose program still matches the active account program. */
  canFinalize: boolean;
  resuming: boolean;
  finishing: boolean;
  discarding: boolean;
  finishError: boolean;
  discardError: boolean;
  onResume: () => void;
  onFinish: () => void;
  onDiscard: () => void;
  /** Defensive escape only for an orphan pointer whose execution document does not exist; never rendered for a pending execution. */
  onAcknowledgeMissing: () => void;
}) {
  const { t } = useTranslation('workout');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const visible = state.status === 'pending' || state.status === 'inconsistent';
  const busy = resuming || finishing || discarding;

  // Reset the confirm sub-step whenever the modal closes (e.g. resumed
  // successfully) so it never reopens already mid-confirmation.
  if (!visible && confirmingDiscard) setConfirmingDiscard(false);

  const executionMissing = state.status === 'inconsistent' && state.reason === 'EXECUTION_MISSING';
  const canDiscard = !executionMissing;
  const execution = state.status === 'pending' || state.status === 'inconsistent' ? state.execution : null;

  // A single, freshly-captured "now" per state transition — never a
  // ticking `setInterval` (this is a short-lived decision surface, not the
  // workout's own running timer). `Date.now()` itself is only ever called
  // from a `useState` lazy initializer or this effect, both of which React
  // runs outside the render body proper, never as a bare impure call during
  // render.
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    if (state.status === 'pending' || state.status === 'inconsistent') setNowMs(Date.now());
  }, [state]);

  const startedAtMs = execution ? safeStartedAtMs(execution.startedAt) : null;
  const elapsedSeconds = startedAtMs !== null ? computeWorkoutElapsedSeconds(startedAtMs, nowMs) : null;
  const isLongSession = elapsedSeconds !== null && isLongWorkoutSession(elapsedSeconds);
  const durationLabel = elapsedSeconds !== null ? formatWorkoutSessionDuration(elapsedSeconds) : null;

  const requestDiscard = () => {
    if (busy) return;
    setConfirmingDiscard(true);
  };
  const cancelDiscardConfirm = () => {
    if (busy) return;
    setConfirmingDiscard(false);
  };

  const resumeOffered = canResume && state.status === 'pending';

  // Unchanged selection logic — only where the string is rendered moved.
  const title = confirmingDiscard
    ? t('sessionRecovery.discardConfirmTitle')
    : executionMissing
      ? t('sessionRecovery.inconsistentTitle')
      : t('sessionRecovery.title');

  const body = confirmingDiscard
    ? t('sessionRecovery.discardConfirmBody')
    : executionMissing
      ? t('sessionRecovery.inconsistentBody')
      : state.status === 'inconsistent'
        ? t('sessionRecovery.inconsistentTerminalBody')
        : !canResume
          ? t('sessionRecovery.programMismatchBody')
          // Normal users who simply closed the app mid-set never see this —
          // only a session that's genuinely been open >= 4h gets the more
          // pointed "are you still training?" copy instead of the plain one.
          : isLongSession && durationLabel
            ? t('sessionRecovery.longSessionBody', { duration: durationLabel })
            : t('sessionRecovery.body');

  // AJ always ends on a question. In the confirm/orphan sub-steps that
  // question IS the existing title; in the normal step it depends on whether
  // continuing is actually one of the answers, so AJ never asks about
  // resuming a session the program no longer matches.
  const question = confirmingDiscard || executionMissing
    ? title
    : resumeOffered
      ? t('sessionRecovery.aj.question')
      : t('sessionRecovery.aj.questionNoResume');

  // Session identity, exactly the line the poster shell showed above the body.
  const identityLine = !confirmingDiscard && execution && !executionMissing
    ? `${execution.sessionName} · ${execution.performedLocalDate ?? execution.scheduledLocalDate}`
    : null;

  const lines = [...(identityLine ? [identityLine] : []), body, question];

  const options: AjMomentOption[] = [];
  if (confirmingDiscard) {
    options.push({
      key: 'discardYes',
      label: discarding ? t('sessionRecovery.discarding') : t('sessionRecovery.discardConfirmYes'),
      onPress: onDiscard,
      loading: discarding,
      disabled: busy,
      primary: true,
    });
    options.push({
      key: 'discardBack',
      label: t('sessionRecovery.discardConfirmBack'),
      onPress: cancelDiscardConfirm,
      disabled: busy,
    });
  } else if (executionMissing) {
    options.push({
      key: 'acknowledgeMissing',
      label: t('sessionRecovery.dismiss'),
      onPress: onAcknowledgeMissing,
      primary: true,
    });
  } else {
    if (resumeOffered) {
      options.push({
        key: 'resume',
        label: resuming ? t('sessionRecovery.resuming') : t('sessionRecovery.resume'),
        onPress: onResume,
        loading: resuming,
        disabled: busy,
        primary: true,
      });
    }
    if (canFinalize && execution) {
      options.push({
        key: 'finish',
        label: finishing ? t('sessionRecovery.finishing') : t('sessionRecovery.finishNow'),
        onPress: onFinish,
        loading: finishing,
        disabled: busy,
      });
    }
    if (canDiscard) {
      options.push({
        key: 'discard',
        label: t('sessionRecovery.discard'),
        onPress: requestDiscard,
        disabled: busy,
      });
    }
  }

  // Both failures can be live at once (a failed finish, then a failed
  // discard); neither is dropped.
  const errorText = [
    finishError ? t('sessionRecovery.finishError') : null,
    discardError ? t('sessionRecovery.discardError') : null,
  ].filter(Boolean).join('\n') || null;

  return (
    <AjMoment
      visible={visible}
      lines={lines}
      options={options}
      error={errorText}
      // No dismiss action for a real execution: no close button, and
      // backdrop taps / Android Back stay inert.
      dismissible={false}
      busy={busy}
      step={confirmingDiscard ? 'discardConfirm' : executionMissing ? 'missing' : 'main'}
    />
  );
}
