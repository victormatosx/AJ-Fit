import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

describe('StartWorkoutConfirmation interaction', () => {
  it('does not animate the native modal, so a quick confirmation tap is accepted immediately', () => {
    const start = source.indexOf('function StartWorkoutConfirmation({');
    const end = source.indexOf('function WorkoutTabBlockedState(', start);
    const confirmation = source.slice(start, end);

    expect(confirmation).toContain('animationType="none"');
    expect(confirmation).not.toContain('animationType="fade"');
  });
});
