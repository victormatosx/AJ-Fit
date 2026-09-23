# WordmarkSplash: fix "Fit" clipping, decouple animation start from readiness — design

Date: 2026-09-23
Branch: `main`

## Problem

Two issues in the still-uncommitted `WordmarkSplash` cold-start splash
(`src/components/ui/WordmarkSplash.tsx`, `src/lib/wordmarkMotion.ts`):

1. **The "Fit" wordmark is visibly clipped** — glyphs render cut off, not
   fully visible.
2. **The animation waits for data readiness before it starts moving.**
   Today, `t.value = withTiming(...)` — the single shared value driving
   the whole shift/reveal/hop/settle/fade sequence — only starts once
   `ready || timedOut` is true (`WordmarkSplash.tsx:88-94`). Until then the
   splash sits frozen on "AJ." (t stays at 0). The user wants the
   animation to always play immediately on entry, independent of when the
   destination screen (typically Home) becomes ready. If the animation
   finishes landing before the destination is ready, the dot should
   bounce in place ("quicando") until it is, then settle into its final
   spot and the splash fades out as before.

## Goals

- "Fit" renders fully, uncut, in the existing composed "AJ Fit." layout.
- The intro animation (hold → shift → reveal → hop/land) always starts
  immediately once layout is measured and fonts are loaded — never gated
  on `ready`.
- If `ready` (or the existing `WM.maxWait` = 8000ms safety timeout) isn't
  true by the time the dot lands and settles, the dot bounces in place,
  in a small continuous loop, until one of those becomes true.
- The dot always returns to its resting position between bounce pulses,
  so the transition out of the bounce loop is never a mid-motion cut —
  it simply doesn't start another pulse once ready.

## Non-goals

- No change to what feeds `ready` into `WordmarkSplash` — `App.tsx`'s
  `destinationReady` wiring, `AppShell`'s `homeInitialRevealReady`,
  `PaywallScreen`'s `onReady`, etc. are untouched. This spec only changes
  how `WordmarkSplash` *consumes* that existing signal.
- No change to the intro animation's own timing/shape (hold, shift,
  reveal, hop, squash-on-land) — only what happens *after* it lands.
- No change to the horizontal layout math (`deriveOffsets`, `shiftOffset`,
  `clipWidth`, `dotD0`) — the clipping fix is vertical-only and doesn't
  touch any measured `x`/`width` value those functions consume.

## Part 1 — "Fit" clipping fix

Root cause: the `fit` text style
(`fontSize: 50, lineHeight: 37`) sets a line box shorter than what Anton
needs to render that size without clipping. `clip` (`top: -12, bottom:
-12`) and `fitRow` (`paddingTop: 12`) are partial compensation for the
undersized box, layered on top of the actual bug rather than fixing it.

Fix, in `WordmarkSplash.tsx`'s `styles`:

- `fit.lineHeight`: `37` → `60` (`GLYPH_H` — the same height already used
  by `ajBox`/`row`, so "Fit"'s line box matches the "AJ" logo mark's
  height instead of an arbitrary smaller value).
- `clip.top` / `clip.bottom`: `-12` → `0` (no longer needed once
  `fitWrap`'s natural height, driven by the invisible sizing `Text`,
  already matches `GLYPH_H`).
- `fitRow.paddingTop`: `12` → removed.

No change to `AJ_W`, `LOGO_PX`, `BOX`, or any function in
`wordmarkMotion.ts` — this is scoped entirely to static vertical styling
in the component's `StyleSheet`.

## Part 2 — Decoupled start + wait-bounce

### Timeline shared values

- `t` (existing): unchanged meaning for `0 → T_OUT` (hold is a separate
  `setTimeout`, not part of `t`; `t` covers shift/reveal/hop/land/settle).
  Newly reused, unchanged, for `T_OUT → T_END` (the fade) — just no
  longer started in the same call as the intro.
- `waitCycle` (new `useSharedValue(0)`): drives the wait-bounce loop.
  Stays untouched (`0`) for the entire intro; `waitBounce(0)` is
  defined to be the identity transform, so combining it additively is
  always safe regardless of phase.

### New pure function — `wordmarkMotion.ts`

```ts
/** One wait-bounce pulse: small dip-and-return, in place, for the "still
 * waiting on the destination" loop — same sine/squash language as
 * dotTransform's phase A, scaled down since this is a subtle idle
 * indicator, not the main hop. u=0 and u=1 are both exactly at rest, so
 * a caller can always stop after a completed cycle with no visible cut. */
export function waitBounce(u: number): DotTransform {
  'worklet';
  const p = clamp01(u);
  const dy = Math.sin(Math.PI * p) * WM.waitDip;
  const st = Math.sin(Math.PI * p) * 0.12;
  return { translateX: 0, translateY: dy, scaleX: 1 + st, scaleY: 1 - st * 0.6 };
}
```

New `WM` constants: `waitDip: 8` (px, vs. the intro hop's `dip: 48`),
`waitCycleMs: 640`.

### Orchestration — `WordmarkSplash.tsx`

1. The effect that currently starts `t`'s `withTiming` drops `ready`/
   `timedOut` from its start condition — becomes `measured && fontsLoaded
   && holdDone`. It animates `t` to `T_OUT` (not `T_END`) over `T_OUT` ms.
2. On that animation's completion (`finished === true`, via `runOnJS`),
   a new JS function `settleOrWait()` runs:
   - If `readyRef.current || timedOutRef.current` is already `true`:
     start the existing fade — `t.value = withTiming(T_END, { duration:
     WM.out }, (finished) => { if (finished) runOnJS(onDone)(); })`.
   - Otherwise: run one wait-bounce cycle — `waitCycle.value =
     withTiming(1, { duration: WM.waitCycleMs, easing: Easing.inOut(Easing.sin)
     }, (finished) => { if (finished) { waitCycle.value = 0; runOnJS(settleOrWait)(); } })`.
     Each cycle ends back at `waitCycle.value = 0` (dot at rest) before
     `settleOrWait` re-checks readiness — so the check only ever happens
     at a resting frame, and the loop naturally stops precisely when the
     dot is back in place, no separate "snap" transform needed.
3. `readyRef`/`timedOutRef`: plain refs mirroring the existing `ready`
   prop and `timedOut` state, updated via a `useEffect([ready])` /
   already-existing `timedOut` state — needed because `settleOrWait` is
   scheduled ahead of time from a worklet callback and must read the
   *current* value at each cycle boundary, not a stale closure.
4. `dotStyle`'s `useAnimatedStyle` combines both shared values:
   `translateY: base.translateY + bounce.translateY`, `scaleX: base.scaleX
   * bounce.scaleX`, `scaleY: base.scaleY * bounce.scaleY`, where `base =
   dotTransform(t.value, dotD0)` and `bounce = waitBounce(waitCycle.value)`.

### Existing `WM.maxWait` (8000ms) / `timedOut`

Unchanged trigger (`setTimeout(() => setTimedOut(true), WM.maxWait)`, set
at mount). Meaning shifts from "give up waiting to *start* the
animation" to "give up waiting to *end* the bounce loop" — same
constant, same 8s budget, matches the confirmed answer that the bounce
should give up and proceed after ~8s rather than wait indefinitely.

## Testing

`wordmarkMotion.test.ts` additions:
- `waitBounce(0)` and `waitBounce(1)` are both the identity transform
  (`translateY: 0, scaleX: 1, scaleY: 1`).
- `waitBounce` peaks at `u = 0.5` (`translateY` close to `WM.waitDip`,
  `scaleX > 1`, `scaleY < 1`).
- `waitBounce` is symmetric: `waitBounce(0.25)` and `waitBounce(0.75)`
  have equal `translateY`.

`WordmarkSplash`-level behavior (new or extended test file, following
this codebase's existing pattern of source-string assertions for
Reanimated worklet wiring — see `bootstrapSplashWiring.test.ts`):
- The intro `withTiming` start condition no longer includes `ready` or
  `timedOut` in its guard.
- A `waitCycle` shared value and `waitBounce` import exist and are wired
  into `dotStyle`.
- The fade-start (`withTiming(T_END, ...)`) is only reachable after a
  readiness check, not unconditionally chained after the intro.

## Verification

Pixel-level font clipping can't be confirmed from source alone — after
implementing, launch the app (iOS simulator via Expo) and visually
confirm "Fit" renders fully uncut and the composed "AJ Fit." baseline
still aligns with the logo mark, adjusting `GLYPH_H`/`lineHeight` if
needed.
