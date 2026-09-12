import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(new URL('../useWorkoutSchedule.ts', import.meta.url), 'utf8');
const code = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('useWorkoutSchedule — post-completion reload boundary', () => {
  it('returns durable Schedule success without awaiting its React projection reload', () => {
    const start = code.indexOf('const completeSession = useCallback');
    const end = code.indexOf('const resolveMiss = useCallback', start);
    const completeSession = code.slice(start, end);

    expect(completeSession).toContain('await completeScheduledSession');
    expect(completeSession).toMatch(/reloadAfterCompletion\(\);\s*return true;/);
    expect(completeSession).not.toContain('await reloadAfterCompletion()');
    expect(completeSession).not.toMatch(/finally\s*\{[\s\S]*await reload\(\)/);
  });

  it('retains the background reload Promise and handles its rejection', () => {
    const start = code.indexOf('const reloadAfterCompletion = useCallback');
    const end = code.indexOf('const completeSession = useCallback', start);
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
