import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLG, Line, Path, Stop } from 'react-native-svg';

import { useTheme } from '../../theme';
import {
  adjacentEvolutionPointIndex,
  nearestEvolutionPointIndex,
} from './evolutionChartInteraction';

/**
 * Hero line chart for one metric over time.
 *
 * Purely presentational: it receives values that were already computed and
 * unit-converted by the caller, and never decides what a point means. The
 * companion `EvolutionLineChart` stays the right choice for the paired
 * sparklines inside the assessment screen — this one is the single, larger
 * series the Evolution screen leads with.
 *
 * X spacing is ordinal, one slot per entry. Assessments land at irregular
 * intervals, sometimes months apart, so proportional spacing would crush most
 * of the line into a corner. Only the first and last dates are labeled by the
 * caller, which keeps that honest — nothing here claims to be a time axis.
 */

const VIEW_W = 320;
const PAD_X = 4;
const PAD_TOP = 36;
const PAD_BOTTOM = 14;

export interface EvolutionAreaChartPoint {
  /** Numeric display-unit value used to position the point. */
  value: number;
  /** Fully formatted value and unit shown after selection. */
  displayValue: string;
  /** Usually the date represented by this point. */
  label: string;
}

export function EvolutionAreaChart({
  points,
  accessibilityLabel,
  accessibilityHint,
  height = 150,
}: {
  /** Chronological order, oldest first. At least two entries to draw. */
  points: EvolutionAreaChartPoint[];
  accessibilityLabel: string;
  accessibilityHint: string;
  height?: number;
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const seriesSignature = points
    .map((point) => `${point.value}:${point.displayValue}:${point.label}`)
    .join('|');

  useEffect(() => {
    setSelectedIndex(null);
  }, [seriesSignature]);

  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A perfectly flat series would divide by zero; draw it as a mid baseline.
  const range = max - min || 1;
  const usableW = VIEW_W - PAD_X * 2;
  const usableH = height - PAD_TOP - PAD_BOTTOM;

  const point = (value: number, index: number) => ({
    x: PAD_X + (index / (values.length - 1)) * usableW,
    y: PAD_TOP + (1 - (value - min) / range) * usableH,
  });

  const coords = values.map(point);
  const line = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L ${VIEW_W - PAD_X} ${height} L ${PAD_X} ${height} Z`;
  const last = coords[coords.length - 1]!;
  const selected = selectedIndex == null ? null : points[selectedIndex] ?? null;
  const selectedCoord = selectedIndex == null ? null : coords[selectedIndex] ?? null;

  const selectAdjacentPoint = (direction: -1 | 1) => {
    setSelectedIndex((current) => (
      adjacentEvolutionPointIndex(current, points.length, direction)
    ));
  };

  return (
    <View style={{ position: 'relative' }}>
      {selected ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            zIndex: 1,
            top: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              minHeight: 28,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
              backgroundColor: theme.colors.floatingSurface,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiBold,
                fontSize: 13,
                color: theme.colors.textPrimary,
              }}
            >
              {selected.displayValue}
            </Text>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 9,
                color: theme.colors.textMuted,
              }}
            >
              {selected.label.toUpperCase()}
            </Text>
          </View>
        </View>
      ) : null}

      <Pressable
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          const index = nearestEvolutionPointIndex(
            event.nativeEvent.locationX,
            width,
            points.length,
          );
          if (index != null) setSelectedIndex(index);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityValue={selected
          ? { text: `${selected.displayValue}, ${selected.label}` }
          : undefined}
        accessibilityActions={[
          { name: 'decrement' },
          { name: 'increment' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') selectAdjacentPoint(1);
          if (event.nativeEvent.actionName === 'decrement') selectAdjacentPoint(-1);
        }}
        style={{ height }}
      >
      <Svg width="100%" height={height} viewBox={`0 0 ${VIEW_W} ${height}`}>
        <Defs>
          <SvgLG id="evolutionFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={theme.chart.primaryAreaStart} stopOpacity="0.28" />
            <Stop offset="100%" stopColor={theme.chart.primaryAreaEnd} stopOpacity="0" />
          </SvgLG>
        </Defs>

        {[0, 1, 2].map((i) => (
          <Line
            key={i}
            x1={0}
            x2={VIEW_W}
            y1={PAD_TOP + (i * usableH) / 2}
            y2={PAD_TOP + (i * usableH) / 2}
            stroke={theme.chart.grid}
            strokeWidth={1}
          />
        ))}

        <Path d={area} fill="url(#evolutionFill)" />
        <Path
          d={line}
          stroke={theme.chart.primaryLine}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={last.x} cy={last.y} r={4.5} fill={theme.chart.endpoint} />
        {selectedCoord ? (
          <>
            <Line
              x1={selectedCoord.x}
              x2={selectedCoord.x}
              y1={PAD_TOP}
              y2={height - PAD_BOTTOM}
              stroke={theme.chart.axis}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <Circle
              cx={selectedCoord.x}
              cy={selectedCoord.y}
              r={5}
              fill={theme.chart.endpoint}
              stroke={theme.colors.floatingSurface}
              strokeWidth={2}
            />
          </>
        ) : null}
      </Svg>
      </Pressable>
    </View>
  );
}
