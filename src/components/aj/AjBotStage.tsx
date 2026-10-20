import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { AjBot, type AjBotMood, type AjBotPhase } from './AjBot';
import {
  AJ_STAGE_REDUCED_FADE_MS,
  AJ_TRAVEL,
  AJ_TRAVEL_FAST,
  type AjStagePose,
} from './ajBotMotion';

/**
 * A positionable container for the ONE `AjBot` a screen owns.
 *
 * `AjBot` animates in place: its arcs, loops and facial channels are all
 * authored relative to its own resting pose, and it has no concept of where on
 * the screen that pose is. The acquisition design (Questionnaire / Plan / Auth
 * / Paywall) needs the second half of that — AJ travelling from the question
 * corner down onto a tapped option's radio, up to the edge of a safety sheet,
 * into the centre for a reaction.
 *
 * This component is that second half and nothing else. It applies
 * `translate`/`scale`/`rotate` to a wrapper and renders the existing `AjBot`
 * inside it, unchanged. It is explicitly **not** a second animation system:
 *
 * - It owns no phase, no mood, no look, no blink, no mouth. Those stay
 *   `AjBot`'s, passed straight through, so a `hop` keeps playing inside the
 *   wrapper while the wrapper moves — the two transforms compose, exactly as a
 *   CSS transform on a parent composes with one on a child.
 * - It owns no schedule. Callers drive `pose` from their own choreography
 *   (`ajMomentTiming.ts`); this component only interpolates toward whatever
 *   pose it is handed.
 * - Its curves come from `ajBotMotion.ts`, the same module `AjBot` reads.
 *
 * Size is driven by `scale`, not by `AjBot`'s `size` prop: the mascot renders
 * once at `baseSize` and the wrapper scales it, so a travel that also resizes
 * (every travel in the design does) never re-renders four SVG layers per
 * frame. `transformOrigin` is the top-left corner, which makes `pose.x`/`pose.y`
 * mean "the top-left of the mascot box at its rendered size" — stable under
 * scale, and directly comparable to a measured `onLayout` rect.
 */
export function AjBotStage({
  pose,
  baseSize = 116,
  mood,
  phase,
  look,
  talking,
  reduceMotion = false,
  /**
   * `fast` for travel that has to keep up with a continuous gesture (the
   * numeric ruler's lean); `default` for every discrete stage move.
   */
  travel = 'default',
  /**
   * First pose after mount is applied without travelling — AJ was not
   * anywhere else yet, so interpolating from an arbitrary origin would read as
   * a slide in from the corner. Pass `false` to deliberately travel from the
   * previous screen's pose.
   */
  snapOnMount = true,
}: {
  pose: AjStagePose;
  baseSize?: number;
  mood?: AjBotMood;
  phase?: AjBotPhase;
  look?: readonly [number, number];
  talking?: boolean;
  reduceMotion?: boolean;
  travel?: 'default' | 'fast';
  snapOnMount?: boolean;
}) {
  const spec = travel === 'fast' ? AJ_TRAVEL_FAST : AJ_TRAVEL;

  const x = useSharedValue(pose.x);
  const y = useSharedValue(pose.y);
  const scale = useSharedValue(pose.size / baseSize);
  const rotate = useSharedValue(pose.rotate ?? 0);
  // Reduce Motion's stand-in for the travel: AJ is already at the destination
  // and only fades in, over the same 250ms the mascot's own arc collapses to.
  const fade = useSharedValue(snapOnMount && reduceMotion ? 0 : 1);
  // `useSharedValue`'s initializer runs once, so the first pose is already in
  // place; this only decides whether the SECOND pose animates.
  const settled = useSharedValue(!snapOnMount);

  const targetX = pose.x;
  const targetY = pose.y;
  const targetScale = pose.size / baseSize;
  const targetRotate = pose.rotate ?? 0;

  useEffect(() => {
    const animate = !reduceMotion && settled.value;
    settled.value = true;

    if (!animate) {
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(scale);
      cancelAnimation(rotate);
      x.value = targetX;
      y.value = targetY;
      scale.value = targetScale;
      rotate.value = targetRotate;
      if (fade.value !== 1) {
        fade.value = withTiming(1, { duration: AJ_STAGE_REDUCED_FADE_MS });
      }
      return;
    }

    // Position, scale and rotation are one motion in the design, so they share
    // a single duration and curve rather than being staggered per channel.
    const [c1, c2, c3, c4] = spec.bezier;
    const config = {
      duration: spec.durationMs,
      easing: Easing.bezier(c1, c2, c3, c4),
    };
    fade.value = 1;
    x.value = withTiming(targetX, config);
    y.value = withTiming(targetY, config);
    scale.value = withTiming(targetScale, config);
    rotate.value = withTiming(targetRotate, config);
  }, [
    targetX,
    targetY,
    targetScale,
    targetRotate,
    reduceMotion,
    spec,
    x,
    y,
    scale,
    rotate,
    fade,
    settled,
  ]);

  useEffect(
    () => () => {
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(scale);
      cancelAnimation(rotate);
      cancelAnimation(fade);
    },
    [x, y, scale, rotate, fade],
  );

  const stageStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  // A soft ambient wash behind AJ, like a dim LED — not the hard-edged halo
  // the design explicitly dropped. Scales and travels with the mascot
  // because it lives inside the same transformed wrapper.
  const glowSize = baseSize * AJ_STAGE_GLOW_SCALE;
  const glowOffset = (baseSize - glowSize) / 2;

  return (
    <Animated.View
      pointerEvents="none"
      // Decorative, like the mascot itself: every line AJ "says" is real text
      // rendered by the caller and announced as a live region there.
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={[styles.stage, { width: baseSize, height: baseSize }, stageStyle]}
    >
      <Svg
        width={glowSize}
        height={glowSize}
        style={{ position: 'absolute', left: glowOffset, top: glowOffset }}
      >
        <Defs>
          <RadialGradient id="ajStageGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={AJ_STAGE_GLOW_COLOR} stopOpacity={0.3} />
            <Stop offset="40%" stopColor={AJ_STAGE_GLOW_COLOR} stopOpacity={0.17} />
            <Stop offset="72%" stopColor={AJ_STAGE_GLOW_COLOR} stopOpacity={0.06} />
            <Stop offset="100%" stopColor={AJ_STAGE_GLOW_COLOR} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill="url(#ajStageGlow)" />
      </Svg>
      <AjBot
        size={baseSize}
        mood={mood}
        phase={phase}
        look={look}
        talking={talking}
        reduceMotion={reduceMotion}
      />
    </Animated.View>
  );
}

// Same brand blue as AjBot's own edge glow (`GLOW` in `AjBot.tsx`).
const AJ_STAGE_GLOW_COLOR = 'rgb(11,112,249)';
/**
 * How far the wash reaches past the mascot box, as a multiple of it. The
 * gradient's own falloff keeps the edge indistinct at any value here — this
 * only sets how wide the lit area reads.
 */
const AJ_STAGE_GLOW_SCALE = 3;

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    left: 0,
    // `pose.x`/`pose.y` address the mascot box's top-left, which only holds
    // under `scale` if the scale pivots there too.
    transformOrigin: '0% 0%',
  },
});
