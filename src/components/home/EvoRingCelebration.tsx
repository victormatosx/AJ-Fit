import { Platform, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { CountUp } from './CountUp';
import { palette } from '../../theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PARTICLE_COUNT = 22;
const PARTICLE_DURATION_MS = 1400;
const WAVE_DURATION_MS = 1400;
const WAVE_DELAYS_MS = [0, 220, 440];
const PARTICLE_COLORS = [palette.blue700, palette.blue500, palette.white, palette.blue300];
const waveOut = Easing.out(Easing.quad);
/** Width of the step used to gate a wave/particle's visibility to "burst has
 * reached this item's own delay" — see the `started` comment below. */
const GATE_EPS = 0.01;

/**
 * The Home cycle ring's "evolution reached" celebration — a drop-in
 * replacement for `EvoRing` (never edits it) rendered by `CycleProgressBlock`
 * only while `useEvoRingCelebration`'s `celebrating` is true. Pure
 * presentation: every shared value is driven entirely by the hook: this
 * component never calls `.value =` itself, only reads.
 */
export function EvoRingCelebration({
  size = 150,
  strokeWidth = 11,
  fromPercent,
  progress,
  glow,
  burst,
  check,
  numberOpacity,
}: {
  size?: number;
  strokeWidth?: number;
  /** Ring % at the moment the celebration started — the center number counts up from here to 100. */
  fromPercent: number;
  progress: SharedValue<number>;
  glow: SharedValue<number>;
  burst: SharedValue<number>;
  check: SharedValue<number>;
  numberOpacity: SharedValue<number>;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const glowSize = size + 24;
  const glowRadius = radius + 6;

  const ringAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));
  const glowViewStyle = useAnimatedStyle(() => ({ shadowOpacity: glow.value * 0.75 }));
  const glowRingAnimatedProps = useAnimatedProps(() => ({ strokeOpacity: glow.value * 0.35 }));
  const numberStyle = useAnimatedStyle(() => ({ opacity: numberOpacity.value }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: 0.3 + check.value * 0.7 }],
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Platform.OS === 'ios' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: size / 2,
              shadowColor: palette.blue500,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 0 },
            },
            glowViewStyle,
          ]}
        />
      ) : (
        <Svg width={glowSize} height={glowSize} style={{ position: 'absolute' }} pointerEvents="none">
          <AnimatedCircle
            cx={glowSize / 2}
            cy={glowSize / 2}
            r={glowRadius}
            fill="none"
            stroke={palette.blue500}
            strokeWidth={22}
            animatedProps={glowRingAnimatedProps}
          />
        </Svg>
      )}

      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={palette.blue500}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={ringAnimatedProps}
        />
      </Svg>

      {WAVE_DELAYS_MS.map((delayMs, i) => (
        <Wave key={i} burst={burst} delayMs={delayMs} size={size} />
      ))}
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
        <Particle key={i} index={i} burst={burst} />
      ))}

      <Animated.View style={[{ alignItems: 'center' }, numberStyle]}>
        <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 40, color: '#fff', lineHeight: 48 }}>
          <CountUp
            from={fromPercent}
            to={100}
            durationMs={1300}
            style={{ fontFamily: 'Anton_400Regular', fontSize: 40, color: '#fff' }}
          />
          <Text style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)' }}>%</Text>
        </Text>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: 76,
            height: 76,
            borderRadius: 38,
            overflow: 'hidden',
            shadowColor: palette.blue700,
            shadowOpacity: 0.8,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 0 },
          },
          checkStyle,
        ]}
      >
        <LinearGradient
          colors={[palette.blue600, palette.blue700]}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="check" size={38} color="#fff" stroke={3} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

function Wave({ burst, delayMs, size }: { burst: SharedValue<number>; delayMs: number; size: number }) {
  const style = useAnimatedStyle(() => {
    const t = interpolate(burst.value, [delayMs, delayMs + WAVE_DURATION_MS], [0, 1], Extrapolation.CLAMP);
    const eased = waveOut(t);
    // `interpolate`+CLAMP can't by itself distinguish "burst hasn't reached
    // this wave's delay yet" from "burst is exactly at it" (both clamp to
    // t=0) — this step gate reads 0 for the former, 1 for the latter/after,
    // so the wave stays fully invisible instead of sitting at its "just
    // appeared" frame (0.9 opacity, full ring size) for the entire fill phase.
    const started = interpolate(burst.value, [delayMs - GATE_EPS, delayMs], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(eased, [0, 1], [0.9, 0]) * started,
      transform: [{ scale: interpolate(eased, [0, 1], [1, 1.8]) }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: 'rgba(77,163,255,0.6)',
        },
        style,
      ]}
    />
  );
}

function Particle({ index, burst }: { index: number; burst: SharedValue<number> }) {
  const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
  const distance = 110 + (index % 4) * 30;
  const delayMs = (index % 5) * 40;
  const particleSize = index % 2 ? 5 : 7;
  const isCircle = index % 3 === 0;
  const color = PARTICLE_COLORS[index % PARTICLE_COLORS.length];
  const targetRotationDeg = (index * 53) % 360;
  const targetX = Math.cos(angle) * distance;
  const targetY = Math.sin(angle) * distance;

  const style = useAnimatedStyle(() => {
    const t = interpolate(burst.value, [delayMs, delayMs + PARTICLE_DURATION_MS], [0, 1], Extrapolation.CLAMP);
    const eased = waveOut(t);
    // Same "hasn't started yet vs. exactly at t=0" gate as `Wave` above.
    const started = interpolate(burst.value, [delayMs - GATE_EPS, delayMs], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(eased, [0, 1], [1, 0]) * started,
      transform: [
        { translateX: interpolate(eased, [0, 1], [0, targetX]) },
        { translateY: interpolate(eased, [0, 1], [0, targetY]) },
        { rotate: `${interpolate(eased, [0, 1], [0, targetRotationDeg])}deg` },
        { scale: interpolate(eased, [0, 1], [1, 0.6]) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: particleSize,
          height: particleSize,
          backgroundColor: color,
          borderRadius: isCircle ? particleSize / 2 : 2,
          zIndex: 3,
        },
        style,
      ]}
    />
  );
}
