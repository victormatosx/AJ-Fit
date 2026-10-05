import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync(new URL('../../screens/AppShell.tsx', import.meta.url), 'utf8');
const syncHook = readFileSync(new URL('../useWidgetSnapshotSync.ts', import.meta.url), 'utf8');

describe('workout widget lifecycle synchronization', () => {
  it('publishes immediately after regular/advanced starts and recovery resume', () => {
    const regular = appShell.slice(appShell.indexOf('const startWorkout ='), appShell.indexOf('const startAdvancedWorkout ='));
    const advanced = appShell.slice(appShell.indexOf('const startAdvancedWorkout ='), appShell.indexOf('const resolvePendingExecutionAndRetry ='));
    const recoveryResume = appShell.slice(appShell.indexOf('const handleResumeRecovery ='), appShell.indexOf('const handleDiscardRecovery ='));
    expect(regular).toContain('void widgetSnapshotSync.resyncNow()');
    expect(advanced).toContain('void widgetSnapshotSync.resyncNow()');
    expect(recoveryResume).toContain('void widgetSnapshotSync.resyncNow()');
  });

  it('removes IN_PROGRESS after durable finalization, recovery discard, and normal discard', () => {
    const completion = appShell.slice(appShell.indexOf("if (result === 'COMPLETED')"), appShell.indexOf("logInfo('workout_performance', 'finish_flow_end'"));
    const recoveryDiscard = appShell.slice(appShell.indexOf('const handleDiscardRecovery ='), appShell.indexOf('const acknowledgeMissingRecovery ='));
    const discard = appShell.slice(appShell.indexOf('const discardWorkout = async () =>'), appShell.indexOf('const leaveDiscardedWorkout ='));
    expect(completion).toContain('resyncNow({ scheduleResolution: null })');
    expect(recoveryDiscard).toContain('void widgetSnapshotSync.resyncNow()');
    expect(discard).toContain('if (result.ok) void widgetSnapshotSync.resyncNow()');
  });

  it('reacts to program, schedule, locale, and foreground changes', () => {
    expect(syncHook).toContain('input.programIdentity');
    expect(syncHook).toContain('scheduleResolutionKey');
    expect(syncHook).toContain('locale');
    expect(syncHook).toContain("nextState === 'active'");
  });
});
