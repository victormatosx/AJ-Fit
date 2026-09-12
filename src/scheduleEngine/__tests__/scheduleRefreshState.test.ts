import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyScheduleReloadOutcome,
  type ScheduleRefreshProjection,
} from '../scheduleRefreshState';

const sessionReady: ScheduleRefreshProjection = {
  resolution: {
    status: 'SESSION_READY',
    sessionIndex: 1,
  },
  refreshError: null,
};

describe('Schedule refresh authority', () => {
  it('preserves the previous SESSION_READY when the newest reload fails offline', () => {
    expect(applyScheduleReloadOutcome(sessionReady, 2, {
      kind: 'failure',
      reloadId: 2,
      error: { code: 'unavailable', errorClass: 'FirebaseError' },
    })).toEqual({
      resolution: sessionReady.resolution,
      refreshError: { code: 'unavailable', errorClass: 'FirebaseError' },
    });
  });

  it('accepts an authoritative PROGRAM_NOT_AVAILABLE response', () => {
    expect(applyScheduleReloadOutcome(sessionReady, 2, {
      kind: 'success',
      reloadId: 2,
      resolution: { status: 'PROGRAM_NOT_AVAILABLE' },
    })).toEqual({
      resolution: { status: 'PROGRAM_NOT_AVAILABLE' },
      refreshError: null,
    });
  });

  it('ignores both success and failure from an older out-of-order reload', () => {
    const current = applyScheduleReloadOutcome(sessionReady, 2, {
      kind: 'success',
      reloadId: 2,
      resolution: { status: 'TODAY_COMPLETED', nextSessionIndex: 2, nextWorkoutDate: '2026-09-14' },
    });
    expect(applyScheduleReloadOutcome(current, 2, {
      kind: 'failure',
      reloadId: 1,
      error: { code: 'unavailable', errorClass: 'FirebaseError' },
    })).toBe(current);
    expect(applyScheduleReloadOutcome(current, 2, {
      kind: 'success',
      reloadId: 1,
      resolution: sessionReady.resolution,
    })).toBe(current);
  });

  it('does not invent a startable session when no authoritative SESSION_READY exists', () => {
    const initial: ScheduleRefreshProjection = {
      resolution: { status: 'PROGRAM_NOT_AVAILABLE' },
      refreshError: null,
    };
    const failed = applyScheduleReloadOutcome(initial, 1, {
      kind: 'failure',
      reloadId: 1,
      error: { code: 'unavailable', errorClass: 'FirebaseError' },
    });
    expect(failed.resolution.status).toBe('PROGRAM_NOT_AVAILABLE');
    expect(failed.resolution.status).not.toBe('SESSION_READY');
  });

  it('gates resolution, config and loading publication against the latest reload id', () => {
    const hook = readFileSync(new URL('../useWorkoutSchedule.ts', import.meta.url), 'utf8');
    const catchStart = hook.indexOf('const refreshError = {');
    const catchEnd = hook.indexOf('} finally {', catchStart);
    const failedReload = hook.slice(catchStart, catchEnd);

    expect(failedReload).toContain("kind: 'failure'");
    expect(failedReload).not.toContain('setResolution(notAvailable)');
    expect(hook).toContain('if (reloadId === reloadSequenceRef.current) setConfig(effectiveConfig);');
    expect(hook).toContain('if (reloadId === reloadSequenceRef.current) setLoading(false);');
  });
});
