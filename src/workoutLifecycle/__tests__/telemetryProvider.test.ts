import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('../../lib/logger', () => ({
  errorClass: () => 'Error', errorCode: () => undefined, logError: mocks.logError,
}));

import {
  createCloudLoggingWorkoutLifecycleTelemetryLogger,
  WORKOUT_LIFECYCLE_TELEMETRY_CALLABLE,
} from '../telemetryProvider';
import {
  logWorkoutLifecycleEvent,
  resetWorkoutLifecycleTelemetryLogger,
  setWorkoutLifecycleTelemetryLogger,
  type WorkoutLifecycleTelemetryEvent,
} from '../telemetry';

describe('workout lifecycle production telemetry adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkoutLifecycleTelemetryLogger();
  });

  it('forwards the centralized event contract to the real callable name', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { accepted: true, trustLevel: 'CLIENT_DIAGNOSTIC' } });
    mocks.httpsCallable.mockReturnValue(callable);
    const logger = createCloudLoggingWorkoutLifecycleTelemetryLogger();
    const event = { name: 'lifecycle_reconcile_started' as const, trigger: 'COLD_START' as const };

    logger.log(event);
    await vi.waitFor(() => expect(callable).toHaveBeenCalledWith({ event }));
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, WORKOUT_LIFECYCLE_TELEMETRY_CALLABLE);
  });

  it('forwards every client-diagnostic event through one adapter', async () => {
    const sender = vi.fn().mockResolvedValue({ data: { accepted: true } });
    setWorkoutLifecycleTelemetryLogger(createCloudLoggingWorkoutLifecycleTelemetryLogger(sender));
    const events: WorkoutLifecycleTelemetryEvent[] = [
      { name: 'lifecycle_rollout_decision', decision: 'ENROLLED', bucket: 10, percentage: 50 },
      { name: 'lifecycle_reconcile_started', trigger: 'COLD_START' },
      { name: 'lifecycle_reconcile_completed', trigger: 'COLD_START', outcome: 'NO_ACTION' },
      { name: 'progression_failed', stage: 'EVALUATION', errorCategory: 'ERROR', retryable: true },
      { name: 'migration_failed', errorCategory: 'MIGRATION_ERROR', retryable: true },
      { name: 'lifecycle_reconcile_failed', trigger: 'RECOVERY', errorCategory: 'ERROR', retryable: true },
      { name: 'lifecycle_stale_prepare_rejected', reason: 'CONCURRENT_WRITE' },
    ];

    events.forEach(logWorkoutLifecycleEvent);

    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(events.length));
    expect(sender.mock.calls.map(([event]) => event.name)).toEqual(events.map(({ name }) => name));
  });

  it('never lets provider failure throw into or block the domain caller', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('private provider details'));
    setWorkoutLifecycleTelemetryLogger(createCloudLoggingWorkoutLifecycleTelemetryLogger(sender));

    expect(() => logWorkoutLifecycleEvent({
      name: 'lifecycle_reconcile_failed', trigger: 'RECOVERY', errorCategory: 'ERROR', retryable: true,
    })).not.toThrow();
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalled());
    expect(mocks.logError.mock.calls.flat().join(' ')).not.toContain('private provider details');
  });

  it('diagnoses an unconfigured provider instead of silently defaulting to a no-op', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_started', trigger: 'RECOVERY' });
    logWorkoutLifecycleEvent({ name: 'lifecycle_reconcile_started', trigger: 'RECOVERY' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
