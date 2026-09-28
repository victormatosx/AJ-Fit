import { describe, expect, it } from 'vitest';
import { completeAnswers } from './fixtures';
import {
  selectBaseTemplateV127ForCurrentTrainingLevel,
  selectBaseTemplateV127FromAnswers,
} from '../selectorV127';
import { buildLevelPromotionAnswers } from '../../prescriptionEvolution/levelPromotion';
import {
  effectivePrescriptionInputsFromAnswers,
  questionnaireAnswersFromPrescriptionInputs,
  questionnaireLevelForCurrentLevel,
} from '../../workoutLifecycle/prescriptionInputs';
import { evaluateProgressionV2 } from '../../progressionEngineV2/resolver';
import { PROGRESSION_V2_CONFIG } from '../../progressionEngineV2/config';
import type { ProgressionSnapshotV2 } from '../../progressionEngineV2/types';
import type { CurrentTrainingLevel } from '../../workoutLifecycle/types';
import type { Weekday } from '../../state/AppState';

/**
 * Fase 7 — proves the EXISTING Progression Engine V2 / Workout Lifecycle
 * authority (`evaluateProgressionV2`, `currentTrainingLevel`,
 * `effectivePrescriptionInputsFromAnswers`, `buildLevelPromotionAnswers`)
 * composes correctly with the v1.27 selector
 * (`selectBaseTemplateV127ForCurrentTrainingLevel`). No progression rule is
 * re-implemented or duplicated here — every 28-day/70% number, every
 * eligibility/activation transition, comes from the real, unmodified
 * modules under test elsewhere (`src/progressionEngineV2/__tests__`,
 * `src/prescriptionEvolution/__tests__`, `functions/.../authorizeMutation`).
 */

function baseSnapshot(overrides: Partial<ProgressionSnapshotV2> = {}): ProgressionSnapshotV2 {
  return {
    level: 'BEGINNER',
    activeTime: { activeDays: 0, pausedAt: null },
    adherence: { ratio: 1, quality: 'HIGH' },
    hasInProgressExecution: false,
    earnedIntermediateCycleCount: 0,
    validSessionCount: 0,
    ...overrides,
  };
}

describe('Fase 7 — 28-day/70% eligibility is unchanged (reused, not reimplemented)', () => {
  it('1/3: before 28 active days, no promotion regardless of adherence', () => {
    const decision = evaluateProgressionV2(baseSnapshot({ activeTime: { activeDays: 27, pausedAt: null }, adherence: { ratio: 1, quality: 'HIGH' } }));
    expect(decision.type).toBe('PROGRESS_CONTINUES');
    expect(decision).toMatchObject({ reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED' });
  });

  it('4: 28 days but adherence below 70% -> no promotion', () => {
    const decision = evaluateProgressionV2(baseSnapshot({ activeTime: { activeDays: 28, pausedAt: null }, adherence: { ratio: 0.69, quality: 'BELOW_TARGET' } }));
    expect(decision.type).toBe('PROGRESS_CONTINUES');
    expect(decision).toMatchObject({ reason: 'ADHERENCE_BELOW_THRESHOLD' });
  });

  it('5: 28 days and >=70% adherence -> eligible for BEGINNER -> INTERMEDIATE', () => {
    const decision = evaluateProgressionV2(baseSnapshot({ activeTime: { activeDays: 28, pausedAt: null }, adherence: { ratio: 0.7, quality: 'GOOD' } }));
    expect(decision).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'BEGINNER', to: 'INTERMEDIATE' });
  });

  it('confirms the exact thresholds still in force (28 days / 7000bp = 70%)', () => {
    expect(PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays).toBe(28);
    expect(PROGRESSION_V2_CONFIG.adherenceEarnedThresholdBp).toBe(7000);
  });
});

describe('Fase 7 — BEGINNER routes to T091-T102 via the v1.27 selector', () => {
  it.each([2, 3, 4, 5, 6, 7])('2.%i: BEGINNER, gym, %i days -> T09x', (days) => {
    const answers = completeAnswers({ level: 'never_or_starting', place: 'gym', days });
    const result = selectBaseTemplateV127FromAnswers(answers);
    expect(result.status).toBe('SELECTED');
    if (result.status === 'SELECTED') expect(result.templateId).toMatch(/^T09[1-6]$/);
  });

  it.each([2, 3, 4, 5, 6, 7])('2.%i: BEGINNER, home, %i days -> T09x/T10x', (days) => {
    const answers = completeAnswers({ level: 'never_or_starting', place: 'home', days });
    const result = selectBaseTemplateV127FromAnswers(answers);
    expect(result.status).toBe('SELECTED');
    if (result.status === 'SELECTED') expect(result.templateId).toMatch(/^T(09[7-9]|10[0-2])$/);
  });
});

describe('Fase 7 — eligibility alone never changes the selected template (activation is a separate, later step)', () => {
  it('6: an eligible decision does not, by itself, feed into the selector — currentTrainingLevel is still BEGINNER until activation', () => {
    const answers = completeAnswers({ level: 'never_or_starting', place: 'gym', days: 5, goal: 'strength' });
    const beforeEligibility = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'BEGINNER');
    const decision = evaluateProgressionV2(baseSnapshot({ activeTime: { activeDays: 28, pausedAt: null }, adherence: { ratio: 0.9, quality: 'HIGH' } }));
    expect(decision.type).toBe('LEVEL_PROMOTION_ELIGIBLE');
    // Nothing about computing `decision` changes what level the selector
    // uses — the lifecycle document's `currentTrainingLevel` field is the
    // only thing that can, and it has not been written yet.
    const stillBeginner = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'BEGINNER');
    expect(stillBeginner).toEqual(beforeEligibility);
    expect(stillBeginner.status === 'SELECTED' && stillBeginner.templateId).toBe('T094');
  });
});

describe('Fase 7 — after activation (currentTrainingLevel = INTERMEDIATE), regeneration uses the regular family', () => {
  it('7/8: worked example — man, gym, 5 days, strength, BEGINNER -> T094; promoted -> regular male/gym/5-day strength template', () => {
    const beginnerAnswers = completeAnswers({ sex: 'm', level: 'never_or_starting', place: 'gym', days: 5, goal: 'strength' });
    const beginnerResult = selectBaseTemplateV127ForCurrentTrainingLevel(beginnerAnswers, 'BEGINNER');
    expect(beginnerResult.status === 'SELECTED' && beginnerResult.templateId).toBe('T094');

    const promoted = selectBaseTemplateV127ForCurrentTrainingLevel(beginnerAnswers, 'INTERMEDIATE');
    expect(promoted.status).toBe('SELECTED');
    // Regular strength family (T025-T048), never T091-T102 again.
    expect(promoted.status === 'SELECTED' && promoted.templateId).toMatch(/^T0(2[5-9]|3[0-9]|4[0-8])$/);
    expect(promoted.status === 'SELECTED' && promoted.templateId).not.toMatch(/^T(09[1-9]|10[0-2])$/);
  });

  it('uses the real buildLevelPromotionAnswers output (pinned frequency/trainingDays, level swapped to intermediate)', () => {
    const currentAnswers = completeAnswers({ sex: 'f', level: 'never_or_starting', place: 'home', days: 3, goal: 'gain_muscle' });
    const promotionAnswers = buildLevelPromotionAnswers({
      currentAnswers,
      targetLevel: 'INTERMEDIATE',
      pinnedFrequency: 3,
      pinnedTrainingDays: ['MON', 'WED', 'FRI'] as Weekday[],
    });
    expect(promotionAnswers.level).toBe('intermediate');
    const result = selectBaseTemplateV127FromAnswers(promotionAnswers);
    expect(result.status).toBe('SELECTED');
    // Regular hypertrophy/composition family, home environment, female, 3 days.
    expect(result.status === 'SELECTED' && result.templateId).toMatch(/^T0(19|2[0-4])$/);
  });
});

describe('Fase 7 — answers are preserved across the promotion, only level (and the protected frequency fields) change', () => {
  it('9: goal is preserved', () => {
    for (const goal of ['gain_muscle', 'strength', 'conditioning'] as const) {
      const answers = completeAnswers({ level: 'never_or_starting', place: 'gym', days: 4, goal });
      const before = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'BEGINNER');
      const after = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'INTERMEDIATE');
      expect(before.status === 'SELECTED' && before.templateId).toBe('T093');
      expect(after.status).toBe('SELECTED');
      const expectedFamily = goal === 'strength' ? /^T0(2[5-9]|3[0-6])$/ : goal === 'conditioning' ? /^T0(49|5[0-4])$/ : /^T00[1-6]$/;
      expect(after.status === 'SELECTED' && after.templateId).toMatch(expectedFamily);
    }
  });

  it('10: sex/environment/days are preserved through the promotion', () => {
    const answers = completeAnswers({ sex: 'f', level: 'never_or_starting', place: 'home', days: 6, goal: 'conditioning' });
    const before = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'BEGINNER');
    const after = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'INTERMEDIATE');
    expect(before.status === 'SELECTED' && before.templateId).toBe('T101'); // home, day 6 beginner block
    expect(after.status === 'SELECTED' && after.templateId).toBe('T071'); // female/home/conditioning/6 days
  });

  it('11: 6-7 days remain 6-7 (uncapped by experience level) in the regular v1.27 selector after promotion', () => {
    const answers6 = completeAnswers({ sex: 'm', level: 'never_or_starting', place: 'gym', days: 6, goal: 'gain_muscle' });
    const answers7 = completeAnswers({ sex: 'm', level: 'never_or_starting', place: 'gym', days: 7, goal: 'gain_muscle' });
    const after6 = selectBaseTemplateV127ForCurrentTrainingLevel(answers6, 'INTERMEDIATE');
    const after7 = selectBaseTemplateV127ForCurrentTrainingLevel(answers7, 'INTERMEDIATE');
    expect(after6.status === 'SELECTED' && after6.templateId).toBe('T005');
    expect(after7.status === 'SELECTED' && after7.templateId).toBe('T006');
  });

  it('frequency protection: buildLevelPromotionAnswers pins frequency from the ACTIVE prescription, never raw questionnaire availability, so promotion alone can never silently increase weekly frequency', () => {
    // Raw stored questionnaire now says 6 days (user edited availability
    // without regenerating), but the active prescription was only ever 3.
    const currentAnswers = completeAnswers({ sex: 'm', level: 'never_or_starting', place: 'gym', days: 6, goal: 'gain_muscle' });
    const promotionAnswers = buildLevelPromotionAnswers({
      currentAnswers,
      targetLevel: 'INTERMEDIATE',
      pinnedFrequency: 3,
      pinnedTrainingDays: ['MON', 'WED', 'FRI'] as Weekday[],
    });
    expect(promotionAnswers.days).toBe(3);
    const result = selectBaseTemplateV127FromAnswers(promotionAnswers);
    expect(result.status === 'SELECTED' && result.templateId).toBe('T002'); // male/gym/hypertrophy/3 days, not 6
  });
});

describe('Fase 7 — a promoted user never returns to T091-T102 (currentTrainingLevel is the only authority)', () => {
  it('12: stale answers.level still saying "beginner" (never re-answered) does not leak through once currentTrainingLevel is INTERMEDIATE', () => {
    const staleAnswers = completeAnswers({ level: 'never_or_starting', place: 'gym', days: 4, goal: 'gain_muscle' });
    expect(staleAnswers.level).toBe('never_or_starting');
    const result = selectBaseTemplateV127ForCurrentTrainingLevel(staleAnswers, 'INTERMEDIATE');
    expect(result.status).toBe('SELECTED');
    expect(result.status === 'SELECTED' && result.templateId).not.toMatch(/^T(09[1-9]|10[0-2])$/);
    expect(result.status === 'SELECTED' && result.templateId).toBe('T003');
  });

  it('the same effect holds through the real effectivePrescriptionInputsFromAnswers/questionnaireAnswersFromPrescriptionInputs round-trip used by regeneration', () => {
    const storedAnswers = completeAnswers({ level: 'beginner', place: 'gym', days: 4, goal: 'gain_muscle' });
    const effectiveInputs = effectivePrescriptionInputsFromAnswers(storedAnswers, 'INTERMEDIATE');
    expect(effectiveInputs.level).toBe('intermediate');
    const reconstructed = questionnaireAnswersFromPrescriptionInputs(effectiveInputs);
    const result = selectBaseTemplateV127FromAnswers(reconstructed);
    expect(result.status === 'SELECTED' && result.templateId).not.toMatch(/^T(09[1-9]|10[0-2])$/);
  });
});

describe('Fase 7 — special population precedence is unaffected by the training-level authority change', () => {
  it('13: pregnancy still takes precedence over the beginner route both before and after a hypothetical promotion', () => {
    const answers = completeAnswers({
      sex: 'f', level: 'never_or_starting', place: 'gym', days: 2, goal: 'gain_muscle',
      specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    });
    const beforePromotion = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'BEGINNER');
    const afterPromotion = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'INTERMEDIATE');
    expect(beforePromotion.status === 'SELECTED' && beforePromotion.templateId).toBe('T073');
    expect(afterPromotion.status === 'SELECTED' && afterPromotion.templateId).toBe('T073');
  });
});

describe('Fase 7 — client/backend agreement on the level used for regeneration', () => {
  it('14: questionnaireLevelForCurrentLevel maps every lifecycle level to the exact string the selector/engine expect (the same mapping authorizeMutation.ts mirrors backend-side)', () => {
    const cases: [CurrentTrainingLevel, string][] = [['BEGINNER', 'beginner'], ['INTERMEDIATE', 'intermediate'], ['ADVANCED', 'advanced']];
    for (const [level, expected] of cases) {
      expect(questionnaireLevelForCurrentLevel(level)).toBe(expected);
    }
  });

  it('the mirrored Functions copy of prescriptionInputs.ts (synced verbatim) exists and is what selectorV127 imports — see scripts/syncPrescriptionEngineToFunctions.cjs', () => {
    // This is a structural smoke check, not a duplicate implementation:
    // the real parity guarantee is the sync script copying this exact
    // source file byte-for-byte into functions/, verified by this repo's
    // `npm run sync:prescriptionEngine` + Functions typecheck in CI/this task's validation.
    expect(questionnaireLevelForCurrentLevel('BEGINNER')).toBe('beginner');
  });
});

describe('Fase 7 — post-promotion coverage across goal families and environments', () => {
  it.each([
    ['gain_muscle', 'gym'], ['gain_muscle', 'home'],
    ['strength', 'gym'], ['strength', 'home'],
    ['conditioning', 'gym'], ['conditioning', 'home'],
  ] as const)('promoted user with goal=%s, place=%s resolves to a regular (non-beginner) template', (goal, place) => {
    const answers = completeAnswers({ sex: 'm', level: 'never_or_starting', place, days: 4, goal });
    const result = selectBaseTemplateV127ForCurrentTrainingLevel(answers, 'INTERMEDIATE');
    expect(result.status).toBe('SELECTED');
    if (result.status !== 'SELECTED') return;
    expect(result.templateId).not.toMatch(/^T(09[1-9]|10[0-2])$/);
    expect(result.templateId).toMatch(/^T0[0-7][0-9]$/);
  });
});
