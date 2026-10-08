import { useEffect } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Streak flame icon — port of the web prototype's CSS `drop-shadow` +
 * flicker-keyframes flame to `react-native-svg` + `react-native-reanimated`.
 * The drop-shadow is dropped entirely (RN-SVG has no filter support and it
 * isn't worth approximating for an icon this size); the flicker becomes a
 * reanimated scaleX/scaleY breathing loop instead of a CSS animation.
 *
 * `lit` toggles between two entirely different renders: `lit` is the
 * filled-with-gradient, animated flame (an active streak); `!lit` is a
 * static outlined flame (no streak) — no gradient fill, no animation.
 */
export function LitFlame({ size = 40, lit = true }: { size?: number; lit?: boolean }) {
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);

  useEffect(() => {
    if (!lit) {
      scaleX.value = 1;
      scaleY.value = 1;
      return;
    }
    scaleX.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.98, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 960, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    scaleY.value = withRepeat(
      withSequence(
        withTiming(0.97, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.04, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 960, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [lit, scaleX, scaleY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }, { scaleY: scaleY.value }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, lit ? animatedStyle : undefined]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#9fd6ff" />
            <Stop offset="0.55" stopColor="#2a8aff" />
            <Stop offset="1" stopColor="#0b55e0" />
          </LinearGradient>
        </Defs>
        <Path
          d="M12 2c2 5 6 6 6 11a6 6 0 11-12 0c0-3 2-5 2-8 1 3 3 3 4-3z"
          fill={lit ? 'url(#flame)' : 'none'}
          stroke={lit ? 'none' : 'rgba(255,255,255,0.3)'}
          strokeWidth={1.4}
        />
        {lit && (
          <Path
            d="M12 11c1 2.4 3 3 3 5.4a3 3 0 11-6 0c0-1.4.9-2.3.9-3.8.6 1.3 1.6 1.3 2.1-1.6z"
            fill="#eaf5ff"
            opacity={0.9}
          />
        )}
      </Svg>
    </Animated.View>
  );
}
