/**
 * Pure motion math for the cold-start wordmark splash ("AJ." → "AJ Fit.").
 * No React Native/Reanimated dependency — every function here is plain,
 * deterministic arithmetic of a single timeline value `t` (milliseconds
 * since the dynamic part of the animation started), so it can be unit
 * tested directly in Node and reused, unmodified, inside `useAnimatedStyle`
 * worklets (each function is `'worklet'`-tagged for that reuse — see
 * `src/components/photoVault/PhotoVaultViewer.tsx`'s `clamp`/`dismissProgress`
 * for the same established pattern in this codebase).
 */

/** Every timing constant for the animation, in one place for tuning. */
export const WM = {
  hold: 1000,
  shift: 800,
  revealAt: 200,
  reveal: 1000,
  hop: 1000,
  dip: 48,
  over: 16,
  /** Full squash-on-impact duration — see `dotTransform`'s `land` phase. */
  land: 180,
  /**
   * How much of the impact squash `T_OUT` waits for before considering the
   * composition "settled" — deliberately less than the full `land` (180ms):
   * by 140ms into a sine-eased squash the dot already reads as at rest, and
   * holding the extra 40ms adds a perceptible pause for no visual gain.
   */
  holdAfterHop: 140,
  settle: 900,
  out: 380,
  maxWait: 8000,
  /** How long the dot rests, motionless, between wait-bounce pulses. */
  waitRestMs: 1000,
  /**
   * Duration of one wait-bounce pulse itself (up and back to rest) — matches
   * the hop's own phase B+C duration ((B-A)+(1-B) of `hop`, i.e. 400ms) so
   * the wait loop bounces at the same speed as the hop's first bounce, not
   * just the same height (`waitBounce` reuses `over` for that).
   */
  waitBounceMs: 400,
} as const;

/** Timeline point where the composed "AJ Fit." holds still, before fade-out. */
export const T_OUT =
  Math.max(WM.revealAt + WM.reveal, WM.revealAt + WM.hop + WM.holdAfterHop) + WM.settle;
/** Timeline point where the fade-out finishes and `onDone` fires. */
export const T_END = T_OUT + WM.out;

/** Visible glyph height, and the mark's bounding box inside the source PNG (normalized 0–1). */
export const GLYPH_H = 60;
export const BOX = { l: 0.138, r: 0.863, t: 0.241, b: 0.755 } as const;
/** Rendered size of the (untrimmed) source Image so the visible glyph is exactly GLYPH_H tall. */
export const LOGO_PX = GLYPH_H / (BOX.b - BOX.t);
/** Width of the cropped mark's bounding box at that render size. */
export const AJ_W = LOGO_PX * (BOX.r - BOX.l);

export function clamp01(x: number): number {
  'worklet';
  return Math.min(1, Math.max(0, x));
}

export function lerp(a: number, b: number, k: number): number {
  'worklet';
  return a + (b - a) * k;
}

export function easeOutCubic(x: number): number {
  'worklet';
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(x: number): number {
  'worklet';
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Layout measurements of the always-rendered final ("AJ Fit.") composition. */
export type WordmarkMetrics = { aL: number; fitL: number; fitW: number; dF: number };

/**
 * Derives the two starting offsets from a measurement of the FINAL layout:
 * `shift0` moves AJ+Fit left so "AJ." alone reads centered at t=0, and
 * `dotD0` is the dot's matching starting offset (negative — it starts to
 * the right of, and needs to travel left to, its final resting spot).
 */
export function deriveOffsets(m: WordmarkMetrics): { shift0: number; dotD0: number } {
  'worklet';
  const g = m.fitL - (m.aL + AJ_W);
  const gd = m.dF - (m.fitL + m.fitW);
  const shift0 = (g + m.fitW) / 2;
  const dotD0 = m.aL + shift0 + AJ_W + gd - m.dF;
  return { shift0, dotD0 };
}

/** AJ/Fit translateX: fully shifted (shift0) at t=0, settled at 0 by t=WM.shift. */
export function shiftOffset(t: number, shift0: number): number {
  'worklet';
  return shift0 * (1 - easeInOutCubic(clamp01(t / WM.shift)));
}

/** Width of the opaque wipe revealing "Fit" — 0 before WM.revealAt, fitW+10 once fully revealed. */
export function clipWidth(t: number, fitW: number): number {
  'worklet';
  const r = easeInOutCubic(clamp01((t - WM.revealAt) / WM.reveal));
  return (fitW + 10) * r;
}

/** One "Fit" letter's rise-and-fade-in, staggered 110ms per index. */
export function letterStyle(t: number, index: number): { opacity: number; translateY: number } {
  'worklet';
  const lt = easeOutCubic(clamp01((t - WM.revealAt - index * 110) / 460));
  return { opacity: lt, translateY: (1 - lt) * 16 };
}

export type DotTransform = { translateX: number; translateY: number; scaleX: number; scaleY: number };

/**
 * The dot's "U with a bounce": dips DIP below the baseline and back up
 * (phase A), overshoots OVER above the final resting spot (phase B), falls
 * back down to it (phase C), then squashes on landing. `y` positive = down.
 */
export function dotTransform(t: number, dotD0: number): DotTransform {
  'worklet';
  const u = clamp01((t - WM.revealAt) / WM.hop);
  const A = 0.6;
  const B = 0.78;
  let dx = 0;
  let dy = 0;
  let sx = 1;
  let sy = 1;
  if (u < A) {
    const a = u / A;
    dx = lerp(dotD0, 0, easeInOutCubic(a));
    dy = Math.sin(Math.PI * easeInOutCubic(a)) * WM.dip;
    const st = Math.sin(Math.PI * a) * 0.18;
    sx = 1 + st;
    sy = 1 - st * 0.6;
  } else if (u < B) {
    const b = (u - A) / (B - A);
    dy = -WM.over * Math.sin((Math.PI / 2) * b);
    sy = 1 + 0.14 * (1 - b);
    sx = 1 - 0.08 * (1 - b);
  } else {
    const c = (u - B) / (1 - B);
    dy = -WM.over * Math.cos((Math.PI / 2) * c);
  }
  const land = clamp01((t - WM.revealAt - WM.hop) / WM.land);
  if (u >= 1 && land < 1) {
    const k = Math.sin(Math.PI * land) * 0.26;
    sx = 1 + k;
    sy = 1 - k;
  }
  return { translateX: dx, translateY: dy, scaleX: sx, scaleY: sy };
}

/**
 * One wait-bounce pulse, in place, for the "still waiting on the
 * destination" loop — the same upward bounce and height as `dotTransform`'s
 * phase B/C (the hop's first bounce right after the U dip, amplitude
 * WM.over), just replayed as its own self-contained, loopable arch: u=0 and
 * u=1 are both exactly at rest, so a caller can always stop after a
 * completed cycle with no visible cut.
 */
export function waitBounce(u: number): DotTransform {
  'worklet';
  const p = clamp01(u);
  const dy = -WM.over * Math.sin(Math.PI * p);
  const st = Math.sin(Math.PI * p) * 0.12;
  return { translateX: 0, translateY: dy, scaleX: 1 + st, scaleY: 1 - st * 0.6 };
}

/** Wordmark row opacity: 1 until T_OUT, fading to 0 over WM.out ms. */
export function rowOpacity(t: number): number {
  'worklet';
  return 1 - clamp01((t - T_OUT) / WM.out);
}
