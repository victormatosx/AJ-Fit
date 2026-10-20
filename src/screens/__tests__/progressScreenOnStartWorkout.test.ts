import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen onStartWorkout wiring', () => {
  it('accepts an optional onStartWorkout prop and passes it to LoadsEvolutionView', () => {
    expect(screen).toContain('onStartWorkout?: () => void;');
    expect(screen).toContain('onStartWorkout={onStartWorkout}');
  });
});

describe('ProgressScreen panel scrolling', () => {
  it('leaves emptiness entirely to the panels instead of mirroring their condition here', () => {
    // The screen used to re-derive each panel's "no real data" condition so
    // it could freeze the scroll around a centered, full-screen locked
    // preview. The empty states are now ordinary (and taller-than-screen)
    // panels, so that duplicated gate is gone and the condition lives in
    // one place only: the panel itself.
    expect(screen).not.toContain('isBodyLocked');
    expect(screen).not.toContain('isLoadsLocked');
    expect(screen).not.toContain('isCurrentViewLocked');
  });

  it('scrolls every Corpo/Cargas state from the top, with the tab-bar spacing intact', () => {
    expect(screen).toContain('contentContainerStyle={{ paddingBottom: spacing[8] }}');
    expect(screen).not.toContain('scrollEnabled=');
    expect(screen).not.toContain('flexGrow: 1');
  });

  it('keeps the constant gap below the tab row', () => {
    expect(screen).toContain('style={{ marginBottom: spacing[5] }}');
  });
});
