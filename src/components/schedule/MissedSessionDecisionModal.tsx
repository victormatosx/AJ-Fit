import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { darkTheme } from '../../theme';
import { HudCorners } from '../ui/Card';
import { Display, Slash } from '../ui/Display';
import { OutlineNumber } from '../ui/OutlineNumber';
import { Icon } from '../ui/Icon';
import type { MissDecision } from '../../scheduleEngine';

/**
 * UI for MISSED_SESSION_DECISION_REQUIRED (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md §Sessão perdida). Only ever opened on demand, from
 * the same "iniciar treino" flow as `StartWorkoutConfirmation` — reuses that
 * exact poster shell (Dark gradient, HudCorners, OutlineNumber, Slash
 * kicker/Display title, notched-corner card) instead of a generic dialog, so
 * the two read as one continuous flow. No technical detail (session index,
 * cursor, event ledger) is shown to the user, and the copy is deliberately
 * neutral — a missed workout isn't a failure to call out.
 *
 * There is no explicit "not now" button — CONTINUE_SEQUENCE/FOLLOW_SCHEDULE
 * are the only two domain decisions this modal offers — but tapping outside
 * the card (the backdrop) dismisses it, same as StartWorkoutConfirmation,
 * while a resolution isn't in flight. Dismissing just returns to
 * `startWorkoutFlow: 'idle'`: it does not skip/resolve the pending miss —
 * `pendingMissDecision` stays exactly as it was, and the next "Iniciar
 * treino" tap reopens this same modal.
 */
export function MissedSessionDecisionModal({
  visible,
  pending,
  refreshing,
  error,
  onChoose,
  onCancel,
}: {
  visible: boolean;
  /** Decision currently being resolved, or null when idle. Both options are disabled while this is set — a second tap must never fire a second resolution. */
  pending: MissDecision | null;
  /** A newer authoritative schedule is loading; old choices are temporarily inert. */
  refreshing: boolean;
  /** True when the last attempt failed — the modal stays open and both options remain retryable. */
  error: boolean;
  onChoose: (decision: MissDecision) => void;
  /** Dismisses the modal (backdrop tap only) — never called while `pending` is set. */
  onCancel: () => void;
}) {
  // Product invariant: shares StartWorkoutConfirmation's Dark poster artwork
  // — this is a continuation of the same "iniciar treino" flow, not a
  // separate surface.
  const theme = darkTheme;
  const { t } = useTranslation('home');
  const busy = pending !== null || refreshing;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onCancel}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('todayCard.confirm.accessibilityClose', {
          defaultValue: t('todayCard.confirm.dismiss'),
        })}
        onPress={busy ? undefined : onCancel}
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlayStrong,
          justifyContent: 'center',
          paddingHorizontal: 34,
        }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
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
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
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
            <OutlineNumber
              size={118}
              color={theme.colors.decorativeOutline}
              style={{
                position: 'absolute',
                top: -28,
                right: -8,
                opacity: 0.28,
              }}
            >
              !
            </OutlineNumber>

            <Slash
              accentColor={theme.colors.primaryEmphasis}
              textColor={theme.colors.textFaint}
            >
              {t('schedule.missedDecision.kicker').toUpperCase()}
            </Slash>
            <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
              {t('schedule.missedDecision.title').toUpperCase()}
            </Display>
            <Text
              style={{
                color: theme.colors.textSecondaryStrong,
                fontFamily: theme.fonts.ui,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 8,
              }}
            >
              {t('schedule.missedDecision.body')}
            </Text>

            {error && (
              <View
                style={{
                  marginTop: 14,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: theme.colors.warning,
                  backgroundColor: theme.colors.surfaceMuted,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.warning,
                    fontFamily: theme.fonts.uiSemi,
                    fontSize: 12,
                    lineHeight: 17,
                  }}
                >
                  {t('schedule.missedDecision.error')}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onChoose('CONTINUE_SEQUENCE')}
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
                opacity: busy && pending !== 'CONTINUE_SEQUENCE' ? 0.5 : 1,
              }}
            >
              {pending === 'CONTINUE_SEQUENCE' ? (
                <ActivityIndicator color={theme.colors.inverseForeground} />
              ) : (
                <Icon name="arrow-right" size={12} color={theme.colors.inverseForeground} />
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: theme.colors.inverseForeground,
                    fontFamily: theme.fonts.display,
                    fontSize: 14,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('schedule.missedDecision.continueSequence.title')}
                </Text>
                <Text
                  style={{
                    fontFamily: theme.fonts.ui,
                    fontSize: 12,
                    color: theme.colors.inverseForeground,
                    opacity: 0.8,
                    marginTop: 2,
                  }}
                >
                  {t('schedule.missedDecision.continueSequence.subtitle')}
                </Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onChoose('FOLLOW_SCHEDULE')}
              style={{
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderBottomRightRadius: 0,
                backgroundColor: theme.colors.controlBackground,
                borderWidth: 1,
                borderColor: theme.colors.controlBorder,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                opacity: busy && pending !== 'FOLLOW_SCHEDULE' ? 0.5 : 1,
              }}
            >
              {pending === 'FOLLOW_SCHEDULE' ? (
                <ActivityIndicator color={theme.colors.textPrimary} />
              ) : (
                <Icon name="calendar" size={12} color={theme.colors.textPrimary} />
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: theme.fonts.uiSemi,
                    fontSize: 14,
                    color: theme.colors.textPrimary,
                  }}
                >
                  {t('schedule.missedDecision.followSchedule.title')}
                </Text>
                <Text
                  style={{
                    fontFamily: theme.fonts.ui,
                    fontSize: 12,
                    color: theme.colors.textMuted,
                    marginTop: 2,
                  }}
                >
                  {t('schedule.missedDecision.followSchedule.subtitle')}
                </Text>
              </View>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
