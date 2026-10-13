import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  adjacentEvolutionPointIndex,
  nearestEvolutionPointIndex,
} from '../evolutionChartInteraction';

const areaChart = readFileSync('src/components/fitness/EvolutionAreaChart.tsx', 'utf8');
const bodyView = readFileSync('src/components/fitness/BodyEvolutionView.tsx', 'utf8');
const loadsView = readFileSync('src/components/fitness/LoadsEvolutionView.tsx', 'utf8');

describe('evolution chart interaction', () => {
  it('selects the nearest ordinal point and clamps touches to the series', () => {
    expect(nearestEvolutionPointIndex(0, 300, 4)).toBe(0);
    expect(nearestEvolutionPointIndex(145, 300, 4)).toBe(1);
    expect(nearestEvolutionPointIndex(300, 300, 4)).toBe(3);
    expect(nearestEvolutionPointIndex(450, 300, 4)).toBe(3);
    expect(nearestEvolutionPointIndex(-30, 300, 4)).toBe(0);
  });

  it('supports accessible traversal and never leaves the available points', () => {
    expect(adjacentEvolutionPointIndex(null, 4, 1)).toBe(0);
    expect(adjacentEvolutionPointIndex(0, 4, -1)).toBe(0);
    expect(adjacentEvolutionPointIndex(1, 4, 1)).toBe(2);
    expect(adjacentEvolutionPointIndex(3, 4, 1)).toBe(3);
    expect(adjacentEvolutionPointIndex(null, 4, -1)).toBe(3);
  });

  it('renders the selected metric and date above a highlighted chart point', () => {
    expect(areaChart).toContain('onPress={(event) => {');
    expect(areaChart).toContain('{selected.displayValue}');
    expect(areaChart).toContain('{selected.label.toUpperCase()}');
    expect(areaChart).toContain('x1={selectedCoord.x}');
    expect(areaChart).toContain('accessibilityRole="adjustable"');
  });

  it('wires every Evolution-page chart with real values, dates and units', () => {
    expect(bodyView.match(/<EvolutionAreaChart/g)).toHaveLength(2);
    expect(bodyView.match(/accessibilityHint=\{t\('progress\.chartInteractionHint'\)\}/g))
      .toHaveLength(2);
    expect(bodyView).toContain('displayValue: `${formatWeightFromKg(entry.weightKg, resolvedUnits)}');
    expect(bodyView).toContain('displayValue: `${formatMeasurement(point.value)}');

    expect(loadsView.match(/<EvolutionAreaChart/g)).toHaveLength(1);
    expect(loadsView).toContain('displayValue: `${formatWorkoutLoadFromKg(point.loadKg');
    expect(loadsView).toContain('label: dateFormatter.format(localDateAsDate(point.localDate))');
  });
});
