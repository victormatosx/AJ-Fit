import { describe, expect, it } from 'vitest';
import {
  createCardioSession,
  extendCardioTarget,
  finishCardio,
  pauseCardio,
  resumeCardio,
  startCardio,
} from '../../lib/cardioTimer';
import {
  REST_ACTIVITY_NEXT_ACTION,
  REST_ACTIVITY_PHASE,
} from '../../types/restLiveActivity';
import { projectCardioActivityState } from '../cardioActivityProjection';

const base = () => createCardioSession({
  cardioSessionId: 'cardio-1',
  workoutSessionId: 'owner-1',
  plannedDurationSeconds: 600,
});

const project = (session: ReturnType<typeof base>, nowMs: number) =>
  projectCardioActivityState({
    session,
    workoutSessionId: 'execution-1',
    workoutName: 'Treino 01 - Full body',
    cardioName: 'Esteira',
    nowMs,
  });

describe('projectCardioActivityState', () => {
  it('projects a running absolute deadline on the shared workout activity', () => {
    const state = project(startCardio(base(), 10_000), 70_000);
    expect(state).toMatchObject({
      sessionId: 'execution-1',
      startedAt: 10_000,
      endsAt: 610_000,
      phase: REST_ACTIVITY_PHASE.CARDIO_RUNNING,
      nextAction: REST_ACTIVITY_NEXT_ACTION.FINISH_WORKOUT,
    });
    expect(state).not.toHaveProperty('remainingSeconds');
  });

  it('freezes the remaining duration while paused and resumes at a new deadline', () => {
    const paused = pauseCardio(startCardio(base(), 0), 120_000);
    const pausedState = project(paused, 300_000);
    expect(pausedState.phase).toBe(REST_ACTIVITY_PHASE.CARDIO_PAUSED);
    expect(pausedState.endsAt - pausedState.startedAt).toBe(480_000);

    const resumed = resumeCardio(paused, 300_000);
    const resumedState = project(resumed, 330_000);
    expect(resumedState.phase).toBe(REST_ACTIVITY_PHASE.CARDIO_RUNNING);
    expect(resumedState.endsAt).toBe(780_000);
  });

  it('projects target reached and explicit finish as awaiting workout finalization', () => {
    const running = startCardio(base(), 0);
    expect(project(running, 600_000).phase).toBe(REST_ACTIVITY_PHASE.CARDIO_COMPLETED);
    expect(project(finishCardio(running, 300_000), 300_000).phase)
      .toBe(REST_ACTIVITY_PHASE.CARDIO_COMPLETED);
  });

  it('returns to running after extending a reached target', () => {
    const running = startCardio(base(), 0);
    const extended = extendCardioTarget(running, 300);
    expect(project(extended, 600_000).phase).toBe(REST_ACTIVITY_PHASE.CARDIO_RUNNING);
  });
});
