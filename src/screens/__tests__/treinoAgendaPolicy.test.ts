import { describe, expect, it } from 'vitest';

import { agendaChangeRequiresAdaptation } from '../treinoAgendaPolicy';

describe('Treino agenda policy', () => {
  it('edits the calendar only when fixed days change but frequency stays equal', () => {
    expect(agendaChangeRequiresAdaptation({
      scheduleMode: 'fixed', days: 3, trainingDays: ['TUE', 'THU', 'SAT'],
    }, 3)).toBe(false);
  });

  it('requires ADAPT when the selected fixed-day count changes', () => {
    expect(agendaChangeRequiresAdaptation({
      scheduleMode: 'fixed', days: 4, trainingDays: ['MON', 'TUE', 'THU', 'FRI'],
    }, 3)).toBe(true);
  });

  it('does not adapt for fixed to flexible when frequency is preserved', () => {
    expect(agendaChangeRequiresAdaptation({ scheduleMode: 'flexible', days: 3, trainingDays: null }, 3)).toBe(false);
  });

  it('does not adapt for flexible to fixed when frequency is preserved', () => {
    expect(agendaChangeRequiresAdaptation({
      scheduleMode: 'fixed', days: 3, trainingDays: ['MON', 'WED', 'FRI'],
    }, 3)).toBe(false);
  });
});
