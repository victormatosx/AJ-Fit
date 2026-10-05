import { describe, expect, it } from 'vitest';

import {
  furthestWorkoutFinalizationStage,
  serverCheckpointFromSidecar,
  WORKOUT_FINALIZATION_PROGRESS,
} from '../finalizationProgress';

describe('workout finalization progress', () => {
  it('maps only durable checkpoints to fixed percentages', () => {
    expect(WORKOUT_FINALIZATION_PROGRESS).toEqual({
      WAITING: 0,
      CLIENT_READY: 25,
      SERVER_ACCEPTED: 50,
      PREFLIGHT_VALIDATED: 75,
      COMMITTED: 100,
    });
  });

  it('jumps forward but never regresses when snapshots arrive out of order', () => {
    expect(furthestWorkoutFinalizationStage('WAITING', 'PREFLIGHT_VALIDATED')).toBe('PREFLIGHT_VALIDATED');
    expect(furthestWorkoutFinalizationStage('PREFLIGHT_VALIDATED', 'SERVER_ACCEPTED')).toBe('PREFLIGHT_VALIDATED');
    expect(furthestWorkoutFinalizationStage('PREFLIGHT_VALIDATED', 'COMMITTED')).toBe('COMMITTED');
  });

  it('selects the furthest real checkpoint from out-of-order sidecar writes', () => {
    expect(serverCheckpointFromSidecar({
      checkpoints: { COMMITTED: {}, SERVER_ACCEPTED: {} },
    })).toBe('COMMITTED');
    expect(serverCheckpointFromSidecar({ checkpoints: { PREFLIGHT_VALIDATED: {} } }))
      .toBe('PREFLIGHT_VALIDATED');
    expect(serverCheckpointFromSidecar({ stage: 'SERVER_ACCEPTED' })).toBeNull();
  });
});
