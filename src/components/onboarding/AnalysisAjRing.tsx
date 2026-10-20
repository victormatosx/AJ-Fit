import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

import { AjBot, type AjBotMood, type AjBotPhase } from '../aj/AjBot';
import {
  AJ_BOT_ENTER,
  AJ_BOT_ENTER_TRACKS,
  AJ_BOT_HOP,
  AJ_BOT_NOD,
  AJ_BOT_REDUCED_FADE_MS,
} from '../aj/ajBotMotion';
import { useTheme } from '../../theme';
import { ANALYSIS_HOP_DELAY_MS, type AnalysisRingGeometry } from './analysisComposition';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The analysis screen's progress ring with AJ standing inside it.
 *
 * This is the one place in the funnel where the mascot is NOT the persistent
 * `AjFunnelStage` instance: the design composes him with the ring as a single
 * block that flies in together on `enter`'s arc, and the stage's AJ is an
 * absolutely-positioned overlay that cannot be a child of a laid-out box.
 * `AjFunnelStepPose` keeps `analyzing` hidden, so there is still exactly one
 * mascot on screen — and it is the same `AjBot` component driven by the same
 * phases from `ajBotMotion`, never a second animation system.
 *
 * The ring is a progress indicator, not decoration, which is why it survives
 * the app's "no halo behind the mascot" rule. The prototype's pulsing radial
 * glow behind AJ is deliberately absent (see the design notes, §5).
 */

export function AnalysisAjRing({
  geometry,
  /** 0 → 1, the real progress the screen is reporting. */
  progress,
  /** Index of the step currently being worked on — drives the nod and the gaze. */
  stepIndex,
  completed,
  mood,
  look,
  talking,
  reduceMotion,
}: {
  geometry: AnalysisRingGeometry;
  progress: number;
  stepIndex: number;
  completed: boolean;
  mood: AjBotMood;
  look: readonly [number, number];
  talking: boolean;
  reduceMotion: boolean;
}) {
  const { theme } = useTheme();
  const { size, radius, stroke, bot } = geometry;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;

  // ── The arc ──────────────────────────────────────────────────────────────
  const filled = useSharedValue(0);
  useEffect(() => {
    const target = Math.max(0, Math.min(1, progress));
    if (reduceMotion) {
      // Still shows real progress, just in steps rather than continuously.
      filled.value = target;
      return () => undefined;
    }
    // Just under the screen's own 52ms tick, so the arc glides between whole
    // percent steps without ever lagging behind the number next to it.
    filled.value = withTiming(target, { duration: 100, easing: Easing.linear });
    return () => cancelAnimation(filled);
  }, [progress, reduceMotion, filled]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - filled.value),
  }));

  // ── The block's entrance ─────────────────────────────────────────────────
  // Same `enter` arc AJ himself uses elsewhere, applied to the whole block so
  // the ring travels with him. Progress is driven LINEARLY on purpose: the
  // bezier is already baked into the tracks, per keyframe interval.
  const entered = useSharedValue(0);
  useEffect(() => {
    entered.value = withTiming(1, {
      duration: reduceMotion ? AJ_BOT_REDUCED_FADE_MS : AJ_BOT_ENTER.durationMs,
      easing: Easing.linear,
    });
    return () => cancelAnimation(entered);
  }, [reduceMotion, entered]);

  const enterStyle = useAnimatedStyle(() => {
    const p = entered.value;
    if (reduceMotion) {
      return {
        opacity: p,
        transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }, { scale: 1 }],
      };
    }
    const tracks = AJ_BOT_ENTER_TRACKS;
    return {
      opacity: interpolate(p, tracks.opacity.input, tracks.opacity.output),
      transform: [
        { translateX: interpolate(p, tracks.translateX.input, tracks.translateX.output) },
        { translateY: interpolate(p, tracks.translateY.input, tracks.translateY.output) },
        { rotate: `${interpolate(p, tracks.rotate.input, tracks.rotate.output)}deg` },
        { scale: interpolate(p, tracks.scaleX.input, tracks.scaleX.output) },
      ],
    };
  });

  // ── AJ's one-shot phases ─────────────────────────────────────────────────
  const [phase, setPhase] = useState<AjBotPhase>('idle');
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const play = useCallback(
    (next: 'hop' | 'nod') => {
      if (reduceMotion) return;
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
      // Through `idle` first, so two bounces in a row genuinely replay —
      // `AjBot` restarts a phase when the phase *changes*.
      setPhase('idle');
      const duration = next === 'hop' ? AJ_BOT_HOP.durationMs : AJ_BOT_NOD.durationMs;
      phaseTimer.current = setTimeout(() => {
        setPhase(next);
        phaseTimer.current = setTimeout(() => setPhase('idle'), duration);
      }, 0);
    },
    [reduceMotion],
  );

  useEffect(
    () => () => {
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
    },
    [],
  );

  // A nod per step actually finished — never on the first step appearing.
  const previousStep = useRef(stepIndex);
  useEffect(() => {
    if (stepIndex > previousStep.current) play('nod');
    previousStep.current = stepIndex;
  }, [stepIndex, play]);

  useEffect(() => {
    if (!completed) return () => undefined;
    const id = setTimeout(() => play('hop'), ANALYSIS_HOP_DELAY_MS);
    return () => clearTimeout(id);
  }, [completed, play]);

  return (
    <Animated.View style={[{ width: size, height: size, alignSelf: 'center' }, enterStyle]}>
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: [{ rotate: '-90deg' }] }}
      >
        <Defs>
          <SvgLinearGradient id="analysisRingGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={theme.colors.primaryEmphasis} />
            <Stop offset="100%" stopColor={theme.colors.primary} />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={stroke}
        />
        {/* Stand-in for the prototype's `drop-shadow`: a wider, softer twin
            beneath the arc, the same trick `CircularProgressRing` already
            uses — RN-SVG has no filter support on either platform. */}
        <AnimatedCircle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={theme.colors.primary}
          strokeWidth={stroke + 6}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          opacity={0.35}
          animatedProps={arcProps}
        />
        <AnimatedCircle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="url(#analysisRingGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          animatedProps={arcProps}
        />
      </Svg>

      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      >
        <AjBot
          size={bot}
          mood={mood}
          phase={phase}
          look={look}
          talking={talking}
          reduceMotion={reduceMotion}
        />
      </View>
    </Animated.View>
  );
}
