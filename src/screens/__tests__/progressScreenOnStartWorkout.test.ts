import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen onStartWorkout wiring', () => {
  it('accepts an optional onStartWorkout prop and passes it to LoadsEvolutionView', () => {
    expect(screen).toContain('onStartWorkout?: () => void;');
    expect(screen).toContain('onStartWorkout={onStartWorkout}');
  });
});

describe('ProgressScreen locked-preview scroll/centering', () => {
  it('derives the locked state for the active tab from the same data the panels gate on', () => {
    // Imported health weight counts as real data too: the full-screen lock
    // only applies when neither a real assessment nor imported weight exists
    // (see BodyEvolutionView's own `hasAnyRealWeight`).
    expect(screen).toContain("!latest && importedWeights.length === 0;");
    expect(screen).toContain(
      'const isLoadsLocked = !loadsLoading && !loadsError && loadExercises.length === 0;',
    );
  });

  it('disables scrolling and stretches the panel to fill the screen while locked', () => {
    expect(screen).toContain('scrollEnabled={!isCurrentViewLocked}');
    expect(screen).toContain('isCurrentViewLocked ? { flexGrow: 1 } : { paddingBottom: spacing[8] }');
    expect(screen).toContain('fillHeight={isCurrentViewLocked}');
    expect(screen).toContain('fillHeight ? { flex: 1 } : null');
  });

  it('drops the gap below the tab row while locked, so the blur starts right at its edge', () => {
    expect(screen).toContain('marginBottom: isCurrentViewLocked ? 0 : spacing[5]');
  });
});
