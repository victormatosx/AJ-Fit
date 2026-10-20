import { useTranslation } from 'react-i18next';
import { AjMoment, type AjMomentOption } from '../aj/AjMoment';
import type { MissDecision } from '../../scheduleEngine';

/**
 * UI for MISSED_SESSION_DECISION_REQUIRED (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md §Sessão perdida). Only ever opened on demand, from
 * the same "iniciar treino" flow as `StartWorkoutConfirmation` — never
 * automatically from the Schedule Engine resolution alone.
 *
 * Presentation only, and ONE continuous AJ conversation with two beats:
 *
 * 1. **Ask.** The two answers ARE the two domain decisions, unchanged:
 *      "sim, refazer" -> onChoose('CONTINUE_SEQUENCE')  (do the missed
 *                        session first — `missedDecision.continueSequence`)
 *      "não, seguir"  -> onChoose('FOLLOW_SCHEDULE')    (skip it and train
 *                        today's — `missedDecision.followSchedule`)
 *    Each answer keeps the existing subtitle as its description, so the
 *    exact consequence of each decision is still spelled out verbatim.
 *
 * 2. **Confirm.** Once `resolved` arrives — i.e. the caller's `onChoose`
 *    committed and the Schedule Engine published a `SESSION_READY` — AJ
 *    states what changed and offers to start the session that is now
 *    today's. This beat never re-decides anything: by the time it shows,
 *    the decision is already durable. Its CTA hands over to
 *    `StartWorkoutConfirmation`, exactly the step this flow reached
 *    automatically before the beat existed, and "Depois" returns to idle —
 *    the same place a dismissal has always landed, with the decision left
 *    resolved.
 *
 * Both beats are deliberately the SAME `AjMoment` (a `step` change, so AJ
 * nods and retypes), never two overlays: handing over between two native
 * `Modal`s means presenting one while the other is still dismissing, which
 * iOS drops — the second screen simply never appears.
 *
 * The missed session's name/focus is not spoken in beat 1: the modal is only
 * handed the decision identity (indices and dates), never the prescription.
 * In beat 2 the letter comes from the engine's own `SESSION_READY
 * .sessionIndex`, with the same A/B/C convention Home and Treino already use
 * for a session's position in the prescribed rotation — never recomputed.
 *
 * There is still no explicit "not now" button in beat 1 — CONTINUE_SEQUENCE/
 * FOLLOW_SCHEDULE are the only two domain decisions offered — but tapping
 * the backdrop (or the close button) dismisses it while a resolution isn't
 * in flight, same as before. Dismissing beat 1 does not skip/resolve the
 * pending miss: `pendingMissDecision` stays exactly as it was, and the next
 * "Iniciar treino" tap reopens this same modal.
 */
export function MissedSessionDecisionModal({
  visible,
  pending,
  refreshing,
  error,
  resolved = null,
  onChoose,
  onCancel,
  onStartResolved,
}: {
  visible: boolean;
  /** Decision currently being resolved, or null when idle. Both options are disabled while this is set — a second tap must never fire a second resolution. */
  pending: MissDecision | null;
  /** A newer authoritative schedule is loading; old choices are temporarily inert. */
  refreshing: boolean;
  /** True when the last attempt failed — the modal stays open and both options remain retryable. */
  error: boolean;
  /**
   * The committed outcome. Non-null only after a decision durably resolved
   * to a ready session; switches AJ from asking to confirming. Never a
   * second chance to decide.
   */
  resolved?: { decision: MissDecision; sessionIndex: number } | null;
  onChoose: (decision: MissDecision) => void;
  /** Dismisses the modal (backdrop/close tap, or "Depois") — never called while `pending` is set. */
  onCancel: () => void;
  /** Continues from the confirmation beat into the existing start-workout confirmation. */
  onStartResolved?: () => void;
}) {
  const { t } = useTranslation('home');
  const busy = pending !== null || refreshing;
  const letter = resolved ? String.fromCharCode(65 + resolved.sessionIndex) : null;

  const decisionOptions: AjMomentOption[] = [
    {
      key: 'CONTINUE_SEQUENCE',
      label: t('schedule.missedDecision.aj.continueSequence'),
      description: t('schedule.missedDecision.continueSequence.subtitle'),
      onPress: () => onChoose('CONTINUE_SEQUENCE'),
      loading: pending === 'CONTINUE_SEQUENCE',
      disabled: busy,
      primary: true,
    },
    {
      key: 'FOLLOW_SCHEDULE',
      label: t('schedule.missedDecision.aj.followSchedule'),
      description: t('schedule.missedDecision.followSchedule.subtitle'),
      onPress: () => onChoose('FOLLOW_SCHEDULE'),
      loading: pending === 'FOLLOW_SCHEDULE',
      disabled: busy,
    },
  ];

  const resolvedOptions: AjMomentOption[] = [
    {
      key: 'start',
      label: t('schedule.missedDecision.aj.startSession', { letter }),
      onPress: () => onStartResolved?.(),
      variant: 'cta',
      primary: true,
      // Hands over to StartWorkoutConfirmation, which is itself a native
      // Modal — this overlay must be gone before that one presents.
      closesMoment: true,
    },
    {
      key: 'later',
      label: t('schedule.missedDecision.aj.later'),
      onPress: onCancel,
      variant: 'link',
      closesMoment: true,
    },
  ];

  return (
    <AjMoment
      visible={visible}
      step={letter ? 'resolved' : 'decision'}
      // The confirmation beat reports an outcome rather than asking
      // anything, so its line stays a statement and its actions carry no
      // radio indicator.
      statement={letter !== null}
      lines={letter
        ? [resolved?.decision === 'FOLLOW_SCHEDULE'
            ? t('schedule.missedDecision.aj.resolvedFollowSchedule', { letter })
            : t('schedule.missedDecision.aj.resolvedContinueSequence', { letter })]
        : [t('schedule.missedDecision.title'), t('schedule.missedDecision.aj.question')]}
      options={letter ? resolvedOptions : decisionOptions}
      error={!letter && error ? t('schedule.missedDecision.error') : null}
      mood={letter ? 'happy' : 'idle'}
      dismissible
      onDismiss={onCancel}
      busy={busy}
      closeAccessibilityLabel={t('todayCard.confirm.accessibilityClose', {
        defaultValue: t('todayCard.confirm.dismiss'),
      })}
    />
  );
}
