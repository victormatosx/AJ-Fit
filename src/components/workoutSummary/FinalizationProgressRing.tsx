import { memo, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import { MonoLabel } from '../ui/Display';
import { FINALIZATION_VISUAL_PROGRESS_CONFIG } from '../../workoutSummary/finalizationVisualProgress';
import {
  decideFinalizationRingAction,
  INITIAL_FINALIZATION_RING_TRANSITION_STATE,
  type FinalizationRingPhase,
} from './finalizationRingAnimation';

export type { FinalizationRingPhase } from './finalizationRingAnimation';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const EASING = Easing.out(Easing.cubic);

// Called from inside the `useAnimatedReaction`/`useAnimatedProps` worklets
// below, which run on Reanimated's UI runtime — the 'worklet' directive is
// what lets the babel plugin bundle this function's own closure into theirs,
// instead of leaving it a plain JS-thread-only "remote function" (calling one
// of those synchronously from the UI runtime is exactly what crashed:
// "[Worklets] Tried to synchronously call a Remote Function"). Same
// established pattern as `src/lib/wordmarkMotion.ts`'s `clamp01`/`lerp`/etc.
function clampPercent(value: number): number {
  'worklet';
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * Finalization-only progress ring. Unlike `CircularProgressRing` (plain,
 * per-render geometry off a numeric prop — exactly right for
 * `AnalyzingScreen`'s own fine-grained tick ramp), this animates its arc
 * entirely on Reanimated's UI thread: the parent only ever tells it which
 * *phase* it's in, never a stream of intermediate percentages, so there is
 * no React re-render tied to the arc's motion at all.
 *
 * The percentage DIGITS used to live on a native `TextInput`, animated via
 * `useAnimatedProps`'s `text` prop (the common "animated counter" trick).
 * That turned out to be unreliable in practice — intermittent partial
 * resyncs ("100" with the "%" momentarily gone) and, worse, the native
 * text-input view manager occasionally resyncing the displayed text back to
 * `defaultValue` independent of this component's own React lifecycle. There
 * is now exactly one visual source for "number + %": a plain `<Text>`
 * driven by `displayPercent`, a single piece of React state kept in sync
 * with the shared value via `useAnimatedReaction` (fires only when the
 * *rounded* value actually changes, so this is not a re-render-per-frame
 * ticker — the arc above never depends on this state at all).
 *
 * All of the "can this ever show 0% again" guarantees live in the pure,
 * unit-tested `decideFinalizationRingAction` (see `finalizationRingAnimation.ts`):
 * once an attempt reaches `'completing'`, the state latches and nothing —
 * not a stray re-render, not a remount, not an upstream prop glitch — can
 * move the shared value (or `displayPercent`) backward again within that
 * attempt. Mounting (or remounting) already in `'completing'` snaps
 * straight to 100 instead of replaying the ramp from 0, which is exactly
 * what used to flash a visible "0%".
 */
export const FinalizationProgressRing = memo(function FinalizationProgressRing({
  phase,
  label,
  accessibilityLabel,
  size = 188,
}: {
  phase: FinalizationRingPhase;
  label: string;
  accessibilityLabel: string;
  size?: number;
}) {
  const { theme } = useTheme();
  const progress = useSharedValue(phase === 'completing' ? 100 : 0);
  const transitionStateRef = useRef(INITIAL_FINALIZATION_RING_TRANSITION_STATE);
  const [displayPercent, setDisplayPercent] = useState(() => (phase === 'completing' ? 100 : 0));

  useEffect(() => {
    const { action, nextState } = decideFinalizationRingAction(transitionStateRef.current, phase);
    transitionStateRef.current = nextState;
    switch (action.type) {
      case 'RESET_AND_RAMP':
        progress.value = 0;
        setDisplayPercent(0);
        progress.value = withTiming(FINALIZATION_VISUAL_PROGRESS_CONFIG.ceilingPercent, {
          duration: FINALIZATION_VISUAL_PROGRESS_CONFIG.rampDurationMs,
          easing: EASING,
        });
        break;
      case 'ANIMATE_TO_COMPLETE':
        progress.value = withTiming(100, {
          duration: FINALIZATION_VISUAL_PROGRESS_CONFIG.completionRampMs,
          easing: EASING,
        });
        break;
      case 'SNAP_TO_COMPLETE':
        progress.value = 100;
        setDisplayPercent(100);
        break;
      case 'FREEZE':
        cancelAnimation(progress);
        break;
      case 'NONE':
      default:
        break;
    }
  }, [phase, progress]);

  // The single JS-side mirror of `progress.value` — updates only when the
  // rounded percentage actually changes (not every animation frame), and
  // only ever drives this component's own `<Text>`, never the arc.
  useAnimatedReaction(
    () => clampPercent(progress.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setDisplayPercent)(current);
    },
    [],
  );

  const stroke = size * (11 / 224);
  const radius = (size - stroke * 2.9) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const glowInset = size * (14 / 224);
  const glowSize = size - glowInset * 2;

  const animatedCircleProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - clampPercent(progress.value) / 100),
  }));
  const numberSize = size * (48 / 224);

  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: glowInset, left: glowInset, right: glowInset, bottom: glowInset, opacity: 0.84 }}
      >
        <Svg width={glowSize} height={glowSize}>
          <Defs>
            <RadialGradient id="finalizationRingGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={theme.colors.primaryEmphasis} stopOpacity="0.85" />
              <Stop offset="35%" stopColor={theme.colors.primary} stopOpacity="0.55" />
              <Stop offset="75%" stopColor={theme.colors.primary} stopOpacity="0.18" />
              <Stop offset="100%" stopColor={theme.colors.primary} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={glowSize} height={glowSize} fill="url(#finalizationRingGlow)" />
        </Svg>
      </View>

      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <SvgLinearGradient id="finalizationRingGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={theme.colors.primaryEmphasis} />
            <Stop offset="100%" stopColor={theme.colors.primary} />
          </SvgLinearGradient>
        </Defs>
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={theme.colors.border} strokeWidth={stroke} />
        {/* Fake drop-shadow: a wider low-opacity twin sits under the real
            arc — matches `CircularProgressRing`'s treatment; RN-SVG has no
            filter="drop-shadow" support. Shares the same animated props, so
            both arcs always move in lockstep with zero extra driving logic. */}
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={theme.colors.primary}
          strokeWidth={stroke + size * (8 / 224)}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          opacity={0.35}
          animatedProps={animatedCircleProps}
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#finalizationRingGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          animatedProps={animatedCircleProps}
        />
      </Svg>

      <View
        pointerEvents="none"
        accessible
        accessibilityLabel={accessibilityLabel}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.display,
            fontSize: numberSize,
            lineHeight: displayLineHeight(numberSize),
            color: theme.colors.textPrimary,
            textAlign: 'center',
          }}
        >
          {displayPercent}%
        </Text>
        <MonoLabel style={{ textAlign: 'center', marginTop: 4 }}>{label.toUpperCase()}</MonoLabel>
      </View>
    </View>
  );
});
