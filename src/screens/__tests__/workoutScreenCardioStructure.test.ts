import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

describe('WorkoutScreen cardio finisher structure', () => {
  it('renders a post-strength prescription only when cardioFinisher exists', () => {
    expect(source).toContain('if (showCardioFinisher && cardioFinisher)');
    expect(source).toContain("t('cardioFinisher.title')");
    expect(source).toContain('resolveCardioFinisherPresentation');
  });

  it('does not add pace, distance, heart-rate or calorie tracking', () => {
    expect(source).not.toContain('cardioDistance');
    expect(source).not.toContain('heartRate');
    expect(source).not.toContain('cardioCalories');
  });
});
