import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AJ_RISE } from '../aj/ajMomentTiming';
import type { AjFunnelDirector } from '../onboarding/AjFunnelStage';

const AVATAR_SLOT_SIZE = 56;

/**
 * Jotinha's presentation on the Plan screen: just the mascot, fixed
 * top-right for the screen's whole lifetime — no speech bubble, no typed
 * lines. His own built-in idle animation (float + blink — see `AjBot`) is
 * what gives him "reactions and movements"; this component only measures
 * where he should render and asks the funnel's shared overlay to draw him
 * there (`aj.direct` — see `AjFunnelStage`), rather than rendering a second
 * AJ, plus a single greeting hop on arrival that mirrors the hop
 * `PlanReadyScreen.handleContinue` already plays on the way out.
 *
 * Under Reduce Motion this renders nothing and hides the mascot entirely,
 * same as every other AJ moment in the funnel.
 */
export function JotinhaPlanDropdown({
  aj,
  reduceMotion,
}: {
  aj: AjFunnelDirector;
  reduceMotion: boolean;
}) {
  const insets = useSafeAreaInsets();
  const slotRef = useRef<View>(null);
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    aj.setVisible(!reduceMotion);
  }, [reduceMotion, aj]);

  useEffect(() => {
    if (reduceMotion) return () => undefined;
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: AJ_RISE.durationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(() => aj.play('hop'));
    return () => animation.stop();
    // Plays once, on mount — not on every `anim`/`aj`/`reduceMotion` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measureSlot = useCallback(() => {
    slotRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      aj.direct({ x, y, size: Math.min(width, height), rotate: 0 });
    });
  }, [aj]);

  if (reduceMotion) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-AJ_RISE.translateY, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 56,
        right: 22,
        opacity: anim,
        transform: [{ translateY }],
      }}
    >
      {/* Empty on purpose — AJ is drawn by the funnel's shared overlay,
          outside this tree (see `AjFunnelStage`). This only reserves and
          measures the box he should appear in. */}
      <View ref={slotRef} onLayout={measureSlot} style={{ width: AVATAR_SLOT_SIZE, height: AVATAR_SLOT_SIZE }} />
    </Animated.View>
  );
}
