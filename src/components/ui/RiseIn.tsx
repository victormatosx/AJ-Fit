import React, { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

export const RISE_IN_DURATION = 600;
export const RISE_IN_TRANSLATE_Y = 14;
export const RISE_IN_EASING = Easing.out(Easing.cubic);

/**
 * Cascading rise-in: opacity 0→1 + translateY 14→0, `duration`ms,
 * `Easing.out(cubic)`, native driver. Extracted verbatim from
 * `PlanReadyScreen` (unchanged there — same values, same behavior), where
 * it drives that screen's per-section staggered reveal via `delay`. This is
 * the one entrance in the funnel that was validated as feeling good in the
 * real app; `AnimatedStepContainer` reuses its axis/easing/distance for the
 * funnel's general step transition.
 */
export function RiseIn({
  children,
  delay = 0,
  duration = RISE_IN_DURATION,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration,
      delay,
      easing: RISE_IN_EASING,
      useNativeDriver: true,
    }).start();
  }, [anim, delay, duration]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [RISE_IN_TRANSLATE_Y, 0] });
  return (
    <Animated.View style={[style, { opacity: anim, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
