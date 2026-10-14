import { useCallback, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  Easing,
  runOnJS,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/** Burst (waves + particles) phase length, ms — see `EvoRingCelebration.tsx`. */
const BURST_DURATION_MS = 1400;
/** Delay from `start()` to the burst/check phase, ms. */
const BURST_DELAY_MS = 1700;
/** Total celebration length, ms — matches the product spec's timeline. */
const TOTAL_DURATION_MS = 3100;
/** `burst`'s idle/pre-phase sentinel — see the `burst` declaration below. */
const BURST_NOT_STARTED = -1;

/**
 * Drives the Home cycle ring's "evolution reached" celebration — purely
 * visual, local to this component tree. Never touches Progression Engine
 * V2, Prescription Evolution Engine, or any evolution service: the caller
 * (`AppShell`) only invokes `start()` AFTER `activatePendingEvolution` has
 * already resolved successfully (see `AppShell.tsx`'s
 * `triggerEvolutionCelebrationDebug`/ring-celebration wiring), and `start()`
 * never feeds back into any of that real state.
 *
 * `onFinished` fires once, at the end of the full sequence (or immediately,
 * synchronously-ish via `runOnJS`, when Reduce Motion is on — the ring jumps
 * straight to its 100% + checkmark end state with no waves/particles).
 */
export function useEvoRingCelebration(onFinished: () => void) {
  const reduceMotion = useReducedMotion();
  const [celebrating, setCelebrating] = useState(false);

  // 0..1 ring fill (`EvoRing`'s own `progress` is 0..100; this hook works in
  // 0..1 since that's what `strokeDashoffset` math wants).
  const progress = useSharedValue(0);
  // 0..1 glow intensity behind the ring.
  const glow = useSharedValue(0);
  // 0..1 — the center number/"DO CICLO" caption's opacity (fades out just
  // before the checkmark pops in).
  const numberOpacity = useSharedValue(1);
  // 0..1(+overshoot) — the checkmark badge's pop-in progress.
  const check = useSharedValue(0);
  // 0..BURST_DURATION_MS — a single shared "elapsed ms since burst phase
  // started" clock that every wave/particle derives its own staggered
  // sub-timeline from (via `interpolate`), so no per-item shared values are
  // needed (`EvoRingCelebration.tsx`'s `Wave`/`Particle`). Idle/pre-burst
  // value is `BURST_NOT_STARTED` (negative), NEVER `0` — every wave/particle
  // has its own `delayMs >= 0`, and `interpolate(...,  Extrapolation.CLAMP)`
  // can't tell "before this item's window" apart from "exactly at t=0 of it"
  // when the clock sits AT the window's lower bound — only a value strictly
  // below every possible `delayMs` does (see `EvoRingCelebration.tsx`'s
  // `started` gate; this was the "stray dot above the %" bug).
  const burst = useSharedValue(BURST_NOT_STARTED);
  // Two zero-duration, time-gated values whose sole purpose is hopping back
  // to the JS thread at the right moment via their `withTiming` completion
  // callback + `runOnJS` — never a chained `setTimeout`.
  const hapticGate = useSharedValue(0);
  const doneGate = useSharedValue(0);

  const finish = useCallback(() => {
    setCelebrating(false);
    onFinished();
  }, [onFinished]);

  const triggerSuccessHaptic = useCallback(() => {
    // Haptics requires a native module that a JS-only install doesn't link
    // in — exactly like `EvolutionCelebration.tsx`'s own haptics calls, this
    // must never throw/reject into an unhandled promise over a missing
    // native dependency; haptic feedback is a nice-to-have, never load-bearing.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, []);

  const start = useCallback((fromPercent: number) => {
    setCelebrating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    progress.value = Math.max(0, Math.min(100, fromPercent)) / 100;
    numberOpacity.value = 1;
    check.value = 0;
    burst.value = BURST_NOT_STARTED;
    glow.value = 0;
    hapticGate.value = 0;
    doneGate.value = 0;

    if (reduceMotion) {
      progress.value = 1;
      glow.value = 1;
      numberOpacity.value = 0;
      check.value = 1;
      burst.value = BURST_DURATION_MS;
      runOnJS(finish)();
      return;
    }

    glow.value = withTiming(1, { duration: 600 });
    progress.value = withTiming(1, { duration: 1300, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    numberOpacity.value = withDelay(1550, withTiming(0, { duration: 150 }));
    check.value = withDelay(BURST_DELAY_MS, withSpring(1, { damping: 9, stiffness: 180 }));
    burst.value = withDelay(
      BURST_DELAY_MS,
      withTiming(BURST_DURATION_MS, { duration: BURST_DURATION_MS, easing: Easing.linear }),
    );
    // Success haptic right as the burst/check phase begins.
    hapticGate.value = withDelay(BURST_DELAY_MS, withTiming(1, { duration: 0 }, (finished) => {
      if (finished) runOnJS(triggerSuccessHaptic)();
    }));
    // End of the full sequence — hands control back to the caller (which
    // proceeds to whatever already-existing next step it owns).
    doneGate.value = withDelay(TOTAL_DURATION_MS, withTiming(1, { duration: 0 }, (finished) => {
      if (finished) runOnJS(finish)();
    }));
  }, [reduceMotion, finish, triggerSuccessHaptic, progress, glow, numberOpacity, check, burst, hapticGate, doneGate]);

  return { celebrating, start, progress, glow, numberOpacity, check, burst };
}
