import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { darkTheme } from '../../theme';
import { HudCorners } from '../ui/Card';
import { Display, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
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
 * Three explicit actions, never conflated:
 * - `onResume` — only ever wired live for `status === 'pending'` with a
 *   matching program; hydrates and never writes to Firestore itself.
 * - `onFinish` — finalizes the recovered execution through the same
 *   authoritative callable used by WorkoutScreen, then exposes the normal
 *   completion experience only after durable success.
 * - `onDiscard` — the real destructive action (`abandonWorkoutExecution`);
 *   only offered when a real execution doc exists to abandon (`pending` or
 *   `inconsistent`/`EXECUTION_TERMINAL` — the latter is a safe no-op
 *   self-heal of a dangling pointer, never touches the terminal record).
 *
 * There is deliberately no dismiss action for a real execution. Backdrop
 * taps and Android Back are inert while recovery is unresolved: a pending
 * execution must be continued, finalized, or explicitly discarded. The
 * separate `onAcknowledgeMissing` escape exists only for the defensive
 * EXECUTION_MISSING state, where there is no workout document to act on.
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
  const theme = darkTheme;
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => undefined} statusBarTranslucent>
      <View
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'center', paddingHorizontal: 34 }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 340,
            alignSelf: 'center',
            borderRadius: 16,
            borderBottomRightRadius: 0,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.primaryBorderQuiet,
            backgroundColor: theme.colors.background,
          }}
        >
          <LinearGradient
            colors={theme.gradients.poster}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 18 }}
          >
            <HudCorners color={theme.colors.hudCorner} />
            <Slash accentColor={theme.colors.primaryEmphasis} textColor={theme.colors.textFaint}>
              {title.toUpperCase()}
            </Slash>
            <Display size={20} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
              {title.toUpperCase()}
            </Display>
            {!confirmingDiscard && execution && !executionMissing && (
              <Text style={{ color: theme.colors.textFaint, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 6 }}>
                {execution.sessionName} · {execution.performedLocalDate ?? execution.scheduledLocalDate}
              </Text>
            )}
            <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
              {body}
            </Text>
            {finishError && (
              <Text accessibilityRole="alert" style={{ color: theme.colors.warning, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
                {t('sessionRecovery.finishError')}
              </Text>
            )}
            {discardError && (
              <Text style={{ color: theme.colors.warning, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
                {t('sessionRecovery.discardError')}
              </Text>
            )}

            {!confirmingDiscard && canResume && state.status === 'pending' && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onResume}
                style={{
                  marginTop: 18,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderBottomRightRadius: 0,
                  backgroundColor: theme.colors.inverseSurface,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {resuming ? (
                  <ActivityIndicator color={theme.colors.inverseForeground} />
                ) : (
                  <Icon name="play" size={12} color={theme.colors.inverseForeground} />
                )}
                <Text
                  style={{
                    color: theme.colors.inverseForeground,
                    fontFamily: theme.fonts.display,
                    fontSize: 14,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {resuming ? t('sessionRecovery.resuming') : t('sessionRecovery.resume')}
                </Text>
              </Pressable>
            )}

            {!confirmingDiscard && canFinalize && execution && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onFinish}
                style={{
                  marginTop: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderBottomRightRadius: 0,
                  backgroundColor: theme.colors.inverseSurface,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {finishing ? (
                  <ActivityIndicator color={theme.colors.inverseForeground} />
                ) : (
                  <Icon name="check" size={12} color={theme.colors.inverseForeground} />
                )}
                <Text
                  style={{
                    color: theme.colors.inverseForeground,
                    fontFamily: theme.fonts.display,
                    fontSize: 14,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {finishing ? t('sessionRecovery.finishing') : t('sessionRecovery.finishNow')}
                </Text>
              </Pressable>
            )}

            {!confirmingDiscard && canDiscard && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={requestDiscard}
                style={{
                  marginTop: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderBottomRightRadius: 0,
                  borderWidth: 1,
                  borderColor: theme.colors.controlBorder,
                  alignItems: 'center',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                  {t('sessionRecovery.discard')}
                </Text>
              </Pressable>
            )}

            {confirmingDiscard && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onDiscard}
                  style={{
                    marginTop: 18,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    backgroundColor: theme.colors.inverseSurface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {discarding ? (
                    <ActivityIndicator color={theme.colors.inverseForeground} />
                  ) : (
                    <Icon name="x" size={12} color={theme.colors.inverseForeground} />
                  )}
                  <Text
                    style={{
                      color: theme.colors.inverseForeground,
                      fontFamily: theme.fonts.display,
                      fontSize: 14,
                      letterSpacing: 1.2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {discarding ? t('sessionRecovery.discarding') : t('sessionRecovery.discardConfirmYes')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={cancelDiscardConfirm}
                  style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center' }}
                >
                  <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                    {t('sessionRecovery.discardConfirmBack')}
                  </Text>
                </Pressable>
              </>
            )}

            {executionMissing && (
              <Pressable
                accessibilityRole="button"
                onPress={onAcknowledgeMissing}
                style={{
                  marginTop: 18,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderBottomRightRadius: 0,
                  backgroundColor: theme.colors.inverseSurface,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: theme.colors.inverseForeground,
                    fontFamily: theme.fonts.display,
                    fontSize: 14,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('sessionRecovery.dismiss')}
                </Text>
              </Pressable>
            )}

          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}
