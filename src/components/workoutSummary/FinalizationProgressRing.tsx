import { memo, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
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

// 'worklet'-tagged because the arc's `useAnimatedProps` worklet below calls
// it on Reanimated's UI runtime — without the directive the babel plugin
// leaves it a plain JS-thread-only "remote function", and calling one of
// those synchronously from the UI runtime is exactly what crashed before:
// "[Worklets] Tried to synchronously call a Remote Function". Same
// established pattern as `src/lib/wordmarkMotion.ts`'s `clamp01`/`lerp`/etc.
// Being 'worklet'-tagged doesn't stop this from also being called as an
// ordinary function from plain JS (the polling loop below does exactly
// that) — the directive only adds a UI-runtime-safe version, it never
// removes the normal one.
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
 * is now exactly one visual source for "number + %": a plain `<Text>` driven
 * by `displayPercent`, a single piece of React state.
 *
 * A `useAnimatedReaction` + `runOnJS(setDisplayPercent)` pass (one React
 * state update per changed integer) replaced the TextInput, but on-device it
 * visibly skipped most intermediate values (0→30→40→99 instead of a steady
 * climb) — `runOnJS` calls queued from the UI runtime can arrive at the JS
 * thread in bursts, and React's automatic batching only ever commits the
 * *last* state update in a burst, silently dropping the rest. This instead
 * polls `progress.value` directly from the JS thread with
 * `requestAnimationFrame` — reading a shared value's `.value` (not calling a
 * function on it) is an explicitly supported cross-thread operation, no
 * worklet/`runOnJS` involved at all — once per real display frame, for as
 * long as there's still ground to cover. Every frame re-samples the
 * *current* value rather than replaying a queued one, so there is no burst
 * to drop in the first place: whatever the arc has visually reached is
 * exactly what gets read, every time. The arc itself never depends on this
 * state — it stays entirely Reanimated/UI-thread-driven via
 * `useAnimatedProps` below, untouched.
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
  // Plain JS-thread `requestAnimationFrame` id — not a worklet, not Reanimated
  // state; just a handle for the polling loop started/stopped below.
  const pollFrameRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollFrameRef.current !== null) {
      cancelAnimationFrame(pollFrameRef.current);
      pollFrameRef.current = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    const tick = () => {
      // Reading `.value` here (JS thread, outside React's render phase) is
      // the explicitly supported way to access a shared value from JS —
      // this is a plain property read, never a worklet function call, so it
      // carries none of the "Remote Function" cross-thread-call risk.
      const rounded = clampPercent(progress.value);
      setDisplayPercent((current) => (current === rounded ? current : rounded));
      if (rounded >= 100) {
        pollFrameRef.current = null;
        return;
      }
      pollFrameRef.current = requestAnimationFrame(tick);
    };
    pollFrameRef.current = requestAnimationFrame(tick);
  };

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
        startPolling();
        break;
      case 'ANIMATE_TO_COMPLETE':
        progress.value = withTiming(100, {
          duration: FINALIZATION_VISUAL_PROGRESS_CONFIG.completionRampMs,
          easing: EASING,
        });
        startPolling();
        break;
      case 'SNAP_TO_COMPLETE':
        stopPolling();
        progress.value = 100;
        setDisplayPercent(100);
        break;
      case 'FREEZE':
        stopPolling();
        cancelAnimation(progress);
        break;
      case 'NONE':
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `startPolling`/`stopPolling` close over `progress`, already a dep; redeclaring them every render is intentional, not stale
  }, [phase, progress]);

  // Belt-and-suspenders cleanup: cancel any in-flight polling frame if this
  // component unmounts mid-ramp (normally already stopped by then).
  useEffect(() => stopPolling, []);

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
