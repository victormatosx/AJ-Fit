import type { WeeklyScheduleValue } from '../onboarding/weeklyScheduleSelection';

export function agendaChangeRequiresAdaptation(value: WeeklyScheduleValue, currentFrequency: number): boolean {
  const selectedFrequency = value.scheduleMode === 'flexible'
    ? value.days ?? currentFrequency
    : value.trainingDays?.length ?? 0;
  return selectedFrequency !== currentFrequency;
}
