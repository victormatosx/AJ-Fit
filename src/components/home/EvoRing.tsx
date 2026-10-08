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
  // Deliberately a hardcoded dark value, not `theme.colors.progressTrack` —
  // this redesign is dark-only regardless of the active theme (same
  // precedent as `HomeScreen.tsx`'s `TODAY_WORKOUT_THEME`).
  trackColor = 'rgba(255,255,255,0.08)',
  accessibilityLabel,
  children,
}: {
  size: number;
  strokeWidth: number;
  /** 0-100. Values outside this range are clamped. */
  progress: number;
  color: string;
  trackColor?: string;
  /** Describes what the ring represents, e.g. "56% do ciclo". */
  accessibilityLabel?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      {/* -90deg rotation moves the stroke's start point from 3 o'clock
          (the SVG default) to 12 o'clock. */}
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
          // Both dash segments are set to the full circumference, so the
          // dash pattern never actually creates a gap on its own — the
          // visible gap comes entirely from offsetting where that dash
          // starts via `strokeDashoffset` below.
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
