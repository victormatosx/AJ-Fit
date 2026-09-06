import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({ logger: loggerMocks }));

import {
  recordWorkoutLifecycleTelemetryHandler,
  validateWorkoutLifecycleTelemetryEvent,
} from '../workoutLifecycleTelemetry';

describe('Workout Lifecycle telemetry callable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts an authenticated client diagnostic and logs no user identifier', async () => {
    await expect(recordWorkoutLifecycleTelemetryHandler({
      auth: { uid: 'secret-user-id' },
      data: { event: { name: 'lifecycle_reconcile_started', trigger: 'COLD_START' } },
    } as never)).resolves.toEqual({ accepted: true, trustLevel: 'CLIENT_DIAGNOSTIC' });
    expect(loggerMocks.info).toHaveBeenCalledWith('[workout-lifecycle] lifecycle_reconcile_started', {
      trigger: 'COLD_START', trustLevel: 'CLIENT_DIAGNOSTIC',
    });
    expect(JSON.stringify(loggerMocks.info.mock.calls)).not.toContain('secret-user-id');
  });

  it.each([
    'lifecycle_reconcile_started',
    'lifecycle_reconcile_completed',
    'lifecycle_reconcile_failed',
  ])('accepts trigger FOREGROUND for %s (background -> active resume reconciliation)', (name) => {
    const base: Record<string, unknown> = { name, trigger: 'FOREGROUND' };
    if (name === 'lifecycle_reconcile_completed') base.outcome = 'NO_ACTION';
    if (name === 'lifecycle_reconcile_failed') {
      base.errorCategory = 'NETWORK';
      base.retryable = true;
    }
    expect(() => validateWorkoutLifecycleTelemetryEvent(base)).not.toThrow();
  });

  it.each([
    'lifecycle_reconcile_started',
    'lifecycle_reconcile_completed',
    'lifecycle_reconcile_failed',
  ])('still rejects an unknown trigger value for %s', (name) => {
    const base: Record<string, unknown> = { name, trigger: 'SOME_UNKNOWN_TRIGGER' };
    if (name === 'lifecycle_reconcile_completed') base.outcome = 'NO_ACTION';
    if (name === 'lifecycle_reconcile_failed') {
      base.errorCategory = 'NETWORK';
      base.retryable = true;
    }
    expect(() => validateWorkoutLifecycleTelemetryEvent(base)).toThrow();
  });

  it.each(['level_promoted', 'evolution_activated', 'progression_evaluated'])(
    'rejects a client attempt to fabricate trusted-domain event %s',
    async (name) => {
      await expect(recordWorkoutLifecycleTelemetryHandler({
        auth: { uid: 'attacker' }, data: { event: { name } },
      } as never)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(loggerMocks.info).not.toHaveBeenCalled();
    },
  );

  it('requires Firebase Auth', async () => {
    await expect(recordWorkoutLifecycleTelemetryHandler({
      auth: null,
      data: { event: { name: 'motivational_renewal', trigger: 'AUTO' } },
    } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects an oversized diagnostic payload', async () => {
    await expect(recordWorkoutLifecycleTelemetryHandler({
      auth: { uid: 'attacker' },
      data: {
        event: {
          name: 'progression_failed', stage: 'EVALUATION',
          errorCategory: 'X'.repeat(65), retryable: true,
        },
      },
    } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(loggerMocks.info).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'lifecycle_reconcile_started', trigger: 'COLD_START', email: 'person@example.com' },
    { name: 'lifecycle_reconcile_completed', trigger: 'COLD_START', outcome: 'NO_ACTION', questionnaire: {} },
    { name: 'progression_failed', stage: 'MIGRATION', errorCategory: 'raw free form message!', retryable: true },
  ])('rejects unknown, nested, PII, or free-form fields: %o', (event) => {
    expect(() => validateWorkoutLifecycleTelemetryEvent(event)).toThrow();
  });

  it('validates rollout boundaries at the backend contract too', () => {
    expect(validateWorkoutLifecycleTelemetryEvent({
      name: 'lifecycle_rollout_decision', decision: 'ENROLLED', bucket: 99, percentage: 100,
    })).toEqual({ name: 'lifecycle_rollout_decision', payload: { decision: 'ENROLLED', bucket: 99, percentage: 100 } });
    expect(() => validateWorkoutLifecycleTelemetryEvent({
      name: 'lifecycle_rollout_decision', decision: 'ENROLLED', bucket: '99', percentage: 100,
    })).toThrow();
  });
});
