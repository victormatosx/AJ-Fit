import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { Card } from '../ui/Card';
import { CtaButton } from '../ui/CtaButton';
import { Display, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';

type Props = {
  cardio: { mode: string; duration: string; intensity: string };
  ready: boolean;
  targetReached: boolean;
  doneClock: string;
  targetClock: string;
  remainingClock: string;
  progress: number;
  celebration?: ReactNode;
  onClose: () => void;
  onStart: () => void;
  onExtend: () => void;
  onFinish: () => void;
};

/** Shared layout for the ready, running and goal-reached cardio states. */
export function CardioSessionContent({
  cardio, ready, targetReached, doneClock, targetClock, remainingClock,
  progress, celebration, onClose, onStart, onExtend, onFinish,
}: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 700 && fontScale <= 1.2;
  const accent = targetReached ? theme.colors.success : theme.colors.primaryEmphasis;
  const progressPercent = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('cardioSession.accessibility.close')}
          onPress={onClose}
          style={({ pressed }) => [styles.close, {
            backgroundColor: theme.colors.controlBackground,
            borderColor: theme.colors.controlBorder,
            opacity: pressed ? theme.opacity.pressed : 1,
          }]}
        >
          <Icon name="x" size={18} color={theme.colors.iconEmphasis} />
        </Pressable>
        <View style={styles.headerCopy}>
          <MonoLabel color={theme.colors.primaryEmphasis} style={styles.eyebrow}>
            {t('cardioFinisher.kicker')}
          </MonoLabel>
          <Display size={compact ? 22 : 26} skew={false}>{t('cardioFinisher.title')}</Display>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, compact && styles.contentCompact]}
        showsVerticalScrollIndicator={false}
      >
        <Card style={[styles.prescription, compact && styles.prescriptionCompact]}>
          <View style={styles.prescriptionHeading}>
            <View style={[styles.iconTile, { backgroundColor: theme.colors.primarySoft }]}>
              <Icon name="heart" size={22} color={theme.colors.primaryEmphasis} />
            </View>
            <Text style={[theme.typography.title, styles.mode, compact && styles.modeCompact, { color: theme.colors.textPrimary }]}>
              {cardio.mode}
            </Text>
          </View>
          <View style={[styles.prescriptionDetails, compact && styles.detailsCompact, { borderTopColor: theme.colors.divider }]}>
            <View style={[styles.detail, compact && styles.durationCompact]}>
              {!compact && <MonoLabel color={theme.colors.textMuted} style={styles.eyebrow}>
                {t('cardioSession.durationLabel')}
              </MonoLabel>}
              <Text style={[compact ? theme.typography.bodySmall : theme.typography.subtitle, { color: theme.colors.textPrimary }]}>{cardio.duration}</Text>
            </View>
            <View style={styles.detail}>
              {!compact && <MonoLabel color={theme.colors.textMuted} style={styles.eyebrow}>
                {t('cardioSession.intensityLabel')}
              </MonoLabel>}
              <Text style={[compact ? theme.typography.bodySmall : theme.typography.subtitle, { color: theme.colors.textPrimary }]}>{cardio.intensity}</Text>
            </View>
          </View>
        </Card>

        <LinearGradient
          colors={theme.gradients.accentSummary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.timerCard, compact && styles.timerCompact, { borderColor: theme.colors.primaryBorderSoft }]}
        >
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: accent }]} />
            <Text accessibilityLiveRegion="polite" style={[theme.typography.bodySmall, styles.statusText, { color: accent }]}>
              {t(ready ? 'cardioSession.readyLabel' : targetReached ? 'cardioSession.targetReachedTitle' : 'cardioSession.runningLabel')}
            </Text>
          </View>
          <View style={styles.clockBlock}>
            <MonoLabel color={theme.colors.textSecondary} style={styles.eyebrow}>
              {t(ready ? 'cardioSession.targetLabel' : 'cardioSession.elapsedLabel')}
            </MonoLabel>
            <Text
              accessibilityLabel={ready ? t('cardioSession.targetLabel') : t('cardioSession.accessibility.timer')}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={[styles.clock, compact && styles.clockCompact, { fontFamily: theme.fonts.monoBold, color: targetReached ? accent : theme.colors.textPrimary }]}
            >
              {ready ? targetClock : doneClock}
            </Text>
            {!ready && (
              <Text style={[theme.typography.bodySmall, styles.target, { color: theme.colors.textSecondary }]}>
                {t('cardioSession.of', { target: targetClock })}
              </Text>
            )}
          </View>

          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('cardioSession.accessibility.timer')}
            accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
            style={[styles.progressTrack, { backgroundColor: theme.colors.progressTrack }]}
          >
            <View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: accent }]} />
          </View>

          {ready ? (
            <Text style={[theme.typography.bodySmall, styles.hint, { color: theme.colors.textSecondary }]}>
              {t('cardioSession.readyHint')}
            </Text>
          ) : (
            <View style={styles.timerBottom}>
              <Text style={[theme.typography.bodySmall, styles.remaining, { color: theme.colors.textSecondary }]}>
                {targetReached
                  ? t('cardioSession.targetReachedBody')
                  : t('cardioSession.remaining', { time: remainingClock })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('cardioSession.extendAccessibility')}
                onPress={onExtend}
                style={({ pressed }) => [styles.extend, {
                  backgroundColor: theme.colors.controlBackground,
                  borderColor: theme.colors.controlBorder,
                  opacity: pressed ? theme.opacity.pressed : 1,
                }]}
              >
                <Text style={[theme.typography.subtitle, { color: theme.colors.textPrimary }]}>{t('cardioSession.extend')}</Text>
              </Pressable>
            </View>
          )}
          {celebration}
        </LinearGradient>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
        <CtaButton
          onPress={ready ? onStart : onFinish}
          accessibilityLabel={t(ready ? 'cardioSession.start' : 'cardioSession.finish')}
          style={styles.fullWidth}
        >
          {t(ready ? 'cardioSession.start' : 'cardioSession.finish')}
        </CtaButton>
        {ready && (
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.skip, { opacity: pressed ? theme.opacity.pressed : 1 }]}
          >
            <Text style={[theme.typography.bodySmall, styles.skipText, { color: theme.colors.textSecondary }]}>
              {t('cardioSession.skipAndFinish')}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 464, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 20 },
  headerCompact: { paddingTop: 8, paddingBottom: 12 },
  close: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { letterSpacing: 1.2, lineHeight: 16 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 20 },
  contentCompact: { paddingBottom: 16, gap: 12 },
  prescription: { padding: 18, gap: 18 },
  prescriptionCompact: { padding: 12, gap: 10 },
  prescriptionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mode: { flex: 1, minWidth: 0 },
  modeCompact: { fontSize: 15, lineHeight: 20 },
  prescriptionDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, borderTopWidth: 1, paddingTop: 16 },
  detail: { flexGrow: 1, flexBasis: 110, gap: 5 },
  detailsCompact: { paddingTop: 8, gap: 12 },
  durationCompact: { flexGrow: 0, flexBasis: 70 },
  timerCard: { borderRadius: 20, borderWidth: 1, padding: 22, gap: 22 },
  timerCompact: { padding: 14, gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  statusText: { flexShrink: 1, textAlign: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  clockBlock: { alignItems: 'center', width: '100%' },
  clock: { width: '100%', fontSize: 64, lineHeight: 86, textAlign: 'center', includeFontPadding: false, fontVariant: ['tabular-nums'], letterSpacing: -2 },
  clockCompact: { fontSize: 48, lineHeight: 58 },
  target: { textAlign: 'center' },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  hint: { textAlign: 'center' },
  timerBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  remaining: { flexGrow: 1, flexBasis: 130 },
  extend: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  footer: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 12, borderTopWidth: 1, gap: 4 },
  fullWidth: { width: '100%' },
  skip: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  skipText: { textAlign: 'center' },
});
