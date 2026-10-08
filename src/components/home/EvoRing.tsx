import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/**
 * Pure visual primitive — no internal animation state. The parent
 * (`CycleProgressBlock`/`EvolutionCelebration`) already drives the number
 * with `CountUp`'s own animation loop, so this component never recomputes
 * what `progress` means or animates its own transition — it only draws the
 * value it's given, every render.
 */
export function EvoRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor = 'rgba(255,255,255,0.08)',
  children,
}: {
  size: number;
  strokeWidth: number;
  /** 0-100. Values outside this range are clamped. */
  progress: number;
  color: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}
