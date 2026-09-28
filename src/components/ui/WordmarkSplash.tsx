import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as NativeSplashScreen from 'expo-splash-screen';

import {
  AJ_W,
  BOX,
  GLYPH_H,
  LOGO_PX,
  T_END,
  T_OUT,
  WM,
  clipWidth,
  deriveOffsets,
  dotTransform,
  letterStyle,
  rowOpacity,
  shiftOffset,
  waitBounce,
  type WordmarkMetrics,
} from '../../lib/wordmarkMotion';

const LOGO = require('../../../assets/aj-logo-branco.png');
const BG = '#020010';
const LETTERS = ['F', 'i', 't'];

type Props = {
  /** True once the destination behind the splash reached a terminal state (success, empty, or a handled error) — never mere network success. */
  ready: boolean;
  /** The same `useFonts` result the rest of the app gates on — Anton (used by "Fit") is part of that same call, not a separate load. */
  fontsLoaded: boolean;
  /** Fires once, after the fade-out completes. */
  onDone: () => void;
};

/**
 * Cold-start wordmark splash: "AJ." holds, then wipes/slides into "AJ Fit."
 * with the dot hopping over the new word, holds composed, then fades — see
 * the animation spec this implements for the exact per-phase timing. Single
 * `t` shared value (ms elapsed since the dynamic part started) drives every
 * derived style; the math itself lives in `src/lib/wordmarkMotion.ts` so it
 * stays unit-testable outside Reanimated's UI-thread worklets.
 *
 * Mounted once, as an absolute overlay, at the app's root — the real
 * destination screen underneath mounts and loads immediately, in parallel;
 * this component never gates that, only what's visible on top of it.
 */
export function WordmarkSplash({ ready, fontsLoaded, onDone }: Props) {
  const t = useSharedValue(0);
  // Additive, on top of the landed dotTransform — drives the "still
  // waiting on the destination" pulse (see settleOrWait below). Left at 0
  // (waitBounce(0) is the identity transform) for the whole intro, so it's
  // always safe to combine into dotStyle regardless of phase.
  const waitCycle = useSharedValue(0);
  const m = useSharedValue<WordmarkMetrics>({ aL: 0, fitL: 0, fitW: 0, dF: 0 });
  const parts = useRef<Partial<WordmarkMetrics>>({});
  const [measured, setMeasured] = useState(false);
  const [holdDone, setHoldDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(false);
  // The rest-between-pulses delay (see settleOrWait) is a plain JS timer,
  // not a worklet animation — cleared on unmount like holdTimer/maxWaitTimer
  // below, so a pending pulse can never fire after the splash is gone.
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (restTimer.current) clearTimeout(restTimer.current);
  }, []);
  // Mirrors of `ready`/`timedOut` readable from settleOrWait, which is
  // scheduled ahead of time via a worklet completion callback — a stale
  // closure over the render-time `ready`/`timedOut` values would never see
  // a later flip to true.
  const readyRef = useRef(ready);
  const timedOutRef = useRef(timedOut);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  useEffect(() => {
    timedOutRef.current = timedOut;
  }, [timedOut]);

  useEffect(() => {
    const holdTimer = setTimeout(() => setHoldDone(true), WM.hold);
    const maxWaitTimer = setTimeout(() => setTimedOut(true), WM.maxWait);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(maxWaitTimer);
    };
  }, []);

  const commit = useCallback(() => {
    const p = parts.current;
    if (p.aL == null || p.fitL == null || p.fitW == null || p.dF == null) return;
    m.value = p as WordmarkMetrics;
    setMeasured(true);
  }, [m]);

  useEffect(() => {
    // The first JS frame is only correct once the "AJ Fit." layout has been
    // measured (so "AJ." renders in its real, computed centered position)
    // AND Anton has loaded (so "Fit" isn't briefly a fallback font). Hiding
    // the native splash before either is ready would expose a wrong frame
    // underneath it — the exact flicker this ordering exists to avoid.
    if (measured && fontsLoaded) NativeSplashScreen.hideAsync().catch(() => {});
  }, [measured, fontsLoaded]);

  // Once the intro (hold → shift → reveal → hop/land → settle) finishes
  // landing at T_OUT, either fade out immediately (destination already
  // ready) or rest for waitRestMs, then fire a single quick wait-bounce
  // pulse (waitBounceMs — the same speed as the hop's own bounce, only the
  // rest between pulses is slow) — re-checking readiness before the rest
  // AND again right before the pulse, so the loop always stops with the dot
  // already at rest, never mid-motion.
  const settleOrWait = useCallback(() => {
    if (readyRef.current || timedOutRef.current) {
      t.value = withTiming(T_END, { duration: WM.out, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
      return;
    }
    restTimer.current = setTimeout(() => {
      if (readyRef.current || timedOutRef.current) {
        settleOrWait();
        return;
      }
      waitCycle.value = withTiming(
        1,
        { duration: WM.waitBounceMs, easing: Easing.inOut(Easing.sin) },
        (finished) => {
          if (finished) {
            waitCycle.value = 0;
            runOnJS(settleOrWait)();
          }
        },
      );
    }, WM.waitRestMs);
  }, [onDone, t, waitCycle]);

  useEffect(() => {
    if (started.current || !measured || !fontsLoaded || !holdDone) return;
    started.current = true;
    t.value = withTiming(T_OUT, { duration: T_OUT, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(settleOrWait)();
    });
  }, [measured, fontsLoaded, holdDone, settleOrWait, t]);

  const shiftStyle = useAnimatedStyle(() => {
    const { shift0 } = deriveOffsets(m.value);
    return { transform: [{ translateX: shiftOffset(t.value, shift0) }] };
  });

  // Skew lives here (not in the static stylesheet) so it composes with the
  // animated translateX in one transform array instead of one overwriting
  // the other. translateY corrects for Anton's internal line-box leading at
  // lineHeight: GLYPH_H (the text renders vertically centered in that box,
  // not flush with its bottom) — nudges the glyphs down so their visual
  // baseline lands on the same line as the logo's bottom edge and the dot,
  // instead of floating above it.
  //
  // Reads waitCycle.value purely to stay in Reanimated's dependency list —
  // t and m are both frozen for the whole wait-bounce loop, so without this
  // the worklet would never re-run there at all. Observed on-device: with
  // nothing re-running it, "Fit" (this View and its clipStyle sibling below)
  // silently drops out of the composited tree partway through the loop —
  // Reanimated/Fabric loses a sibling view that goes too long without a
  // props update while another (dotStyle, driven by the same waitCycle)
  // keeps animating. Re-pushing the same, unchanged style every pulse keeps
  // it alive.
  const fitWrapStyle = useAnimatedStyle(() => {
    const { shift0 } = deriveOffsets(m.value);
    void waitCycle.value;
    return {
      transform: [
        { skewX: '-9deg' },
        { translateX: shiftOffset(t.value, shift0) },
        { translateY: 15 },
      ],
    };
  });

  // Same waitCycle dependency, same reason — see fitWrapStyle above.
  const clipStyle = useAnimatedStyle(() => {
    void waitCycle.value;
    return { width: clipWidth(t.value, m.value.fitW) };
  });

  const dotStyle = useAnimatedStyle(() => {
    const { dotD0 } = deriveOffsets(m.value);
    const base = dotTransform(t.value, dotD0);
    const bounce = waitBounce(waitCycle.value);
    return {
      transform: [
        { translateX: base.translateX },
        { translateY: base.translateY + bounce.translateY },
        { scaleX: base.scaleX * bounce.scaleX },
        { scaleY: base.scaleY * bounce.scaleY },
      ],
    };
  });

  const rowStyle = useAnimatedStyle(() => ({
    opacity: rowOpacity(t.value),
  }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="auto">
      <Animated.View style={[styles.row, rowStyle]}>
        <Animated.View
          style={[styles.ajBox, shiftStyle]}
          onLayout={(e: LayoutChangeEvent) => {
            parts.current.aL = e.nativeEvent.layout.x;
            commit();
          }}
        >
          <Image
            source={LOGO}
            style={{
              position: 'absolute',
              width: LOGO_PX,
              height: LOGO_PX,
              left: -LOGO_PX * BOX.l,
              top: -LOGO_PX * BOX.t,
            }}
          />
        </Animated.View>

        <Animated.View
          style={[styles.fitWrap, fitWrapStyle]}
          onLayout={(e: LayoutChangeEvent) => {
            parts.current.fitL = e.nativeEvent.layout.x;
            parts.current.fitW = e.nativeEvent.layout.width;
            commit();
          }}
        >
          {/* Invisible copy sizes the wrapper to the word's real width. */}
          <Animated.Text style={[styles.fit, { opacity: 0 }]}>Fit</Animated.Text>
          <Animated.View style={[styles.clip, clipStyle]}>
            <View style={styles.fitRow}>
              {LETTERS.map((ch, i) => (
                <Letter key={ch + i} ch={ch} index={i} t={t} waitCycle={waitCycle} />
              ))}
            </View>
          </Animated.View>
        </Animated.View>

        <Animated.View
          style={[styles.dot, dotStyle]}
          onLayout={(e: LayoutChangeEvent) => {
            parts.current.dF = e.nativeEvent.layout.x;
            commit();
          }}
        />
      </Animated.View>
    </View>
  );
}

function Letter({
  ch,
  index,
  t,
  waitCycle,
}: {
  ch: string;
  index: number;
  t: SharedValue<number>;
  waitCycle: SharedValue<number>;
}) {
  // waitCycle dependency: see fitWrapStyle's doc comment above.
  const style = useAnimatedStyle(() => {
    void waitCycle.value;
    const { opacity, translateY } = letterStyle(t.value, index);
    return { opacity, transform: [{ translateY }] };
  });
  return <Animated.Text style={[styles.fit, style]}>{ch}</Animated.Text>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  row: { flexDirection: 'row', alignItems: 'flex-end', height: GLYPH_H },
  ajBox: { width: AJ_W, height: GLYPH_H, overflow: 'hidden' },
  fitWrap: { marginLeft: 12 },
  clip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  fitRow: { flexDirection: 'row', alignItems: 'flex-end' },
  fit: {
    fontFamily: 'Anton_400Regular',
    fontSize: 50,
    lineHeight: GLYPH_H,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  dot: {
    marginLeft: 6,
    marginBottom: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    transformOrigin: 'bottom',
  },
});
