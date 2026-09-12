import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(new URL('../useWorkoutSchedule.ts', import.meta.url), 'utf8');
const code = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('useWorkoutSchedule — post-completion reload boundary', () => {
  it('has no client-side normal Schedule completion mutation', () => {
    expect(code).not.toContain('const completeSession = useCallback');
    expect(code).not.toContain('completeScheduledSession');
    expect(code).toContain('await finalizeWorkoutSession({ executionId: candidate.executionId })');
  });

  it('retains the background reload Promise and handles its rejection', () => {
    const start = code.indexOf('const reloadAfterCompletion = useCallback');
    const end = code.indexOf('const resolveMiss = useCallback', start);
    const reload = code.slice(start, end);

    expect(reload).toContain('completionReloadRef.current = operation');
    expect(reload).toContain('.catch(');
    expect(reload).toContain("'schedule_reload_start'");
    expect(reload).toContain("'schedule_reload_end'");
  });

  it('retries a failed/stale projection on the next foreground transition', () => {
    expect(code).toContain("AppState.addEventListener('change'");
    expect(code).toMatch(/nextState === 'active' && previousState !== 'active'/);
    expect(code).toContain('reloadAfterCompletion();');
  });
});
