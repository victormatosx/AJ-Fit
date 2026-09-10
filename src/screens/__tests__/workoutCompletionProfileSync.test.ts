import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

describe('completed workout -> Profile synchronization', () => {
  it('waits for durable workout completion before leaving the completed workout', () => {
    expect(appShell).toContain('const workoutCompletionRef = useRef<Promise<void> | null>(null);');
    expect(appShell).toContain('await workoutCompletionRef.current;');
    expect(appShell).toContain('workoutCompletionRef.current = completion;');
  });

  it('refreshes Profile evolution data even when another post-workout follow-up fails', () => {
    const afterSchedule = appShell.slice(
      appShell.indexOf('afterSchedule: async () => {'),
      appShell.indexOf("if (result === 'COMPLETED')"),
    );

    expect(afterSchedule).toContain('finally {');
    expect(afterSchedule).toContain('evolution.refresh()');
    expect(afterSchedule).toContain('activitySnapshot.reload()');
    expect(afterSchedule).toContain('frequencyWindow.reload()');
  });
});
