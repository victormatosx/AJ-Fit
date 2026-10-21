import { defaultQuiz, WEEKDAY_ORDER, type Quiz, type Weekday } from '../src/state/AppState';
import { generateWorkoutPrescription } from '../src/workoutPrescription/engine';

const equipment = ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'];
const weekdays = (count: number): Weekday[] => WEEKDAY_ORDER.slice(0, count);
const base: Quiz = {
  ...defaultQuiz,
  sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 7,
  trainingDays: [...WEEKDAY_ORDER], duration: '60', place: 'gym', specialConditions: ['none'],
};

const personas: Array<[string, Partial<Quiz>]> = [
  ['male gym hypertrophy availability 2 beginner', { days: 2, trainingDays: weekdays(2), level: 'beginner' }],
  ['male gym hypertrophy availability 3 beginner', { days: 3, trainingDays: weekdays(3), level: 'beginner' }],
  ['male gym hypertrophy availability 4 beginner', { days: 4, trainingDays: weekdays(4), level: 'beginner' }],
  ['male gym hypertrophy availability 5 beginner', { days: 5, trainingDays: weekdays(5), level: 'beginner' }],
  ['male gym hypertrophy availability 6 beginner', { days: 6, trainingDays: weekdays(6), level: 'beginner' }],
  ['male gym hypertrophy availability 7 beginner', { level: 'beginner' }],
  ['male gym hypertrophy availability 7 intermediate', { level: 'intermediate' }],
  ['male gym hypertrophy availability 7 advanced', { level: 'advanced' }],
  ['female gym hypertrophy availability 7 beginner', { sex: 'f', level: 'beginner' }],
  ['female gym hypertrophy availability 7 advanced', { sex: 'f', level: 'advanced' }],
  ['home availability 7 beginner', { place: 'home', equipment, level: 'beginner' }],
  ['home availability 7 experienced', { place: 'home', equipment, level: 'advanced' }],
  ['strength availability 7 experienced', { goal: 'strength', level: 'advanced' }],
  ['conditioning availability 7', { goal: 'conditioning' }],
  ['pregnancy availability 7', { sex: 'f', specialConditions: ['pregnancy'], pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] } }],
  ['postpartum availability 7', { sex: 'f', specialConditions: ['postpartum'], postpartumScreening: { timeSinceBirth: '3_6_months', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' } }],
  ['frailty availability 7', { specialConditions: ['functional_limitation'], functionalScreening: { situations: ['stairs_difficulty'] } }],
];

const rows = personas.map(([persona, overrides]) => {
  const questionnaire = { ...base, ...overrides };
  const result = generateWorkoutPrescription(questionnaire);
  if (result.status !== 'SUCCESS') return { persona, status: result.status, reasonCodes: result.reasonCodes };
  const { plan } = result;
  const stateCount = (state: 'TRAINING' | 'ACTIVE_RECOVERY' | 'REST') =>
    plan.weeklySchedule?.filter((day) => day.state === state).length ?? 0;
  return {
    persona,
    availability: plan.availability?.days,
    availableWeekdays: plan.availability?.weekdays,
    prescribedFrequency: plan.prescribedTrainingFrequency,
    template: plan.templateId,
    trainingCount: stateCount('TRAINING'),
    activeRecoveryCount: stateCount('ACTIVE_RECOVERY'),
    restCount: stateCount('REST'),
    weeklyLayout: plan.weeklySchedule?.map((day) => `${day.weekday}:${day.state}`),
    sessionExerciseCounts: plan.sessions.map((session) => session.exercises.length),
    cardioFinishers: plan.sessions.filter((session) => session.cardioFinisher).length,
    substitutions: plan.trace.substitutions.length,
    status: result.status,
  };
});

const successful = rows.filter((row) => row.status === 'SUCCESS');
const summary = {
  personasEvaluated: rows.length,
  successful: successful.length,
  prescribedAboveAvailability: successful.filter((row) =>
    Number(row.prescribedFrequency) > Number(row.availability)).length,
  sevenTrainingWithAvailabilitySeven: successful.filter((row) =>
    row.availability === 7 && row.trainingCount === 7).length,
  trainingOnUnavailableWeekday: successful.filter((row) => {
    const available = new Set(row.availableWeekdays);
    return row.weeklyLayout?.some((entry) => {
      const [day, state] = entry.split(':');
      return state === 'TRAINING' && !available.has(day as Weekday);
    });
  }).length,
  conventionalAvailabilitySevenWithoutRest: successful.filter((row) =>
    row.availability === 7
    && !row.persona.includes('pregnancy')
    && !row.persona.includes('postpartum')
    && !row.persona.includes('frailty')
    && row.restCount === 0).length,
};

console.log(JSON.stringify({ summary, personas: rows }, null, 2));
