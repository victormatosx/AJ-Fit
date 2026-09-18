import { ActivityIndicator, Modal, Pressable, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { darkTheme } from '../../theme';
import { HudCorners } from '../ui/Card';
import { Display, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import type { WorkoutExecutionStartError } from '../../workoutExecution/useWorkoutExecution';

/**
 * P0 integrity fix (2026-09, docs/workout-lifecycle/): shown whenever
 * `start()` fails because a WorkoutExecution mutex is already held —
 * either another execution is legitimately `IN_PROGRESS` (`CONFLICT`), or a
 * legacy `IN_PROGRESS` execution predates the mutex and was never resolved
 * (`LEGACY_PENDING`). Deliberately offers only "abandon the pending
 * session," never "resume" — the current architecture cannot yet safely
 * rehydrate a partially-restored WorkoutScreen (progress, order, rest
 * timer), so offering resume here would be worse than the blocked state it
 * replaces (docs §12/§25).
 */
export function WorkoutExecutionPendingModal({
  error,
  resolving,
  onAbandonPrevious,
  onContactSupport,
  onCancel,
}: {
  error: WorkoutExecutionStartError | null;
  /** True while the abandon-and-retry operation is in flight — both actions are disabled. */
  resolving: boolean;
  onAbandonPrevious: (executionId: string) => void;
  onContactSupport: () => void;
  onCancel: () => void;
}) {
  const theme = darkTheme;
  const { t } = useTranslation('workout');
  const visible = error !== null;
  const ambiguous = error?.code === 'LEGACY_PENDING' && error.executionIds.length > 1;
  // §11 "Mais de uma": never silently pick a winner among ambiguous legacy
  // executions — no abandon action is offered for that case at all, only a
  // block. A single CONFLICT or a single legacy orphan is unambiguous and
  // safe to offer "abandon" for.
  const executionId = ambiguous
    ? null
    : error?.code === 'CONFLICT'
      ? error.active.executionId
      : error?.code === 'LEGACY_PENDING'
        ? error.executionIds[0]
        : null;
  const title = error?.code === 'UNKNOWN' ? t('startError.title') : t('pendingExecution.title');
  const body = error?.code === 'CONFLICT'
    ? t('pendingExecution.conflictBody')
    : error?.code === 'LEGACY_PENDING'
      ? ambiguous
        ? t('pendingExecution.legacyAmbiguousBody', { count: error.executionIds.length })
        : t('pendingExecution.legacyBody')
      : t('startError.body');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={resolving ? undefined : onCancel} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        onPress={resolving ? undefined : onCancel}
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'center', paddingHorizontal: 34 }}
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
            <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
              {body}
            </Text>

            {executionId && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: resolving }}
                disabled={resolving}
                onPress={() => onAbandonPrevious(executionId)}
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
                  opacity: resolving ? 0.6 : 1,
                }}
              >
                {resolving ? (
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
                  {resolving ? t('pendingExecution.resolving') : t('pendingExecution.abandonPrevious')}
                </Text>
              </Pressable>
            )}

            {ambiguous && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: resolving }}
                disabled={resolving}
                onPress={onContactSupport}
                style={{
                  marginTop: 18,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderBottomRightRadius: 0,
                  backgroundColor: theme.colors.inverseSurface,
                  alignItems: 'center',
                  opacity: resolving ? 0.6 : 1,
                }}
              >
                <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.display, fontSize: 14, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  {t('pendingExecution.contactSupport')}
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: resolving }}
              disabled={resolving}
              onPress={onCancel}
              style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                {t('pendingExecution.cancel')}
              </Text>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
