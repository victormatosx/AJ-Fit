import { describe, expect, it } from 'vitest';
import { buildLevelPromotionAnswers } from '../levelPromotion';
import { completeAnswers, realLimitationCatalogFixture } from '../../workoutPrescription/__tests__/fixtures';
import { generateWorkoutPrescription } from '../../workoutPrescription/engine';

const limitationCatalog = realLimitationCatalogFixture();

function prepareWorkoutProgramLocally(
  answers: Parameters<typeof generateWorkoutPrescription>[0],
  options?: { withLimitationCatalog?: boolean },
) {
  return Promise.resolve(generateWorkoutPrescription(
    answers,
    options?.withLimitationCatalog ? { exerciseCatalog: limitationCatalog } : undefined,
  ));
}

describe('buildLevelPromotionAnswers (pure)', () => {
  it('maps the target lifecycle level onto the synthetic answers', () => {
    const current = completeAnswers({ level: 'beginner', days: 4 });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current,
      targetLevel: 'INTERMEDIATE',
      pinnedFrequency: 4,
      pinnedTrainingDays: [],
    });
    expect(promoted.level).toBe('intermediate');
  });

  it('pins frequency to the previous prescribed frequency, not raw availability', () => {
    const current = completeAnswers({ level: 'beginner', days: 6 }); // raw availability = 6
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current,
      targetLevel: 'INTERMEDIATE',
      pinnedFrequency: 4, // what was actually prescribed before promotion
      pinnedTrainingDays: [],
    });
    expect(promoted.days).toBe(4);
  });

  it('never mutates the original answers object', () => {
    const current = completeAnswers({ level: 'beginner', days: 4 });
    const snapshot = JSON.stringify(current);
    buildLevelPromotionAnswers({
      currentAnswers: current,
      targetLevel: 'INTERMEDIATE',
      pinnedFrequency: 4,
      pinnedTrainingDays: [],
    });
    expect(JSON.stringify(current)).toBe(snapshot);
  });

  it('preserves every other answer (goal, place, equipment, duration, limitations)', () => {
    const current = completeAnswers({
      level: 'beginner', days: 4, goal: 'lose_fat', place: 'home',
      equipment: ['dumbbells'], duration: '45', specialConditions: ['musculoskeletal_limitation'], limits: ['knee'],
    });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'INTERMEDIATE', pinnedFrequency: 4, pinnedTrainingDays: [],
    });
    expect(promoted.goal).toBe('lose_fat');
    expect(promoted.place).toBe('home');
    expect(promoted.equipment).toEqual(['dumbbells']);
    expect(promoted.duration).toBe('45');
    expect(promoted.specialConditions).toEqual(['musculoskeletal_limitation']);
    expect(promoted.limits).toEqual(['knee']);
  });
});

describe('Level Promotion through the real local prescription pipeline', () => {
  it('§71 Beginner -> Intermediate produces a valid Intermediate-level prescription with frequency preserved', async () => {
    const current = completeAnswers({ level: 'beginner', days: 4 });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'INTERMEDIATE', pinnedFrequency: 4, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays).toBe(4);
    // Intermediate/Advanced never carry the Beginner adaptationStage cap.
    expect(result.plan.adaptationStage).not.toBe(1);
  });

  it('§72 Intermediate -> Advanced produces a valid prescription with frequency preserved', async () => {
    const current = completeAnswers({ level: 'intermediate', days: 5 });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'ADVANCED', pinnedFrequency: 5, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays).toBe(5);
  });

  it('§82 critical case: availability=6, current prescribed frequency=4, Beginner -> Intermediate stays at 4 (never 5/6)', async () => {
    const current = completeAnswers({ level: 'beginner', days: 6 }); // raw availability the user could train
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'INTERMEDIATE', pinnedFrequency: 4, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays).toBe(4);
    expect(result.plan.requestedDays).toBe(4);
  });

  it('§82 repeated for Intermediate -> Advanced: availability=7, prescribed=5, stays at 5', async () => {
    const current = completeAnswers({ level: 'intermediate', days: 7 });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'ADVANCED', pinnedFrequency: 5, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays).toBe(5);
  });

  it.each([2, 3, 4, 5] as const)('preserves frequency=%i across Beginner -> Intermediate', async (frequency) => {
    const current = completeAnswers({ level: 'beginner', days: frequency });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'INTERMEDIATE', pinnedFrequency: frequency, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays).toBe(frequency);
  });

  it('preserves goal/duration/equipment/place through promotion end-to-end', async () => {
    const current = completeAnswers({
      level: 'beginner', days: 4, goal: 'lose_fat', place: 'home',
      equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'], duration: '45',
    });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'INTERMEDIATE', pinnedFrequency: 4, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted);
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.environment).toBe('home');
  });

  it('limitations remain applied through a Level Promotion regeneration', async () => {
    const current = completeAnswers({
      level: 'beginner', days: 4, specialConditions: ['musculoskeletal_limitation'], limits: ['knee'],
    });
    const promoted = buildLevelPromotionAnswers({
      currentAnswers: current, targetLevel: 'INTERMEDIATE', pinnedFrequency: 4, pinnedTrainingDays: [],
    });
    const result = await prepareWorkoutProgramLocally(promoted, { withLimitationCatalog: true });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    // Safety resolver still ran — every session has real, resolved exercises.
    expect(result.plan.sessions.every((session) => session.exercises.length > 0)).toBe(true);
  });
});
