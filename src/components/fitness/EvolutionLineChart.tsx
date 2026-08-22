import { useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';

export type EvolutionPoint = { dateLabel: string; value: number };

const HEIGHT = 72;
const H_PADDING = 6;
const V_PADDING = 10;

/**
 * Small single-series line chart (one metric over time). Two of these are
 * used side by side instead of one dual-axis chart — body mass and body
 * fat (%) live on incomparable scales, and a shared axis would misrepresent
 * one of them (dataviz skill: "never a dual-axis chart").
 *
 * X spacing is ordinal (one slot per entry, evenly spaced) rather than
 * proportional to the real date gaps — with irregular, sometimes months-apart
 * measurements, true time-proportional spacing would squash most of the
 * line into a corner. Only the first/last dates are labeled, which is honest
 * either way since nothing claims to be a precise time axis.
 */
export function EvolutionLineChart({
  label,
  unit,
  color,
  points,
  emptyHint,
  showEmptyHint = true,
}: {
  label: string;
  unit: string;
  color: string;
  points: EvolutionPoint[];
  emptyHint: string;
  showEmptyHint?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  const [width, setWidth] = useState(0);

  const last = points[points.length - 1] ?? null;

  return (
    <View
      style={{ flex: 1 }}
      accessible
      accessibilityLabel={t('accessibility.chart', { label, description: emptyHint })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <MonoLabel>{label}</MonoLabel>
        {last && (
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13, color: theme.colors.textPrimary }}>
            {t('result', { value: last.value.toFixed(1), unit })}
          </Text>
        )}
      </View>

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: HEIGHT, justifyContent: 'center' }}
      >
        {points.length < 2 || width === 0 ? (
          showEmptyHint ? (
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11, color: theme.chart.label }}>
              {emptyHint}
            </Text>
          ) : null
        ) : (
          <ChartBody width={width} color={color} points={points} />
        )}
      </View>

      {points.length >= 2 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
          <MonoLabel color={theme.chart.label}>{points[0].dateLabel}</MonoLabel>
          <MonoLabel color={theme.chart.label}>{points[points.length - 1].dateLabel}</MonoLabel>
        </View>
      )}
    </View>
  );
}

function ChartBody({ width, color, points }: { width: number; color: string; points: EvolutionPoint[] }) {
  const { theme } = useTheme();
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Flat series (every value identical) would divide by zero — treat as a
  // small artificial range so the line still draws as a flat baseline.
  const range = max - min || 1;

  const usableW = width - H_PADDING * 2;
  const usableH = HEIGHT - V_PADDING * 2;
  const step = points.length > 1 ? usableW / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = H_PADDING + i * step;
    const y = V_PADDING + usableH - ((p.value - min) / range) * usableH;
    return { x, y };
  });

  return (
    <Svg width={width} height={HEIGHT}>
      <Line
        x1={0}
        y1={HEIGHT - V_PADDING}
        x2={width}
        y2={HEIGHT - V_PADDING}
        stroke={theme.chart.axis}
        strokeWidth={1}
      />
      <Polyline
        points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map((c, i) => {
        const isEndpoint = i === 0 || i === coords.length - 1;
        return (
          <Circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={isEndpoint ? 3.5 : 2.5}
            fill={isEndpoint ? color : theme.chart.background}
            stroke={color}
            strokeWidth={isEndpoint ? 0 : 1.5}
          />
        );
      })}
    </Svg>
  );
}
