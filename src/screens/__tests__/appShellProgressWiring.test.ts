import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');

describe('AppShell Progress tab wiring', () => {
  it('wires the same single start-workout entry point into the Progress tab', () => {
    expect(appShell).toContain(
      '<ProgressScreen onOpenAssessment={() => setShowAssessment(true)} onStartWorkout={requestStartWorkout} />',
    );
  });
});
