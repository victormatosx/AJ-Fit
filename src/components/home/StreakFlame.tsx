import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { streakFlameTierForDays } from '../../home/streakFlameTiers';

/**
 * The streak flame, in every tier. Supersedes the old single-colour
 * `LitFlame` (its blue gradient was exactly the `spark` tier) and is the ONLY
 * place the flame is drawn — Home, the transformation screen and the
 * screen's 14pt legend icons all render this component.
 *
 * Purely presentational: it receives an already-computed streak value and
 * never reads, derives or writes streak state.
 *
 * Port notes, continuing `LitFlame`'s rationale:
 * - RN-SVG has no filter support, so the design's `drop-shadow` glow becomes
 *   a `RadialGradient` circle drawn behind the body inside the SAME viewBox.
 *   Keeping it in-viewBox (rather than an oversized sibling layer) is what
 *   makes the glow safe from Android's child clipping.
 * - The CSS flicker keyframes become a reanimated loop on the wrapper. The
 *   design's `transform-origin: 50% 90%` is preserved via `transformOrigin`
 *   so the flame pivots at its base, not its centre.
 * Every tier shares the same geometry, core, flicker and glow treatment —
 * only the colour values differ. There is no per-tier special effect.
 */

const BODY_PATH = 'M12 2c2 5 6 6 6 11a6 6 0 11-12 0c0-3 2-5 2-8 1 3 3 3 4-3z';
const CORE_PATH = 'M12 11c1 2.4 3 3 3 5.4a3 3 0 11-6 0c0-1.4.9-2.3.9-3.8.6 1.3 1.6 1.3 2.1-1.6z';

/** Flicker cycle from the spec: 2.4s, keyframes at 30% / 60% / 100%. */
const FLICKER_TO_30_MS = 720;
const FLICKER_TO_60_MS = 720;
const FLICKER_TO_100_MS = 960;

export function StreakFlame({
  days,
  size = 40,
  animated = true,
  glow = true,
}: {
  /** Current streak value. `0` (or below) renders the unlit outline. */
  days: number;
  size?: number;
  /**
   * Continuous flicker + halo spin. Pass `false` for the small legend icons
   * the design keeps still, and whenever the OS asks to reduce motion — the
   * static render is the identical artwork, just not moving.
   */
  animated?: boolean;
  /** The soft radial glow behind the body. Off for tiny legend icons. */
  glow?: boolean;
}) {
  const tier = streakFlameTierForDays(days);
  const lit = tier !== null;
  const flickering = lit && animated;

  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (!flickering) {
      scaleX.value = 1;
      scaleY.value = 1;
      rotate.value = 0;
      return;
    }
    const ease = Easing.inOut(Easing.ease);
    scaleX.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: FLICKER_TO_30_MS, easing: ease }),
        withTiming(0.97, { duration: FLICKER_TO_60_MS, easing: ease }),
        withTiming(1, { duration: FLICKER_TO_100_MS, easing: ease }),
      ),
      -1,
    );
    scaleY.value = withRepeat(
      withSequence(
        withTiming(0.97, { duration: FLICKER_TO_30_MS, easing: ease }),
        withTiming(1.04, { duration: FLICKER_TO_60_MS, easing: ease }),
        withTiming(1, { duration: FLICKER_TO_100_MS, easing: ease }),
      ),
      -1,
    );
    rotate.value = withRepeat(
      withSequence(
        withTiming(-1.5, { duration: FLICKER_TO_30_MS, easing: ease }),
        withTiming(1.2, { duration: FLICKER_TO_60_MS, easing: ease }),
        withTiming(0, { duration: FLICKER_TO_100_MS, easing: ease }),
      ),
      -1,
    );
    return () => {
      // Unmount/disable must stop the loops — no animation keeps running for
      // a flame that is gone or off screen.
      scaleX.value = 1;
      scaleY.value = 1;
      rotate.value = 0;
    };
  }, [flickering, rotate, scaleX, scaleY]);

  const flickerStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  // Unique per tier so two flames of different tiers on screen (the "Antes"
  // and "Agora" legend icons) never share a gradient definition.
  const bodyId = `streak-flame-body-${tier?.id ?? 'off'}`;
  const glowId = `streak-flame-glow-${tier?.id ?? 'off'}`;

  return (
    <View
      style={{ width: size, height: size, overflow: 'visible' }}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[
          { width: size, height: size, transformOrigin: '50% 90%' },
          flickering ? flickerStyle : undefined,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Defs>
            {tier && (
              <LinearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={tier.top} />
                <Stop offset="0.55" stopColor={tier.mid} />
                <Stop offset="1" stopColor={tier.base} />
              </LinearGradient>
            )}
            {tier && glow && (
              <RadialGradient id={glowId} cx="50%" cy="54%" r="50%">
                <Stop offset="0" stopColor={`rgb(${tier.glowRgb})`} stopOpacity={0.55} />
                <Stop offset="0.55" stopColor={`rgb(${tier.glowRgb})`} stopOpacity={0.18} />
                <Stop offset="1" stopColor={`rgb(${tier.glowRgb})`} stopOpacity={0} />
              </RadialGradient>
            )}
          </Defs>
          {tier && glow && <Circle cx={12} cy={13} r={12} fill={`url(#${glowId})`} />}
          <Path
            d={BODY_PATH}
            fill={tier ? `url(#${bodyId})` : 'none'}
            stroke={tier ? 'none' : 'rgba(255,255,255,0.3)'}
            strokeWidth={1.4}
          />
          {tier && <Path d={CORE_PATH} fill={tier.core} opacity={0.9} />}
        </Svg>
      </Animated.View>
    </View>
  );
}
