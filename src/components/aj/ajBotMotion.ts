/**
 * Motion contract for the AJ assistant mascot (`AjBot`), extracted as plain
 * data so the exact curves/durations from the design prototype are a single
 * reviewable source of truth instead of numbers inlined across
 * `useAnimatedStyle` callbacks — and so they can be unit-tested in this
 * project's Node-only suite, which cannot render React Native at all.
 *
 * Every keyframed animation below is expressed the same way a CSS
 * `@keyframes` block is: an ordered list of stops with a `progress` in
 * [0, 1] plus the transform values at that stop. `AjBot` drives ONE shared
 * value from 0 → 1 with `withTiming` and `interpolate`s each channel across
 * these stops on the UI thread, so the whole sequence is a single native
 * animation per phase (never a JS-side chain of timed callbacks).
 *
 * This module is presentation only. Nothing here reads app state, and no
 * value is derived from a domain rule.
 */

/** A single `@keyframes`-style stop. Omitted channels inherit the neutral/rest value. */
export interface AjBotKeyframe {
  /** Position in the phase, 0 = start, 1 = end. Stops must be ascending. */
  progress: number;
  translateX?: number;
  translateY?: number;
  /** Degrees. */
  rotate?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

export interface AjBotPhaseSpec {
  durationMs: number;
  /** Cubic bezier control points, matching the prototype's CSS timing function. */
  bezier: readonly [number, number, number, number];
  keyframes: readonly AjBotKeyframe[];
}

/** Resting pose — what every omitted channel falls back to. */
export const AJ_BOT_REST = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
} as const;

/**
 * Where `enter` is born, relative to AJ's resting pose: off to the right and
 * well below the bottom edge. Only the 0% stop uses it — the rest of the arc
 * is the overshoot/settle and must not scale with it.
 */
export const AJ_BOT_ENTER_START = { translateX: 170, translateY: 420 } as const;

/**
 * Entrance: AJ arcs in from the bottom-right of the screen, overshoots past
 * its resting pose and settles. 1.05s is also how long the first spoken line
 * waits (`AJ_TYPING.openDelayMs`) so the text never starts before the mascot
 * has landed.
 */
export const AJ_BOT_ENTER: AjBotPhaseSpec = {
  durationMs: 1050,
  bezier: [0.25, 0.8, 0.3, 1],
  keyframes: [
    { progress: 0, translateX: 170, translateY: 420, rotate: 40, scaleX: 0.5, scaleY: 0.5, opacity: 0 },
    { progress: 0.12, opacity: 1 },
    { progress: 0.4, translateX: 70, translateY: -60, rotate: 18, scaleX: 0.85, scaleY: 0.85, opacity: 1 },
    { progress: 0.62, translateX: -10, translateY: -34, rotate: -10, scaleX: 1.06, scaleY: 1.06, opacity: 1 },
    { progress: 0.8, translateX: 0, translateY: 6, rotate: 4, scaleX: 0.97, scaleY: 0.97, opacity: 1 },
    { progress: 1, translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 },
  ],
};

/** Exit: a small lift, then out through the bottom-left. */
export const AJ_BOT_EXIT: AjBotPhaseSpec = {
  durationMs: 620,
  bezier: [0.42, 0, 1, 1],
  keyframes: [
    { progress: 0, translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    { progress: 0.25, translateX: 0, translateY: -26, rotate: -8, scaleX: 1.05, scaleY: 1.05, opacity: 1 },
    { progress: 1, translateX: -150, translateY: 480, rotate: -40, scaleX: 0.5, scaleY: 0.5, opacity: 0 },
  ],
};

/** Played the moment an answer is tapped — a happy little jump with squash/stretch. */
export const AJ_BOT_HOP: AjBotPhaseSpec = {
  durationMs: 550,
  bezier: [0.3, 1.6, 0.5, 1],
  keyframes: [
    { progress: 0, translateY: 0, scaleX: 1, scaleY: 1 },
    { progress: 0.2, translateY: 2, scaleX: 1.08, scaleY: 0.9 },
    { progress: 0.5, translateY: -16, scaleX: 0.95, scaleY: 1.06 },
    { progress: 0.8, translateY: 1, scaleX: 1.04, scaleY: 0.96 },
    { progress: 1, translateY: 0, scaleX: 1, scaleY: 1 },
  ],
};

/**
 * Played when the spoken content changes while the moment stays open (the
 * recovery flow's "confirmar descarte" sub-step) — a nod, not a hop: the
 * overlay didn't reopen, AJ just said something new.
 */
export const AJ_BOT_NOD: AjBotPhaseSpec = {
  durationMs: 550,
  bezier: [0.42, 0, 0.58, 1],
  keyframes: [
    { progress: 0, translateY: 0, scaleX: 1, scaleY: 1 },
    { progress: 0.3, translateY: 5, scaleX: 1.05, scaleY: 0.93 },
    { progress: 0.55, translateY: -2, scaleX: 0.98, scaleY: 1.03 },
    { progress: 0.75, translateY: 3, scaleX: 1.02, scaleY: 0.97 },
    { progress: 1, translateY: 0, scaleX: 1, scaleY: 1 },
  ],
};

/** `transformOrigin` for `nod` — the pivot sits low, so the head tips forward. */
export const AJ_BOT_NOD_ORIGIN = '50% 80%' as const;

/** Idle float, looped for as long as AJ is waiting for an answer. */
export const AJ_BOT_FLOAT = {
  durationMs: 3400,
  translateY: -6,
  rotate: -2,
} as const;

/** Blink, looped. The lids shut in the last 4% of the cycle, so it reads as a flick. */
export const AJ_BOT_BLINK = {
  durationMs: 4600,
  /** Fraction of the cycle the eyes stay fully open before closing. */
  closeAtProgress: 0.96,
  closedScaleY: 0.12,
} as const;

/** Mouth, looped only while a line is being typed. */
export const AJ_BOT_TALK = {
  durationMs: 160,
  minScaleY: 0.3,
  maxScaleY: 1.1,
} as const;

/** The single expanding halo that accompanies the entrance. */
/**
 * Where AJ looks while a finger is down on the option at `index` of `count`
 * — a small horizontal lean toward that answer plus a glance downward at the
 * list. Returned in viewBox units; `AjBot` scales them to px.
 */
export function ajBotLookAt(index: number, count: number): readonly [number, number] {
  if (count <= 0) return AJ_BOT_LOOK_NEUTRAL;
  return [((index + 0.5) / count - 0.5) * 3, 2];
}

/** No option focused: AJ still looks slightly down, toward where answers appear. */
export const AJ_BOT_LOOK_NEUTRAL = [0, 1.6] as const;

/** How long the eyes take to travel to a new `look` target. */
export const AJ_BOT_LOOK_DURATION_MS = 350;

/** The mascot's SVG viewBox — every path coordinate and `look` offset is in these units. */
export const AJ_BOT_VIEW_BOX = { x: 17, y: 17, width: 66, height: 66 } as const;

export type AjBotChannel = keyof typeof AJ_BOT_REST;

export const AJ_BOT_CHANNELS: readonly AjBotChannel[] = [
  'translateX',
  'translateY',
  'rotate',
  'scaleX',
  'scaleY',
  'opacity',
];

/** `interpolate`-ready stops for one channel: a stop that omits the channel holds the previous value, exactly like CSS keyframes do. */
export interface AjBotChannelTrack {
  input: number[];
  output: number[];
}

export function ajBotChannelTrack(spec: AjBotPhaseSpec, channel: AjBotChannel): AjBotChannelTrack {
  const input: number[] = [];
  const output: number[] = [];
  let last: number = AJ_BOT_REST[channel];
  for (const frame of spec.keyframes) {
    const value = frame[channel];
    if (value !== undefined) last = value;
    input.push(frame.progress);
    output.push(last);
  }
  return { input, output };
}

export type AjBotPhaseTracks = Record<AjBotChannel, AjBotChannelTrack>;

/**
 * Cubic-bezier solve, identical to what a browser (and Reanimated's
 * `Easing.bezier`) does: invert x(t) by Newton's method, then read y(t).
 * Handles control points outside [0, 1] on the y axis, which `hop`'s
 * `cubic-bezier(.3, 1.6, .5, 1)` relies on for its overshoot.
 */
function bezierEasing(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 12; i += 1) {
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) break;
      t -= error / slope;
    }
    return sampleY(t);
  };
}

/**
 * Sub-samples per keyframe interval when the easing is baked in below. 12 is
 * well past the point where linear interpolation between samples is
 * distinguishable, and `interpolate` over ~60 stops is still trivial work.
 */
const SEGMENT_SAMPLES = 12;

/**
 * Pre-resolved once at module load, never inside a render or a worklet: the
 * resulting arrays are plain numbers, so `useAnimatedStyle` captures them
 * without re-serializing a spec object every frame.
 *
 * The phase's timing function is **baked into the stops, per keyframe
 * interval**, and the runtime then drives progress LINEARLY. That is what a
 * CSS `@keyframes` block actually does — `animation-timing-function` applies
 * to each interval, not to the animation as a whole — and getting it wrong
 * is not a subtle difference: handing `cubic-bezier(.25, .8, .3, 1)` to a
 * single `withTiming` across the whole 1050ms arc front-loads it so hard
 * that AJ reaches his resting pose in the first ~300ms and spends the
 * remaining 750ms imperceptibly settling. The entrance reads as a pop, not
 * a flight. Per-interval easing puts the apex back at its nominal ~650ms.
 */
function tracksOf(spec: AjBotPhaseSpec): AjBotPhaseTracks {
  const ease = bezierEasing(...spec.bezier);
  return AJ_BOT_CHANNELS.reduce((acc, channel) => {
    const raw = ajBotChannelTrack(spec, channel);
    const input: number[] = [];
    const output: number[] = [];
    for (let i = 1; i < raw.input.length; i += 1) {
      const fromProgress = raw.input[i - 1];
      const toProgress = raw.input[i];
      const fromValue = raw.output[i - 1];
      const toValue = raw.output[i];
      // `j = 0` only on the first interval; afterwards the previous
      // interval's endpoint already provided that stop.
      for (let j = i === 1 ? 0 : 1; j <= SEGMENT_SAMPLES; j += 1) {
        const f = j / SEGMENT_SAMPLES;
        input.push(fromProgress + (toProgress - fromProgress) * f);
        output.push(fromValue + (toValue - fromValue) * ease(f));
      }
    }
    acc[channel] = { input, output };
    return acc;
  }, {} as AjBotPhaseTracks);
}

export const AJ_BOT_ENTER_TRACKS = tracksOf(AJ_BOT_ENTER);
export const AJ_BOT_EXIT_TRACKS = tracksOf(AJ_BOT_EXIT);
export const AJ_BOT_HOP_TRACKS = tracksOf(AJ_BOT_HOP);
export const AJ_BOT_NOD_TRACKS = tracksOf(AJ_BOT_NOD);

/**
 * `enter` with its starting drop replaced, for when the prototype's 420px is
 * not enough to clear the bottom edge (a tall screen, a tablet, landscape).
 * Only the 0% stop changes; the 12% stop inherits it the same way CSS
 * keyframes do, so the arc above the resting pose is untouched.
 *
 * Never shortens the travel below the prototype's value — the point of the
 * override is to guarantee AJ is born OFF screen, and a shorter drop would
 * reintroduce exactly the "he was already visible" look this fixes.
 */
export function ajBotEnterTracks(startTranslateY: number): AjBotPhaseTracks {
  const resolved = Math.max(AJ_BOT_ENTER_START.translateY, startTranslateY);
  if (resolved === AJ_BOT_ENTER_START.translateY) return AJ_BOT_ENTER_TRACKS;
  return tracksOf({
    ...AJ_BOT_ENTER,
    keyframes: AJ_BOT_ENTER.keyframes.map((frame) =>
      frame.progress === 0 ? { ...frame, translateY: resolved } : frame),
  });
}

/** Reduce Motion replaces the whole arc with this fade, at the resting pose. */
export const AJ_BOT_REDUCED_FADE_MS = 250;

/* ────────────────────────────────────────────────────────────────────────────
 * Stage motion — AJ moving BETWEEN places on a screen.
 *
 * Everything above describes AJ animating in place: the mascot's own arcs,
 * loops and facial channels, all authored relative to its resting pose. The
 * acquisition design (Questionnaire / Plan / Auth / Paywall) adds a second,
 * orthogonal concern: AJ travelling across the layout — from the question
 * corner to a tapped option's radio, up to the edge of a safety sheet, down
 * to the centre for a reaction.
 *
 * These constants describe that travel only. They are consumed by
 * `AjBotStage`, a thin positioned container around the SAME `AjBot` — never a
 * second animation system, and never a second mascot. `AjBot`'s own phase
 * (`hop`/`nod`/`idle`) keeps playing inside the container while the container
 * moves, exactly as a CSS transform on a wrapper composes with one on a child.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One place AJ can be on screen. `size` drives scale, never a re-measure. */
export interface AjStagePose {
  /** Left edge of the mascot box, in px from the screen's left. */
  x: number;
  /** Top edge of the mascot box, in px from the screen's top. */
  y: number;
  /** Rendered size in px. `AjBotStage` turns this into `size / baseSize`. */
  size: number;
  /** Degrees. */
  rotate?: number;
}

/**
 * The default travel: AJ glides to a new pose over 850ms with a light
 * overshoot, animating position, scale and rotation as ONE motion. Used for
 * every stage move in the design — intro, question, reaction, perching on an
 * option, rising to a sheet's edge.
 *
 * The overshoot lives in the curve rather than in keyframes because the
 * endpoints are computed from layout at runtime (a radio's measured centre, a
 * sheet's measured top), so there is no authored path to overshoot along.
 */
export const AJ_TRAVEL = {
  durationMs: 850,
  bezier: [0.34, 1.32, 0.5, 1] as const,
} as const;

/**
 * Travel for continuous input, where 850ms would lag behind the finger: the
 * numeric ruler's lean tracks the dragged value, so it has to settle inside
 * one gesture rather than across several.
 */
export const AJ_TRAVEL_FAST = {
  durationMs: 200,
  bezier: [0, 0, 0.58, 1] as const,
} as const;

/**
 * Lean over the numeric ruler: AJ tips toward whichever end of the range the
 * current value sits at, and looks that way. `pct` is the value's position in
 * [0, 1] across the range, so the centre of the range is upright.
 */
export const AJ_LEAN = {
  /** Total sweep across the range, centred on 0 — ±15°. */
  rotateSpanDeg: 30,
  /** Horizontal gaze magnitude at either extreme, in viewBox units. */
  lookMagnitude: 2.4,
  /** AJ keeps glancing down at the ruler regardless of direction. */
  lookDownward: 1.8,
} as const;

/** Rotation for a ruler value at `pct` of its range. Centre upright, ends ±15°. */
export function ajLeanRotateDeg(pct: number): number {
  const clamped = Math.max(0, Math.min(1, pct));
  return (clamped - 0.5) * AJ_LEAN.rotateSpanDeg;
}

/** Where AJ looks while leaning over the ruler at `pct` of its range. */
export function ajLeanLookAt(pct: number): readonly [number, number] {
  const clamped = Math.max(0, Math.min(1, pct));
  return [(clamped - 0.5) * 2 * AJ_LEAN.lookMagnitude, AJ_LEAN.lookDownward];
}

/**
 * Reduce Motion: a stage move is not slowed down, it is removed. AJ is simply
 * at the destination, faded in over the same 250ms the mascot's own arc
 * collapses to, so the two never disagree about how long "appearing" takes.
 */
export const AJ_STAGE_REDUCED_FADE_MS = AJ_BOT_REDUCED_FADE_MS;
