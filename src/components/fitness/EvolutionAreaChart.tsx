import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

/**
 * Catmull-Rom through every point, emitted as cubic beziers.
 *
 * Only used by `variant="line"`. The curve passes exactly through each
 * sample — it rounds the corners between them, it never reinterprets or
 * smooths away a value.
 */
function smoothPath(coords: readonly { x: number; y: number }[]): string {
  if (coords.length < 2) return '';
  let d = `M ${coords[0]!.x.toFixed(2)} ${coords[0]!.y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] ?? coords[i]!;
    const p1 = coords[i]!;
    const p2 = coords[i + 1]!;
    const p3 = coords[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function EvolutionAreaChart({
  points,
  accessibilityLabel,
  accessibilityHint,
  height = 150,
  variant = 'area',
  formatAxisValue,
}: {
  /** Chronological order, oldest first. At least two entries to draw. */
  points: EvolutionAreaChartPoint[];
  accessibilityLabel: string;
  accessibilityHint: string;
  height?: number;
  /**
   * `'area'` (default) is the original gradient-filled accent chart — every
   * pre-existing call site keeps it byte-for-byte. `'line'` is the Evolution
   * "clean" treatment: a smoothed neutral stroke, dashed guides and an
   * accent endpoint, with no fill. Visual only — selection, the tooltip and
   * the accessibility contract are identical in both.
   */
  variant?: 'area' | 'line';
  /**
   * Labels the three guide lines on the right edge with their own value.
   * `'line'` only; omitted means no axis labels at all (never a guessed
   * format).
   */
  formatAxisValue?: (value: number) => string;
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
  const polyline = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');
  const isLine = variant === 'line';
  const line = isLine ? smoothPath(coords) : polyline;
  const area = `${polyline} L ${VIEW_W - PAD_X} ${height} L ${PAD_X} ${height} Z`;
  // Top guide reads `max`, middle the midpoint, bottom `min` — the same three
  // lines the chart already drew, now named.
  const axisValues = [max, (max + min) / 2, min];
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
            strokeDasharray={isLine ? '2 4' : undefined}
          />
        ))}

        {isLine ? null : <Path d={area} fill="url(#evolutionFill)" />}
        <Path
          d={line}
          stroke={isLine ? theme.chart.endpoint : theme.chart.primaryLine}
          strokeOpacity={isLine ? 0.88 : 1}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {isLine ? (
          <>
            <Circle cx={last.x} cy={last.y} r={9} fill={theme.colors.primaryEmphasis} fillOpacity={0.18} />
            <Circle
              cx={last.x}
              cy={last.y}
              r={4.5}
              fill={theme.colors.primaryEmphasis}
              stroke={theme.chart.background}
              strokeWidth={2}
            />
          </>
        ) : (
          <Circle cx={last.x} cy={last.y} r={4.5} fill={theme.chart.endpoint} />
        )}
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

      {isLine && formatAxisValue ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {axisValues.map((value, i) => (
            <Text
              key={i}
              style={{
                position: 'absolute',
                right: 0,
                // Centres the 10px label on its guide line.
                top: PAD_TOP + (i * usableH) / 2 - 6,
                fontFamily: theme.fonts.mono,
                fontSize: 10,
                letterSpacing: 0.6,
                color: theme.chart.label,
              }}
            >
              {formatAxisValue(value)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
