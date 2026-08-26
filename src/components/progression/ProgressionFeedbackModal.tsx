import { Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';

export type ProgressionFeedbackKind = 'BEGINNER_STAGE_ADVANCED' | 'NORMAL_ROTATED';

/**
 * Minimal, non-clinical feedback for an already-applied progression
 * transition (docs/workout-lifecycle/04_PROGRESSION_ENGINE.md §24/§79-81).
 * Shown only after the transition already happened — this never asks the
 * user to confirm anything, and never mentions thresholds/days/percentages.
 */
export function ProgressionFeedbackModal({
  kind,
  onDismiss,
}: {
  kind: ProgressionFeedbackKind | null;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  return (
    <Modal visible={kind != null} transparent animationType="fade" statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlayStrong,
          justifyContent: 'center',
          paddingHorizontal: 28,
        }}
      >
        <View
          style={{
            borderRadius: 20,
            padding: 24,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 18, color: theme.colors.textPrimary, marginBottom: 8 }}>
            {t(kind === 'NORMAL_ROTATED' ? 'progression.rotated.title' : 'progression.beginnerStage.title')}
          </Text>
          <Text style={{ fontSize: 14, color: theme.colors.textMuted, marginBottom: 22 }}>
            {t(kind === 'NORMAL_ROTATED' ? 'progression.rotated.body' : 'progression.beginnerStage.body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={{
              paddingVertical: 15,
              borderRadius: 14,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14.5, color: theme.colors.primaryForeground }}>
              {t('progression.dismiss')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
