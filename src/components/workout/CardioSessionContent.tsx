import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import { MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { SegBar } from '../ui/SegBar';

type Props = {
  cardio: { mode: string; duration: string; intensity: string };
  ready: boolean;
  targetReached: boolean;
  targetClock: string;
  remainingClock: string;
  progress: number;
  celebration?: ReactNode;
  /**
   * True while a "Pular"/"Finalizar" tap is persisting the cardio
   * completion to the durable execution record — both footer buttons
   * become non-interactive (never just visually dimmed) so a slow network
   * can never be raced by a second tap (docs — Cardio Finisher Completion
   * Recovery hardening).
   */
  finishing?: boolean;
  onClose: () => void;
  onSkip: () => void;
  onStart: () => void;
  onExtend: () => void;
  onFinish: () => void;
};

/** A restrained cardio adaptation of RestOverlay: stable clock, segmented
 * progress, one information card, and controls in a fixed footer. */
export function CardioSessionContent({
  cardio, ready, targetReached, targetClock, remainingClock,
  progress, celebration, finishing, onClose, onSkip, onStart, onExtend, onFinish,
}: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 720 || fontScale > 1.2;
  const progressPercent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const clock = ready ? targetClock : remainingClock;
  const status = t(
    ready
      ? 'cardioSession.readyLabel'
      : targetReached
        ? 'cardioSession.targetReachedTitle'
        : 'cardioSession.runningLabel',
  );
  const statusColor = targetReached ? theme.colors.success : theme.colors.primaryEmphasis;
  const runningReveal = useRef(new Animated.Value(ready ? 0 : 1)).current;

  useEffect(() => {
    if (ready) {
      runningReveal.setValue(0);
      return undefined;
    }

    runningReveal.setValue(0);
    const animation = Animated.timing(runningReveal, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [ready, runningReveal]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('cardioSession.accessibility.close')}
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            {
              backgroundColor: theme.colors.surfacePressed,
              borderColor: theme.colors.borderStrong,
              opacity: pressed ? theme.opacity.pressed : 1,
            },
          ]}
        >
          <Icon name="x" size={15} color={theme.colors.iconEmphasis} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <MonoLabel style={styles.headerName}>
            {cardio.mode.toUpperCase()}
          </MonoLabel>
          <MonoLabel style={styles.headerMeta}>
            {`${cardio.duration} • ${cardio.intensity}`.toUpperCase()}
          </MonoLabel>
        </View>
        <View style={[styles.close, styles.closeSpacer]} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, compact && styles.contentCompact]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.timer,
            !ready && {
              opacity: runningReveal,
              transform: [{ translateY: runningReveal.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }) }],
            },
          ]}
        >
          <Slash style={styles.timerLabel}>
            {t(ready ? 'cardioSession.targetLabel' : 'cardioSession.remainingLabel').toUpperCase()}
          </Slash>
          <Text
            accessibilityLabel={t('cardioSession.accessibility.timer')}
            style={[
              styles.clock,
              compact && styles.clockCompact,
              { color: theme.colors.textPrimary, fontFamily: theme.fonts.display },
            ]}
          >
            {clock}
          </Text>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('cardioSession.accessibility.timer')}
            accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
            style={styles.progress}
          >
            <SegBar value={progress} segs={14} />
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text accessibilityLiveRegion="polite" style={{ color: statusColor, fontFamily: theme.fonts.ui, fontSize: 13 }}>
              {status}
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      <View style={[styles.footer, compact && styles.footerCompact]}>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(ready ? 'cardioSession.start' : 'cardioSession.finish')}
            accessibilityState={{ disabled: !!finishing, busy: !!finishing }}
            disabled={finishing}
            onPress={ready ? onStart : onFinish}
            style={({ pressed }) => [
              styles.primary,
              {
                backgroundColor: theme.colors.primary,
                shadowColor: theme.colors.primary,
                opacity: pressed || finishing ? theme.opacity.pressed : 1,
              },
            ]}
          >
            {finishing && !ready ? (
              <ActivityIndicator color={theme.colors.primaryForeground} />
            ) : (
              <Animated.View
                style={[
                  styles.primaryContent,
                  !ready && { opacity: runningReveal },
                ]}
              >
                <Icon name={ready ? 'play' : 'check'} size={14} color={theme.colors.primaryForeground} />
                <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.display, fontSize: 14, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                  {t(ready ? 'cardioSession.start' : 'cardioSession.finish')}
                </Text>
              </Animated.View>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(ready ? 'cardioSession.skipAndFinish' : 'cardioSession.extendAccessibility')}
            accessibilityState={{ disabled: !!finishing, busy: ready && !!finishing }}
            disabled={finishing}
            onPress={ready ? onSkip : onExtend}
            style={({ pressed }) => [
              styles.secondary,
              {
                backgroundColor: theme.colors.surfacePressed,
                borderColor: theme.colors.borderStrong,
                opacity: pressed || finishing ? theme.opacity.pressed : 1,
              },
            ]}
          >
            {finishing && ready ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <Text
                numberOfLines={2}
                style={[
                  styles.secondaryText,
                  { color: theme.colors.textPrimary, fontFamily: theme.fonts.mono },
                ]}
              >
                {t(ready ? 'cardioSession.skip' : 'cardioSession.extend')}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {celebration}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 464, alignSelf: 'center', position: 'relative' },
  header: {
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  headerCompact: { paddingTop: 6, paddingBottom: 6 },
  headerName: { textAlign: 'center' },
  headerMeta: { textAlign: 'center', marginTop: 4 },
  close: {
    width: 44, height: 44, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  closeSpacer: { borderWidth: 0, opacity: 0 },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, paddingVertical: 24,
  },
  contentCompact: { paddingVertical: 14 },
  timer: { width: '100%', alignItems: 'center' },
  timerLabel: { marginBottom: 14 },
  clock: {
    fontSize: 104, lineHeight: displayLineHeight(104), color: '#fff',
    textAlign: 'center', includeFontPadding: false, fontVariant: ['tabular-nums'],
    transform: [{ skewX: '-8deg' }],
  },
  clockCompact: { fontSize: 88, lineHeight: displayLineHeight(88) },
  progress: { width: 220, marginTop: 22 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  footer: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 12 },
  footerCompact: { paddingTop: 10, paddingBottom: 8 },
  actions: { width: '100%', flexDirection: 'column', gap: 10 },
  secondary: { width: '100%', height: 52, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  secondaryText: { fontSize: 11, lineHeight: 15, letterSpacing: 0.8, textAlign: 'center', textTransform: 'uppercase' },
  primary: {
    width: '100%', height: 52, paddingHorizontal: 14,
    borderRadius: 12, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 9,
    shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 7,
  },
  primaryContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
});
