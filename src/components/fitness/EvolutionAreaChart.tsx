import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLG, Line, Path, Stop } from 'react-native-svg';

import { colors } from '../../theme/tokens';

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
const PAD_Y = 14;

export function EvolutionAreaChart({
  values,
  height = 150,
}: {
  /** Chronological order, oldest first. At least two entries to draw. */
  values: number[];
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A perfectly flat series would divide by zero; draw it as a mid baseline.
  const range = max - min || 1;
  const usableW = VIEW_W - PAD_X * 2;
  const usableH = height - PAD_Y * 2;

  const point = (value: number, index: number) => ({
    x: PAD_X + (index / (values.length - 1)) * usableW,
    y: PAD_Y + (1 - (value - min) / range) * usableH,
  });

  const coords = values.map(point);
  const line = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L ${VIEW_W - PAD_X} ${height} L ${PAD_X} ${height} Z`;
  const last = coords[coords.length - 1]!;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${VIEW_W} ${height}`}>
        <Defs>
          <SvgLG id="evolutionFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.accentHi} stopOpacity="0.28" />
            <Stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
          </SvgLG>
        </Defs>

        {[0, 1, 2].map((i) => (
          <Line
            key={i}
            x1={0}
            x2={VIEW_W}
            y1={PAD_Y + (i * usableH) / 2}
            y2={PAD_Y + (i * usableH) / 2}
            stroke={colors.hair}
            strokeWidth={1}
          />
        ))}

        <Path d={area} fill="url(#evolutionFill)" />
        <Path
          d={line}
          stroke={colors.accentHi}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={last.x} cy={last.y} r={4.5} fill={colors.text} />
      </Svg>
    </View>
  );
}
