import { memo, useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  AJ_BOT_BLINK,
  AJ_BOT_ENTER,
  AJ_BOT_ENTER_START,
  AJ_BOT_ENTER_TRACKS,
  AJ_BOT_EXIT,
  AJ_BOT_EXIT_TRACKS,
  AJ_BOT_FLOAT,
  AJ_BOT_HOP,
  AJ_BOT_HOP_TRACKS,
  AJ_BOT_LOOK_DURATION_MS,
  AJ_BOT_LOOK_NEUTRAL,
  AJ_BOT_NOD,
  AJ_BOT_NOD_ORIGIN,
  AJ_BOT_NOD_TRACKS,
  AJ_BOT_REDUCED_FADE_MS,
  AJ_BOT_TALK,
  AJ_BOT_VIEW_BOX,
  ajBotEnterTracks,
  type AjBotPhaseSpec,
  type AjBotPhaseTracks,
} from './ajBotMotion';

/**
 * The AJ assistant mascot — the app's own AJ mark given a face, used by
 * `AjMoment` to present the three moments that used to be plain poster
 * modals (missed workout, abandoned session, paused cycle).
 *
 * Purely presentational: it knows nothing about the Schedule Engine, the
 * workout execution, or any decision being asked. `phase`/`mood`/`look` are
 * the only inputs, and they are driven entirely by `AjMoment`'s own
 * presentation state.
 *
 * Drawing notes:
 * - The body (dark triangle, side ticks, the "A", the "J" leg) is a static
 *   `Svg` — nothing about it animates, so it never re-renders.
 * - The face is split into its own absolutely-positioned `Svg` layers (eyes,
 *   mouth) stacked over the body. React Native SVG children can't be wrapped
 *   in an `Animated.View`, so each independently-animated part gets a layer
 *   of its own instead, with `transformOrigin` placing the pivot at the
 *   feature rather than at the box's centre.
 * - The blue glow is an iOS `shadow*` (cheap, correct) and, on Android —
 *   where `shadow*` is not supported and RN-SVG has no filter support — an
 *   extra `RadialGradient` layer behind the body. Same approach `StreakFlame`
 *   took for its own dropped `drop-shadow`.
 */

export type AjBotMood = 'idle' | 'talk' | 'think' | 'happy';
/**
 * `armed` holds frame 0 of `enter` — off screen and fully transparent —
 * without playing anything. It exists because a React commit is not the same
 * instant as "the native Modal is actually on screen": starting the arc on
 * commit burns the first few hundred milliseconds behind an unpresented
 * window, and since `enter`'s bezier front-loads the motion, all the viewer
 * ever sees is the gentle settle. `AjMoment` keeps AJ `armed` until the
 * Modal's `onShow`, then flips to `enter`.
 *
 * `enter`/`exit` are the one-shot entrance/exit arcs; `hop` is both the
 * arrival bounce and the answer-tapped bounce; `nod` marks new speech in an
 * already-open moment.
 */
export type AjBotPhase = 'armed' | 'enter' | 'idle' | 'hop' | 'nod' | 'exit';

const FACE = '#8fd0ff';
const INK = '#071242';
const PAPER = '#f3f6ff';
const TICK = '#3d8bff';
const GLOW = 'rgba(11,112,249,0.6)';

const VIEW_BOX = `${AJ_BOT_VIEW_BOX.x} ${AJ_BOT_VIEW_BOX.y} ${AJ_BOT_VIEW_BOX.width} ${AJ_BOT_VIEW_BOX.height}`;

const PHASES: Record<Exclude<AjBotPhase, 'idle' | 'armed'>, { spec: AjBotPhaseSpec; tracks: AjBotPhaseTracks }> = {
  enter: { spec: AJ_BOT_ENTER, tracks: AJ_BOT_ENTER_TRACKS },
  exit: { spec: AJ_BOT_EXIT, tracks: AJ_BOT_EXIT_TRACKS },
  hop: { spec: AJ_BOT_HOP, tracks: AJ_BOT_HOP_TRACKS },
  nod: { spec: AJ_BOT_NOD, tracks: AJ_BOT_NOD_TRACKS },
};

export function AjBot({
  size = 104,
  mood = 'idle',
  phase = 'idle',
  look = AJ_BOT_LOOK_NEUTRAL,
  /** True only while a line is actively being typed — drives the mouth loop. */
  talking = false,
  /**
   * How far below the resting pose `enter` starts. Pass the measured
   * distance to the bottom of the window when the prototype's 420px might
   * not clear it (tablet, landscape); it is never allowed to shorten the
   * travel. Omit for the prototype's value.
   */
  enterStartTranslateY = AJ_BOT_ENTER_START.translateY,
  /** OS "Reduce Motion": the arc becomes a 250ms fade at the resting pose; no hop, no float, no blink. */
  reduceMotion = false,
  floatEnabled = true,
}: {
  size?: number;
  mood?: AjBotMood;
  phase?: AjBotPhase;
  look?: readonly [number, number];
  talking?: boolean;
  enterStartTranslateY?: number;
  reduceMotion?: boolean;
  floatEnabled?: boolean;
}) {
  // One shared value per concern, all driven natively. `phaseProgress` runs
  // the current keyframed phase 0 -> 1; the loops below are independent so a
  // hop never interrupts the blink and vice-versa.
  const phaseProgress = useSharedValue(phase === 'enter' || phase === 'armed' ? 0 : 1);
  /** Reduce Motion's stand-in for the arc — multiplies the track's own opacity. */
  const fade = useSharedValue(reduceMotion && (phase === 'armed' || phase === 'enter') ? 0 : 1);
  const float = useSharedValue(0);
  const blink = useSharedValue(1);
  const mouth = useSharedValue(1);
  const lookX = useSharedValue(look[0]);
  const lookY = useSharedValue(look[1]);

  // `armed` poses on `enter`'s own frame 0, so flipping to `enter` continues
  // from exactly where AJ already was instead of jumping.
  const enterTracks = ajBotEnterTracks(enterStartTranslateY);
  const activePhase = phase === 'idle'
    ? null
    : phase === 'armed'
      ? { spec: AJ_BOT_ENTER, tracks: enterTracks }
      : phase === 'enter'
        ? { spec: AJ_BOT_ENTER, tracks: enterTracks }
        : PHASES[phase];
  const phaseKey = phase;

  useEffect(() => {
    if (reduceMotion) {
      // The arc, the hop and the nod all collapse to "already there"; only
      // the entrance fade and `exit`'s own opacity channel survive.
      cancelAnimation(phaseProgress);
      phaseProgress.value = phaseKey === 'exit' ? withTiming(1, { duration: AJ_BOT_EXIT.durationMs }) : 1;
      cancelAnimation(fade);
      if (phaseKey === 'armed') fade.value = 0;
      else if (phaseKey === 'enter') fade.value = withTiming(1, { duration: AJ_BOT_REDUCED_FADE_MS });
      else fade.value = 1;
      return () => {
        cancelAnimation(phaseProgress);
        cancelAnimation(fade);
      };
    }
    fade.value = 1;
    if (!activePhase) {
      phaseProgress.value = 1;
      return () => cancelAnimation(phaseProgress);
    }
    // Held, not played: `armed` is the pre-roll pose while the native Modal
    // is still being presented.
    if (phaseKey === 'armed') {
      cancelAnimation(phaseProgress);
      phaseProgress.value = 0;
      return () => cancelAnimation(phaseProgress);
    }
    phaseProgress.value = 0;
    // LINEAR on purpose: the phase's cubic-bezier is already baked into the
    // interpolation stops, per keyframe interval, exactly as CSS applies it
    // (see `tracksOf`). Easing here as well would apply it twice and squash
    // the whole arc into its first third.
    phaseProgress.value = withTiming(1, {
      duration: activePhase.spec.durationMs,
      easing: Easing.linear,
    });
    return () => cancelAnimation(phaseProgress);
    // `activePhase` is derived from `phaseKey`; depending on the object
    // identity would restart the animation on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKey, reduceMotion, phaseProgress, fade]);

  // Idle float — only while genuinely idle, so it never fights the
  // entrance/exit arcs or a hop.
  const floating = phase === 'idle' && !reduceMotion && floatEnabled;
  useEffect(() => {
    if (!floating) {
      cancelAnimation(float);
      float.value = floatEnabled ? withTiming(0, { duration: 200 }) : 0;
      return () => cancelAnimation(float);
    }
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: AJ_BOT_FLOAT.durationMs / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: AJ_BOT_FLOAT.durationMs / 2, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    return () => cancelAnimation(float);
  }, [floating, float, floatEnabled]);

  // No blinking while AJ is still flying in — he is already in motion, and a
  // lid flick mid-arc reads as a glitch.
  const blinking = !reduceMotion && phase !== 'armed' && phase !== 'enter';
  useEffect(() => {
    if (!blinking) {
      cancelAnimation(blink);
      blink.value = 1;
      return () => cancelAnimation(blink);
    }
    const closedMs = Math.round(AJ_BOT_BLINK.durationMs * (1 - AJ_BOT_BLINK.closeAtProgress));
    blink.value = withRepeat(
      withSequence(
        withTiming(1, { duration: AJ_BOT_BLINK.durationMs - closedMs * 2 }),
        withTiming(AJ_BOT_BLINK.closedScaleY, { duration: closedMs }),
        withTiming(1, { duration: closedMs }),
      ),
      -1,
    );
    return () => cancelAnimation(blink);
  }, [blinking, blink]);

  const mouthMoving = talking && !reduceMotion;
  useEffect(() => {
    if (!mouthMoving) {
      cancelAnimation(mouth);
      mouth.value = withTiming(1, { duration: AJ_BOT_TALK.durationMs });
      return () => cancelAnimation(mouth);
    }
    mouth.value = withRepeat(
      withSequence(
        withTiming(AJ_BOT_TALK.minScaleY, { duration: AJ_BOT_TALK.durationMs }),
        withTiming(AJ_BOT_TALK.maxScaleY, { duration: AJ_BOT_TALK.durationMs }),
      ),
      -1,
    );
    return () => cancelAnimation(mouth);
  }, [mouthMoving, mouth]);

  // viewBox units -> px, so a `look` offset lands at the same visual place at
  // any `size`.
  const unit = size / AJ_BOT_VIEW_BOX.width;
  useEffect(() => {
    const duration = reduceMotion ? 0 : AJ_BOT_LOOK_DURATION_MS;
    lookX.value = withTiming(look[0], { duration });
    lookY.value = withTiming(look[1], { duration });
  }, [look, reduceMotion, lookX, lookY]);

  const tracks = activePhase?.tracks ?? null;
  const bodyStyle = useAnimatedStyle(() => {
    const p = phaseProgress.value;
    const base = tracks
      ? {
          translateX: interpolate(p, tracks.translateX.input, tracks.translateX.output),
          translateY: interpolate(p, tracks.translateY.input, tracks.translateY.output),
          rotate: interpolate(p, tracks.rotate.input, tracks.rotate.output),
          scaleX: interpolate(p, tracks.scaleX.input, tracks.scaleX.output),
          scaleY: interpolate(p, tracks.scaleY.input, tracks.scaleY.output),
          opacity: interpolate(p, tracks.opacity.input, tracks.opacity.output),
        }
      : { translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 };
    return {
      opacity: base.opacity * fade.value,
      transform: [
        { translateX: base.translateX },
        { translateY: base.translateY + float.value * AJ_BOT_FLOAT.translateY },
        { rotate: `${base.rotate + float.value * AJ_BOT_FLOAT.rotate}deg` },
        { scaleX: base.scaleX },
        { scaleY: base.scaleY },
      ],
    };
  });

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lookX.value * unit }, { translateY: lookY.value * unit }],
  }));
  const eyesStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));
  const mouthStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: mouth.value }] }));

  return (
    <Animated.View
      // Decorative: everything AJ "says" is real text next to it, already
      // announced as a live region by `AjMoment`.
      importantForAccessibility="no"
      accessibilityElementsHidden
      pointerEvents="none"
      style={[
        { width: size, height: size },
        phase === 'nod' ? { transformOrigin: AJ_BOT_NOD_ORIGIN } : null,
        Platform.OS === 'ios'
          ? {
              shadowColor: GLOW,
              shadowOpacity: 1,
              shadowRadius: size * 0.1,
              shadowOffset: { width: 0, height: 0 },
            }
          : null,
        bodyStyle,
      ]}
    >
      {Platform.OS === 'android' && (
        <Svg width={size} height={size} viewBox={VIEW_BOX} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="ajGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0.45" stopColor={GLOW} stopOpacity={0.55} />
              <Stop offset="1" stopColor={GLOW} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={50} cy={50} r={33} fill="url(#ajGlow)" />
        </Svg>
      )}

      <AjBotBody size={size} />

      <Animated.View style={[StyleSheet.absoluteFill, faceStyle]} pointerEvents="none">
        <Animated.View
          style={[StyleSheet.absoluteFill, { transformOrigin: '50% 55%' }, eyesStyle]}
          pointerEvents="none"
        >
          <AjBotEyes size={size} mood={mood} />
        </Animated.View>
        <Animated.View
          style={[StyleSheet.absoluteFill, { transformOrigin: '50% 60%' }, mouthStyle]}
          pointerEvents="none"
        >
          <AjBotMouth size={size} mood={mood} />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/** Static body art — memoized so none of the animation loops above ever re-render it. */
const AjBotBody = memo(function AjBotBody({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} style={StyleSheet.absoluteFill}>
      <Path d="M50 35 L29.5 64 L70.5 64 Z" fill={INK} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
      <Path
        d="M35.4 40.9 L29.8 49.1 M64.6 40.9 L70.2 49.1"
        stroke={TICK}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <Path
        d="M41 68 L76 68 L50 30 L24 68 L35.5 68"
        fill="none"
        stroke={PAPER}
        strokeWidth={7.6}
        strokeLinejoin="round"
      />
      <Path
        d="M40.8 71.8 L40.8 61 Q40.8 59.8 41.8 60.5 L47.8 64.8 L47.8 71.8 Z"
        fill={PAPER}
        stroke={PAPER}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </Svg>
  );
});

const AjBotEyes = memo(function AjBotEyes({ size, mood }: { size: number; mood: AjBotMood }) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} style={StyleSheet.absoluteFill}>
      {mood === 'think' ? (
        <G fill={FACE}>
          <Circle cx={43.6} cy={51.4} r={2.2} />
          <Circle cx={56.4} cy={51.4} r={2.2} />
        </G>
      ) : (
        <G fill="none" stroke={FACE} strokeWidth={mood === 'happy' ? 2.6 : 2.3} strokeLinecap="round">
          <Path d="M39.6 53.4 A3.7 3.7 0 0 1 47 53.4" />
          <Path d="M53 53.4 A3.7 3.7 0 0 1 60.4 53.4" />
        </G>
      )}
    </Svg>
  );
});

const AjBotMouth = memo(function AjBotMouth({ size, mood }: { size: number; mood: AjBotMood }) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} style={StyleSheet.absoluteFill}>
      {mood === 'talk' ? (
        <Ellipse cx={50} cy={57.8} rx={2.4} ry={2} fill={FACE} />
      ) : mood === 'think' ? (
        <Path d="M47.8 57.8 L52.2 57.8" stroke={FACE} strokeWidth={2} strokeLinecap="round" />
      ) : mood === 'happy' ? (
        <Path d="M45.8 56.4 Q50 61.2 54.2 56.4" fill="none" stroke={FACE} strokeWidth={2.2} strokeLinecap="round" />
      ) : (
        <Path d="M46.8 56.8 Q50 59.8 53.2 56.8" fill="none" stroke={FACE} strokeWidth={2} strokeLinecap="round" />
      )}
    </Svg>
  );
});
