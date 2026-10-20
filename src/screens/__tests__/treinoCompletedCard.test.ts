import { describe, expect, it } from 'vitest';
import { completedSessionIndexForLocalDate } from '../../scheduleEngine/completedSessionIndex';
import { treinoCardSession } from '../treinoCardSession';

const sessions = ['Empurrar', 'Puxar', 'Pernas', 'Superiores Extra', 'Inferiores Extra'];
const completedResolution = {
  status: 'TODAY_COMPLETED' as const,
  nextSessionIndex: 1,
  nextWorkoutDate: '2026-10-08',
};

describe('TREINO completed card', () => {
  it('shows the execution completed today, not the next cursor session', () => {
    const completedIndex = completedSessionIndexForLocalDate([
      { status: 'COMPLETED', programInstanceId: 'instance-1', scheduledLocalDate: '2026-10-06', sessionIndex: 0 },
    ], 'instance-1', '2026-10-06', sessions.length);
    expect(completedIndex).toBe(0);
    expect(treinoCardSession(sessions, completedResolution, completedIndex)).toBe('Empurrar');
    expect(sessions[completedResolution.nextSessionIndex]).toBe('Puxar');
  });

  it('does not invent a completed session from the cursor when the fact is absent', () => {
    expect(treinoCardSession(sessions, completedResolution, null)).toBeNull();
  });

  it('remains correct if a later reposition makes nextIndex - 1 unrelated to the completion', () => {
    const afterReposition = { ...completedResolution, nextSessionIndex: 4 };
    expect(treinoCardSession(sessions, afterReposition, 0)).toBe('Empurrar');
    expect(sessions[afterReposition.nextSessionIndex]).toBe('Inferiores Extra');
  });

  /**
   * Regression (2026-10-18): an advanced session carries a future
   * `scheduledLocalDate`, so matching that date found nothing on the day the
   * user actually trained and the card lost its title, muscle list, body map
   * and metrics — everything derived from the session.
   */
  it('finds a session advanced onto an earlier day, by the date it was performed', () => {
    const advanced = [{
      status: 'COMPLETED',
      programInstanceId: 'instance-1',
      scheduledLocalDate: '2026-10-19',
      performedLocalDate: '2026-10-18',
      sessionIndex: 0,
    }];
    // The day of the effort finds it...
    expect(completedSessionIndexForLocalDate(advanced, 'instance-1', '2026-10-18', sessions.length)).toBe(0);
    // ...and the opportunity's own day does not: nothing was performed then.
    expect(completedSessionIndexForLocalDate(advanced, 'instance-1', '2026-10-19', sessions.length)).toBeNull();
    expect(treinoCardSession(sessions, completedResolution, 0)).toBe('Empurrar');
  });

  it('ignores executions from a different date, instance, or nonterminal status', () => {
    expect(completedSessionIndexForLocalDate([
      { status: 'COMPLETED', programInstanceId: 'instance-1', scheduledLocalDate: '2026-10-05', sessionIndex: 0 },
      { status: 'COMPLETED', programInstanceId: 'instance-2', scheduledLocalDate: '2026-10-06', sessionIndex: 0 },
      { status: 'IN_PROGRESS', programInstanceId: 'instance-1', scheduledLocalDate: '2026-10-06', sessionIndex: 0 },
    ], 'instance-1', '2026-10-06', sessions.length)).toBeNull();
  });

  it('still displays the next session in a ready state', () => {
    expect(treinoCardSession(sessions, { status: 'SESSION_READY', sessionIndex: 1 }, 0)).toBe('Puxar');
  });
});
