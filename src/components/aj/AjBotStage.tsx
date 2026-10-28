import { useCallback, useEffect } from 'react';
import { Platform, StyleSheet, type View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useFrameCallback,
  measure,
  useSharedValue,
  withTiming,
  type SharedValue,
  type AnimatedRef,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { interpolateMascotArrival, measuredCircularProgressTip } from '../ui/circularProgressGeometry';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { AjBot, type AjBotMood, type AjBotPhase } from './AjBot';
import {
  AJ_STAGE_REDUCED_FADE_MS,
  AJ_TRAVEL,
  AJ_TRAVEL_FAST,
  type AjStagePose,
} from './ajBotMotion';

export type AjStageOrbit = {
  anchor: AnimatedRef<View>;
  size: number;
  progress: SharedValue<number>;
  onArrived: () => void;
};

const IS_WEB = Platform.OS === 'web';

function measureOrbitAnchor(ref: AnimatedRef<View>) {
  'worklet';
  if (!IS_WEB) return measure(ref);
  // Reanimated's native measure API is unavailable on web. Animated.View's
  // DOM rectangle includes the same live entrance transform there.
  const node = ref.current as unknown as {
    getBoundingClientRect?: () => { left: number; top: number; width: number };
  } | null;
  const rect = node?.getBoundingClientRect?.();
  return rect ? { pageX: rect.left, pageY: rect.top, width: rect.width } : null;
}

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
  /**
   * Whether AJ should currently be shown. A prop rather than the caller
   * conditionally rendering this component, so hiding him never unmounts the
   * shared position/scale state — see the `fade` + `settled` comment below.
   * Toggling this crossfades instead of popping, and the FIRST time it turns
   * true after having been false, he arrives already travelling toward
   * `pose` (the fade and the travel run together) rather than appearing
   * already standing there.
   */
  visible = true,
  orbit = null,
  coordinateRef,
}: {
  pose: AjStagePose;
  baseSize?: number;
  mood?: AjBotMood;
  phase?: AjBotPhase;
  look?: readonly [number, number];
  talking?: boolean;
  reduceMotion?: boolean;
  travel?: 'default' | 'fast' | 'instant';
  snapOnMount?: boolean;
  visible?: boolean;
  orbit?: AjStageOrbit | null;
  coordinateRef?: AnimatedRef<View>;
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

  // Separate from `fade`: `fade` is Reduce Motion's travel stand-in, this is
  // the show/hide crossfade. Starts wherever `visible` already says — only a
  // later CHANGE animates, same "don't animate the first value" rule as
  // `settled` above, so a screen that mounts already visible doesn't fade in
  // from nothing.
  const shown = useSharedValue(visible ? 1 : 0);
  const shownSettled = useSharedValue(false);

  useEffect(() => {
    const target = visible ? 1 : 0;
    // Only the REVEAL animates (and only once AJ has appeared at least once
    // before). Hiding stays an instant snap — nothing was ever shown fading
    // out before this change, and animating that too would risk a lingering
    // flash on steps that hide him immediately after a visible one (e.g.
    // `presentation` right after app launch).
    const shouldAnimateIn = target === 1 && shownSettled.value && !reduceMotion && travel !== 'instant';
    shownSettled.value = true;
    if (!shouldAnimateIn) {
      cancelAnimation(shown);
      shown.value = target;
      return;
    }
    // Same duration/curve as the travel below, so arriving somewhere new
    // (the common case — a step that shows AJ also gives him a fresh pose)
    // fades and travels in as one motion instead of two out-of-sync ones.
    const [c1, c2, c3, c4] = spec.bezier;
    shown.value = withTiming(target, { duration: spec.durationMs, easing: Easing.bezier(c1, c2, c3, c4) });
  }, [visible, reduceMotion, shown, shownSettled, spec, travel]);

  const targetX = pose.x;
  const targetY = pose.y;
  const targetScale = pose.size / baseSize;
  const targetRotate = pose.rotate ?? 0;

  const orbitStarted = useSharedValue(false);
  const arrival = useSharedValue(0);
  const arrivalFrom = useSharedValue({ x: pose.x, y: pose.y, size: pose.size, rotate: pose.rotate ?? 0 });
  const updateOrbitFrame = useCallback(() => {
    'worklet';
    if (!orbit || !coordinateRef) return;
    const ring = measureOrbitAnchor(orbit.anchor);
    const stage = measureOrbitAnchor(coordinateRef);
    // Native views can be missing on the first commit. Retry on the next
    // frame, without moving AJ or declaring that the arrival has completed.
    if (!ring || !stage || ring.width <= 0) return;
    if (!orbitStarted.value) {
      // A tap on the previous step may still be animating these channels.
      // Stop that travel before the orbit becomes their sole writer.
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(scale);
      cancelAnimation(rotate);
      arrivalFrom.set({ x: x.value, y: y.value, size: scale.value * baseSize, rotate: rotate.value });
      orbitStarted.set(true);
      const onArrived = orbit.onArrived;
      arrival.set(withTiming(1, {
        duration: reduceMotion ? 0 : AJ_TRAVEL.durationMs,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      }, (finished) => {
        if (finished) scheduleOnRN(onArrived);
      }));
    }
    const destination = measuredCircularProgressTip(ring, stage, orbit.progress.value, orbit.size);
    const next = interpolateMascotArrival(arrivalFrom.value, destination, arrival.value);
    x.set(next.x);
    y.set(next.y);
    scale.set(next.size / baseSize);
    rotate.set(next.rotate);
  }, [orbit, coordinateRef, orbitStarted, arrivalFrom, arrival,
    x, y, scale, rotate, baseSize, reduceMotion]);
  const frame = useFrameCallback(updateOrbitFrame, false);

  useEffect(() => {
    orbitStarted.set(false);
    arrival.set(0);
    frame.setActive(Boolean(orbit));
    return () => {
      frame.setActive(false);
      cancelAnimation(arrival);
    };
  }, [orbit, frame, orbitStarted, arrival]);

  useEffect(() => {
    if (orbit) {
      // Reduce Motion can leave its entrance fade in flight when ownership
      // changes. The orbit handles arrival and must remain fully visible.
      cancelAnimation(fade);
      fade.value = 1;
      return;
    }
    const animate = !reduceMotion && settled.value && travel !== 'instant';
    settled.value = true;

    if (!animate) {
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(scale);
      cancelAnimation(rotate);
      x.set(targetX);
      y.set(targetY);
      scale.set(targetScale);
      rotate.set(targetRotate);
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
    x.set(withTiming(targetX, config));
    y.set(withTiming(targetY, config));
    scale.set(withTiming(targetScale, config));
    rotate.set(withTiming(targetRotate, config));
  }, [
    targetX,
    targetY,
    targetScale,
    targetRotate,
    reduceMotion,
    travel,
    orbit,
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
      cancelAnimation(shown);
    },
    [x, y, scale, rotate, fade, shown],
  );

  const stageStyle = useAnimatedStyle(() => ({
    opacity: fade.value * shown.value,
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
        floatEnabled={!orbit}
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
