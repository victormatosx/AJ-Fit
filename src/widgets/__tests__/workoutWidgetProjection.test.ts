import { describe, expect, it } from 'vitest';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';
import { buildWorkoutWidgetData, type WorkoutWidgetProjectionInput } from '../workoutWidgetProjection';

const sessions: FinalWorkoutSession[] = [
  {
    name: 'Lower 1', type: 'resistance', displayName: 'Quadríceps e panturrilha',
    exercises: [
      { exerciseId: 'incline-dumbbell-bench-press', sets: 4 },
      { exerciseId: 'bench-dips', sets: 3 },
      { exerciseId: 'incline-dumbbell-bench-press', sets: 2 },
    ] as FinalWorkoutSession['exercises'],
  },
  {
    name: 'Upper 1', type: 'resistance',
    exercises: [{ exerciseId: 'bench-dips', sets: 5 }] as FinalWorkoutSession['exercises'],
  },
];

const base: WorkoutWidgetProjectionInput = {
  scheduleMode: 'fixed',
  todayLocalDate: '2026-10-04',
  timezone: 'America/Sao_Paulo',
  generatedAtMs: Date.UTC(2026, 9, 4, 12),
  sex: 'f',
  sessions,
  resolution: { status: 'SESSION_READY', sessionIndex: 0 },
  activeExecution: null,
  copy: {
    nextWorkout: 'PRÓXIMO TREINO', inProgress: 'TREINO EM ANDAMENTO', today: 'HOJE',
    exercises: (count) => `${count} ${count === 1 ? 'EXERCÍCIO' : 'EXERCÍCIOS'}`,
    sets: (count) => `${count} ${count === 1 ? 'SÉRIE' : 'SÉRIES'}`,
  },
  resolveSessionName: (session) => session.displayName ?? session.name,
  formatDate: (date) => `DATA:${date}`,
};

describe('buildWorkoutWidgetData', () => {
  it('uses the Schedule Engine session for today and counts the real prescription', () => {
    const result = buildWorkoutWidgetData(base);
    expect(result).toMatchObject({
      state: 'NEXT', dateLabel: 'HOJE', workoutName: 'Quadríceps e panturrilha',
      exerciseCount: 3, setCount: 9,
      metricsLabel: '3 EXERCÍCIOS · 9 SÉRIES',
      bodyMap: { sex: 'f', primaryMuscles: ['chest', 'triceps'] },
    });
    expect(result?.dateBecomesTodayAtMs).toBe(new Date('2026-10-04T03:00:00.000Z').getTime());
  });

  it('uses nextWorkoutDate and nextSessionIndex without walking the schedule itself', () => {
    const result = buildWorkoutWidgetData({
      ...base,
      resolution: { status: 'REST_DAY', nextWorkoutDate: '2026-10-06', nextSessionIndex: 1 },
    });
    expect(result).toMatchObject({
      workoutName: 'Upper 1', dateLabel: 'DATA:2026-10-06', todayLabel: 'HOJE', setCount: 5,
      exercisesLabel: '1 EXERCÍCIO', setsLabel: '5 SÉRIES',
      dateBecomesTodayAtMs: new Date('2026-10-06T03:00:00.000Z').getTime(),
    });
  });

  it('omits the date for flexible training', () => {
    const result = buildWorkoutWidgetData({ ...base, scheduleMode: 'flexible' });
    expect(result?.dateLabel).toBeNull();
    expect(result?.dateBecomesTodayAtMs).toBeNull();
  });

  it('gives an authoritative IN_PROGRESS execution priority over the next session', () => {
    const result = buildWorkoutWidgetData({
      ...base,
      activeExecution: {
        status: 'IN_PROGRESS', sessionName: 'Treino congelado na execução',
        exercises: [
          { exerciseId: 'incline-dumbbell-bench-press', sets: [{}, {}, {}] },
          { exerciseId: 'bench-dips', sets: [{}, {}] },
        ],
      },
    });
    expect(result).toMatchObject({
      state: 'IN_PROGRESS', eyebrow: 'TREINO EM ANDAMENTO', dateLabel: null,
      workoutName: 'Treino congelado na execução', exerciseCount: 2, setCount: 5,
    });
    expect(result?.bodyMap).toMatchObject({ sex: 'f', primaryMuscles: ['chest', 'triceps'] });
  });

  it('does not guess while a missed-session decision has two valid outcomes', () => {
    expect(buildWorkoutWidgetData({
      ...base,
      resolution: {
        status: 'MISSED_SESSION_DECISION_REQUIRED', missedSessionIndex: 0,
        calendarSessionIndex: 1, missedScheduledDate: '2026-10-02',
      },
    })).toBeNull();
  });

  it('uses singular labels for one prescribed exercise and one prescribed set', () => {
    const result = buildWorkoutWidgetData({
      ...base,
      sessions: [{ ...sessions[1], exercises: [{ exerciseId: 'only', sets: 1 }] as FinalWorkoutSession['exercises'] }],
      resolution: { status: 'SESSION_READY', sessionIndex: 0 },
    });
    expect(result).toMatchObject({ exercisesLabel: '1 EXERCÍCIO', setsLabel: '1 SÉRIE' });
    expect(result?.bodyMap).toBeNull();
  });
});
