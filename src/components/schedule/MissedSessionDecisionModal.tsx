import { Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import type { MissDecision } from '../../scheduleEngine';

/**
 * Minimal UI for MISSED_SESSION_DECISION_REQUIRED (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md §Sessão perdida). Never auto-chosen — the engine
 * detects the conflict, this asks. No technical detail (session index,
 * cursor, event ledger) is shown to the user, and the copy is deliberately
 * neutral — a missed workout isn't a failure to call out.
 */
export function MissedSessionDecisionModal({
  visible,
  onChoose,
}: {
  visible: boolean;
  onChoose: (decision: MissDecision) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
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
            {t('schedule.missedDecision.title')}
          </Text>
          <Text style={{ fontSize: 14, color: theme.colors.textMuted, marginBottom: 22 }}>
            {t('schedule.missedDecision.body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onChoose('CONTINUE_SEQUENCE')}
            style={{
              paddingVertical: 15,
              borderRadius: 14,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14.5, color: theme.colors.primaryForeground }}>
              {t('schedule.missedDecision.continueSequence.title')}
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.primaryForeground, opacity: 0.85, marginTop: 2 }}>
              {t('schedule.missedDecision.continueSequence.subtitle')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onChoose('FOLLOW_SCHEDULE')}
            style={{
              paddingVertical: 15,
              borderRadius: 14,
              backgroundColor: theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}>
              {t('schedule.missedDecision.followSchedule.title')}
            </Text>
            <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {t('schedule.missedDecision.followSchedule.subtitle')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
