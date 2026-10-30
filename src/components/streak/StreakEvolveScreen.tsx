import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CountUp } from '../home/CountUp';
import { StreakFlame } from '../home/StreakFlame';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import {
  streakFlameTierForDays,
  type StreakFlameTierId,
  type StreakMilestoneCelebration,
} from '../../home/streakFlameTiers';

/**
 * The streak-transformation celebration.
 *
 * Strictly presentational, and mounted only AFTER the workout completion is
 * durably confirmed and the milestone claim was won (see `AppShell.tsx` and
 * `streakCelebrationStorage.ts`). It never finalizes a workout, never reads
 * or writes streak state, and never touches navigation beyond invoking
 * `onContinue` exactly once.
 *
 * The value is always a count of DAYS — the daily activity streak has a
 * single unit, unlike the obligations/weeks split of the older
 * `computeStreak`. The copy says "dias" through i18n accordingly.
 */

/** Spec timeline, in ms from mount. `T0` is the moment of the swap. */
const T0 = 1300;
const T_CHARGE_START = 500;
const T_SPARKS = 1360;
const T_NEW_FLAME = 1380;
const T_COUNTER = 1480;
const T_TEXTS = 1900;
const T_STRIP = 2100;
const T_BUTTON = 2250;
const T_END = T_BUTTON + 450;

const FLAME_SIZE = 112;
const GLOW_CIRCLE = 260;
const FLASH_RING = 80;
const SPARK_COUNT = 8;
const SPARK_RADIUS = 74;
const SPARK_SIZE = 4;

const BG = '#020010';

export function StreakEvolveScreen({
  celebration,
  onContinue,
}: {
  celebration: StreakMilestoneCelebration;
  onContinue: () => void;
}) {
  const { t } = useTranslation('home');
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotionPreference();
  const { milestone, from, to, next } = celebration;

  // `useReducedMotionPreference` reports `false` until the native query
  // resolves, so starting the timeline on the very first render could play
  // the full animation at a user who asked for reduced motion. The timeline
  // therefore waits one tick for `motionReady`, and `stillRef` freezes the
  // answer at that moment — a later OS-level change must never restart or
  // re-style an animation that is already mid-flight.
  const [motionReady, setMotionReady] = useState(false);
  const stillRef = useRef(false);
  useEffect(() => {
    // One frame is enough: the hook's own effect resolves on mount.
    const id = setTimeout(() => {
      stillRef.current = reduceMotion;
      setMotionReady(true);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const still = motionReady && stillRef.current;

  // `true` once the counter should display the new value. Driven by a single
  // timeout so the roll happens once, not on every render.
  const [rolling, setRolling] = useState(false);
  const continueFiredRef = useRef(false);

  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  // All shared values start at the ANIMATED frame-0 pose. The reduce-motion
  // branch of the timeline effect snaps them to their final pose instead of
  // animating, so there is only ever one place that knows the end state.
  // Entry
  const bg = useSharedValue(0);
  const labelY = useSharedValue(16);
  const labelOpacity = useSharedValue(0);
  const flameY = useSharedValue(16);
  const flameOpacity = useSharedValue(0);
  const numberY = useSharedValue(16);
  const numberOpacity = useSharedValue(0);

  // Transformation
  const oldScale = useSharedValue(1);
  const oldShift = useSharedValue(0);
  const oldShake = useSharedValue(0);
  const oldOpacity = useSharedValue(1);
  const newScale = useSharedValue(0);
  const newOpacity = useSharedValue(0);
  const glowSwap = useSharedValue(0);
  const flashScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const sparkProgress = useSharedValue(0);
  const counterPop = useSharedValue(0);

  // Reveal
  const textsY = useSharedValue(16);
  const textsOpacity = useSharedValue(0);
  const stripY = useSharedValue(16);
  const stripOpacity = useSharedValue(0);
  const buttonY = useSharedValue(16);
  const buttonOpacity = useSharedValue(0);

  // Guards the timeline against ever running twice for one presentation.
  const timelineStartedRef = useRef(false);

  useEffect(() => {
    if (!motionReady || timelineStartedRef.current) return;
    timelineStartedRef.current = true;

    if (stillRef.current) {
      // Reduce motion: the same final composition, arrived at instantly.
      bg.value = 1;
      labelY.value = 0; labelOpacity.value = 1;
      flameY.value = 0; flameOpacity.value = 1;
      numberY.value = 0; numberOpacity.value = 1;
      oldOpacity.value = 0;
      newScale.value = 1; newOpacity.value = 1;
      glowSwap.value = 1;
      textsY.value = 0; textsOpacity.value = 1;
      stripY.value = 0; stripOpacity.value = 1;
      buttonY.value = 0; buttonOpacity.value = 1;
      setRolling(true);
      return;
    }

    const rise = (y: typeof labelY, o: typeof labelOpacity, delay: number) => {
      y.value = withDelay(delay, withTiming(0, { duration: 450, easing: Easing.out(Easing.cubic) }));
      o.value = withDelay(delay, withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }));
    };

    bg.value = withTiming(1, { duration: 300 });
    rise(labelY, labelOpacity, 100);
    rise(flameY, flameOpacity, 250);
    rise(numberY, numberOpacity, 300);

    // Phase 2 — the old flame charges up.
    const chargeMs = T0 - T_CHARGE_START;
    oldScale.value = withDelay(
      T_CHARGE_START,
      withTiming(1.12, { duration: chargeMs, easing: Easing.in(Easing.quad) }),
    );
    oldShift.value = withDelay(
      T_CHARGE_START,
      withTiming(-2, { duration: chargeMs, easing: Easing.in(Easing.quad) }),
    );
    // Side-to-side tremble, concentrated in the last ~400ms of the charge.
    oldShake.value = withDelay(
      T0 - 400,
      withRepeat(
        withSequence(
          withTiming(2, { duration: 50, easing: Easing.linear }),
          withTiming(-2, { duration: 50, easing: Easing.linear }),
        ),
        4,
        true,
      ),
    );

    // Phase 3 — the swap.
    oldScale.value = withDelay(T0, withTiming(0.25, { duration: 300, easing: Easing.in(Easing.cubic) }));
    oldOpacity.value = withDelay(T0, withTiming(0, { duration: 300, easing: Easing.in(Easing.cubic) }));
    glowSwap.value = withDelay(T0, withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }));

    flashOpacity.value = withDelay(
      T0,
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }),
      ),
    );
    flashScale.value = withDelay(
      T0,
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(3.2, { duration: 700, easing: Easing.out(Easing.cubic) }),
      ),
    );

    sparkProgress.value = withDelay(
      T_SPARKS,
      withSequence(
        withTiming(0, { duration: 0 }),
        withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }),
      ),
    );

    // Phase 4 — the new flame springs in.
    newOpacity.value = withDelay(T_NEW_FLAME, withTiming(1, { duration: 160 }));
    newScale.value = withDelay(
      T_NEW_FLAME,
      withSequence(
        withTiming(1.18, { duration: 320, easing: Easing.out(Easing.cubic) }),
        withTiming(0.95, { duration: 200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      ),
    );

    // Counter pop, synchronized with the roll started by the timeout below.
    counterPop.value = withDelay(
      T_COUNTER,
      withSequence(
        withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 280, easing: Easing.elastic(1.2) }),
      ),
    );

    // Phase 5 — the celebration settles.
    rise(textsY, textsOpacity, T_TEXTS);
    rise(stripY, stripOpacity, T_STRIP);
    rise(buttonY, buttonOpacity, T_BUTTON);

    const haptic = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }, T0);
    const roll = setTimeout(() => setRolling(true), T_COUNTER);

    return () => {
      clearTimeout(haptic);
      clearTimeout(roll);
    };
    // Runs once, when the motion preference is known. `timelineStartedRef`
    // makes that literal, so no later render can restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionReady]);

  const handleContinue = () => {
    // The button is visually revealed at the end of the timeline, but the
    // guard is what actually makes a double tap (or a tap racing an unmount)
    // deliver exactly one navigation.
    if (continueFiredRef.current) return;
    continueFiredRef.current = true;
    onContinueRef.current();
  };

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ translateY: labelY.value }],
  }));
  const flameBlockStyle = useAnimatedStyle(() => ({
    opacity: flameOpacity.value,
    transform: [{ translateY: flameY.value }],
  }));
  const oldFlameStyle = useAnimatedStyle(() => ({
    opacity: oldOpacity.value,
    transform: [
      { translateX: oldShake.value },
      { translateY: oldShift.value },
      { scale: oldScale.value },
    ],
  }));
  const newFlameStyle = useAnimatedStyle(() => ({
    opacity: newOpacity.value,
    transform: [{ scale: newScale.value }],
  }));
  const oldGlowStyle = useAnimatedStyle(() => ({ opacity: 1 - glowSwap.value }));
  const newGlowStyle = useAnimatedStyle(() => ({ opacity: glowSwap.value }));
  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
    transform: [{ scale: flashScale.value }],
  }));
  const numberStyle = useAnimatedStyle(() => ({
    opacity: numberOpacity.value,
    transform: [
      { translateY: numberY.value - counterPop.value * 14 },
      { scale: 1 + counterPop.value * 0.12 },
    ],
  }));
  // The caption shares the number's entrance but NOT its pop — only the
  // counter jumps when the value rolls.
  const numberCaptionStyle = useAnimatedStyle(() => ({
    opacity: numberOpacity.value,
    transform: [{ translateY: numberY.value }],
  }));
  const textsStyle = useAnimatedStyle(() => ({
    opacity: textsOpacity.value,
    transform: [{ translateY: textsY.value }],
  }));
  const stripStyle = useAnimatedStyle(() => ({
    opacity: stripOpacity.value,
    transform: [{ translateY: stripY.value }],
  }));
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonY.value }],
  }));

  const colorNow = t(`streak.color.${to.id}`);
  const supportText = next === null
    ? t('streak.evolve.max')
    : t('streak.evolve.next', {
        count: next,
        color: t(`streak.color.${streakTierIdForMilestone(next)}`),
      });

  return (
    <Animated.View
      style={[styles.root, { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 34) }, bgStyle]}
      accessibilityViewIsModal
    >
      <Animated.Text style={[styles.label, labelStyle]} accessibilityRole="header">
        {t('streak.evolve.label')}
      </Animated.Text>

      <View style={styles.center}>
        <Animated.View style={[styles.flameArea, flameBlockStyle]}>
          {/* `from === null` is the "acender o foguinho" case (0 -> 1): the
              previous state is the UNLIT flame, which has no glow at all, so
              the old glow layer is simply absent and only the new one fades
              in. Every other transition cross-fades two tier glows. */}
          {from && (
            <Animated.View style={[styles.glow, oldGlowStyle]} pointerEvents="none">
              <GlowCircle rgb={from.glowRgb} />
            </Animated.View>
          )}
          <Animated.View style={[styles.glow, newGlowStyle]} pointerEvents="none">
            <GlowCircle rgb={to.glowRgb} />
          </Animated.View>

          {!still && (
            <Animated.View style={[styles.flameLayer, flashStyle]} pointerEvents="none">
              <View
                style={{
                  width: FLASH_RING,
                  height: FLASH_RING,
                  borderRadius: FLASH_RING / 2,
                  borderWidth: 1.5,
                  borderColor: `rgba(${to.glowRgb},0.7)`,
                }}
              />
            </Animated.View>
          )}

          {!still && <Sparks progress={sparkProgress} color={to.mid} />}

          {!still && (
            <Animated.View style={[styles.flameLayer, oldFlameStyle]} pointerEvents="none">
              {/* `0` renders `StreakFlame`'s unlit outline — the same charge
                  and burst play, starting from an empty flame. */}
              <StreakFlame days={from?.min ?? 0} size={FLAME_SIZE} animated={false} glow={false} />
            </Animated.View>
          )}
          <Animated.View style={[styles.flameLayer, newFlameStyle]} pointerEvents="none">
            <StreakFlame days={milestone} size={FLAME_SIZE} animated={!still} glow={false} />
          </Animated.View>
        </Animated.View>

        <Animated.View style={numberStyle}>
          {rolling ? (
            <CountUp from={milestone - 1} to={milestone} durationMs={360} style={styles.number} />
          ) : (
            <Text style={styles.number}>{milestone - 1}</Text>
          )}
        </Animated.View>
        <Animated.Text style={[styles.daysInRow, numberCaptionStyle]}>
          {t('streak.evolve.daysInRow')}
        </Animated.Text>

        <Animated.View style={textsStyle}>
          <Text style={styles.title}>{t('streak.evolve.title', { color: colorNow })}</Text>
          <Text style={styles.support}>{supportText}</Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.strip, stripStyle]}>
        <StripColumn
          label={t('streak.evolve.before')}
          value={from ? t(`streak.colorCap.${from.id}`) : t('streak.colorCap.unlit')}
          valueColor="rgba(255,255,255,0.65)"
          flameDays={from?.min ?? 0}
        />
        <View style={styles.divider} />
        <StripColumn
          label={t('streak.evolve.now')}
          value={t(`streak.colorCap.${to.id}`)}
          valueColor="#fff"
          flameDays={milestone}
        />
        <View style={styles.divider} />
        <StripColumn
          label={t('streak.evolve.nextMilestone')}
          value={next === null
            ? t('streak.evolve.none')
            : t('streak.evolve.nextDays', { count: next })}
          valueColor="#fff"
          flameDays={null}
        />
      </Animated.View>

      <Animated.View style={buttonStyle}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
          onPress={handleContinue}
          accessibilityRole="button"
          accessibilityLabel={t('streak.evolve.continue')}
        >
          <Text style={styles.buttonText}>{t('streak.evolve.continue')}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Tier id a milestone value maps to — used for the "next colour" copy.
 * Resolved through the shared tier table so the thresholds are never
 * restated here.
 */
function streakTierIdForMilestone(milestone: number): StreakFlameTierId {
  return streakFlameTierForDays(milestone)?.id ?? 'spark';
}

function GlowCircle({ rgb }: { rgb: string }) {
  const id = `streak-evolve-glow-${rgb.replace(/,/g, '-')}`;
  return (
    <Svg width={GLOW_CIRCLE} height={GLOW_CIRCLE}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={`rgb(${rgb})`} stopOpacity={0.16} />
          <Stop offset="0.65" stopColor={`rgb(${rgb})`} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={GLOW_CIRCLE / 2} cy={GLOW_CIRCLE / 2} r={GLOW_CIRCLE / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

function Sparks({ progress, color }: { progress: { value: number }; color: string }) {
  return (
    <>
      {Array.from({ length: SPARK_COUNT }, (_, index) => (
        <Spark key={index} index={index} progress={progress} color={color} />
      ))}
    </>
  );
}

function Spark({
  index,
  progress,
  color,
}: {
  index: number;
  progress: { value: number };
  color: string;
}) {
  const angle = (index / SPARK_COUNT) * Math.PI * 2;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p === 0 ? 0 : 1 - p,
      transform: [
        { translateX: Math.cos(angle) * SPARK_RADIUS * p },
        { translateY: Math.sin(angle) * SPARK_RADIUS * p },
        { scale: 1 - p * 0.7 },
      ],
    };
  });
  return (
    <Animated.View style={[styles.flameLayer, style]} pointerEvents="none">
      <View style={{ width: SPARK_SIZE, height: SPARK_SIZE, borderRadius: SPARK_SIZE / 2, backgroundColor: color }} />
    </Animated.View>
  );
}

function StripColumn({
  label,
  value,
  valueColor,
  flameDays,
}: {
  label: string;
  value: string;
  valueColor: string;
  flameDays: number | null;
}) {
  return (
    <View style={styles.stripColumn}>
      <Text style={styles.stripLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.stripValueRow}>
        {flameDays !== null && <StreakFlame days={flameDays} size={14} animated={false} />}
        <Text style={[styles.stripValue, { color: valueColor }]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  label: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.38)',
    textAlign: 'center',
    marginTop: 62,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  // The 260pt glow and the Imortal halo are deliberately larger than this
  // box, so overflow must stay visible (explicit because Android clips more
  // eagerly than iOS).
  flameArea: { width: 180, height: 170, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  glow: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  flameLayer: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  number: {
    fontFamily: 'Anton_400Regular',
    fontSize: 72,
    // NO explicit lineHeight on purpose. The design's `line-height: 0.9` is a
    // web value; in React Native any lineHeight below the font's natural line
    // box crops the glyph, which is what truncated "200". Anton's natural
    // metrics are well above 1.2em at this size, so even a generous override
    // still clipped — every other Anton usage in the app at these sizes also
    // omits lineHeight. Vertical rhythm is controlled by the margins instead.
    color: '#fff',
    textAlign: 'center',
    marginTop: 4,
  },
  daysInRow: {
    fontFamily: 'Archivo_400Regular',
    fontSize: 14.5,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    // Anton's natural line box already leaves leading under the digits, so
    // this sits tighter than the design's raw 10pt to keep the same optical gap.
    marginTop: 2,
  },
  title: {
    fontFamily: 'Archivo_700Bold',
    fontSize: 22,
    letterSpacing: -0.3,
    color: '#fff',
    textAlign: 'center',
    marginTop: 28,
  },
  support: {
    fontFamily: 'Archivo_400Regular',
    fontSize: 14,
    lineHeight: 14 * 1.55,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    maxWidth: 290,
    alignSelf: 'center',
    marginTop: 8,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 14,
    marginBottom: 22,
  },
  stripColumn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stripLabel: {
    fontFamily: 'Archivo_400Regular',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
  stripValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  stripValue: { fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, textAlign: 'center' },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.07)' },
  button: {
    backgroundColor: '#0b70f9',
    borderRadius: 12,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontFamily: 'Archivo_600SemiBold', fontSize: 16, color: '#fff' },
});

export const STREAK_EVOLVE_TIMELINE_END_MS = T_END;
