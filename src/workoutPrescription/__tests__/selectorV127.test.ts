import { describe,expect,it } from 'vitest';
import {
  V127_TEMPLATE_PROFILES,
  selectBaseTemplateV127,
  selectBaseTemplateV127FromAnswers,
  type SelectBaseTemplateV127Input,
  type TemplateProfileV127,
} from '../selectorV127';
import type { GoalFamily,Population,TemplateEnvironment,TemplateId } from '../types';
import { completeAnswers } from './fixtures';

function baseInput(overrides: Partial<SelectBaseTemplateV127Input> = {}): SelectBaseTemplateV127Input {
  return {
    sex: 'male',
    environment: 'gym',
    goalFamily: 'hypertrophy_body_composition',
    population: 'conventional',
    isBeginner: false,
    availabilityDays: 4,
    ...overrides,
  };
}

function beginnerAnswers(overrides: Partial<ReturnType<typeof completeAnswers>> = {}) {
  return completeAnswers({ level: 'never_or_starting', ...overrides });
}

describe('selectBaseTemplateV127 — catalog completeness', () => {
  it('loads all 102 template profiles from the v1.27 canonical artifact', () => {
    expect(V127_TEMPLATE_PROFILES).toHaveLength(102);
    expect(new Set(V127_TEMPLATE_PROFILES.map((t) => t.id)).size).toBe(102);
  });
});

// Independent declarative expectation matrix — never derived by calling the
// selector under test, per the Fase 3 gate requirement.
function expectedRegularId(
  sex: 'male' | 'female', environment: TemplateEnvironment, goalFamily: GoalFamily, days: number,
): TemplateId {
  const sexBlock = sex === 'male' ? 0 : 1;
  const envBlock = environment === 'gym' ? 0 : 1;
  const familyBase: Record<GoalFamily, number> = {
    hypertrophy_body_composition: 0, strength: 24, conditioning: 48,
  };
  const offset = familyBase[goalFamily] + sexBlock * 12 + envBlock * 6 + (days - 2);
  return `T${String(offset + 1).padStart(3, '0')}` as TemplateId;
}

function expectedSpecialId(population: Exclude<Population, 'conventional'>, environment: TemplateEnvironment, days: number): TemplateId {
  const populationBase: Record<typeof population, number> = {
    pregnancy: 72, postpartum: 78, frailty: 84,
  } as Record<typeof population, number>;
  const envBlock = environment === 'gym' ? 0 : 1;
  const offset = populationBase[population] + envBlock * 3 + (days - 2);
  return `T${String(offset + 1).padStart(3, '0')}` as TemplateId;
}

function expectedBeginnerId(environment: TemplateEnvironment, days: number): TemplateId {
  const envBlock = environment === 'gym' ? 0 : 1;
  const offset = 90 + envBlock * 6 + (days - 2);
  return `T${String(offset + 1).padStart(3, '0')}` as TemplateId;
}

describe('selectBaseTemplateV127 — 102/102 reachability matrix', () => {
  const sexes: Array<'male' | 'female'> = ['male', 'female'];
  const environments: TemplateEnvironment[] = ['gym', 'home'];
  const goalFamilies: GoalFamily[] = ['hypertrophy_body_composition', 'strength', 'conditioning'];
  const days = [2, 3, 4, 5, 6, 7];
  const populations: Array<Exclude<Population, 'conventional'>> = ['pregnancy', 'postpartum', 'frailty'];
  const specialDays = [2, 3, 4, 5, 6, 7];

  const reached = new Set<TemplateId>();

  it('reaches all 72 regular templates (2 sex x 2 env x 3 family x 6 days)', () => {
    for (const sex of sexes) {
      for (const environment of environments) {
        for (const goalFamily of goalFamilies) {
          for (const availabilityDays of days) {
            const result = selectBaseTemplateV127(baseInput({ sex, environment, goalFamily, availabilityDays }));
            expect(result.status).toBe('SELECTED');
            if (result.status !== 'SELECTED') continue;
            expect(result.templateId).toBe(expectedRegularId(sex, environment, goalFamily, availabilityDays));
            reached.add(result.templateId);
          }
        }
      }
    }
    expect(reached.size).toBe(72);
  });

  it('reaches all 18 special-population templates (3 populations x 2 env x 3 effective days)', () => {
    const reachedSpecial = new Set<TemplateId>();
    for (const population of populations) {
      for (const environment of environments) {
        for (const availabilityDays of specialDays) {
          const result = selectBaseTemplateV127(baseInput({ population, environment, availabilityDays }));
          expect(result.status).toBe('SELECTED');
          if (result.status !== 'SELECTED') continue;
          const effectiveDays = Math.min(availabilityDays, 4);
          expect(result.templateId).toBe(expectedSpecialId(population, environment, effectiveDays));
          reachedSpecial.add(result.templateId);
        }
      }
    }
    expect(reachedSpecial.size).toBe(18);
  });

  it('reaches all 12 beginner templates (2 env x 6 days)', () => {
    const reachedBeginner = new Set<TemplateId>();
    for (const environment of environments) {
      for (const availabilityDays of days) {
        const result = selectBaseTemplateV127(baseInput({ isBeginner: true, environment, availabilityDays }));
        expect(result.status).toBe('SELECTED');
        if (result.status !== 'SELECTED') continue;
        expect(result.templateId).toBe(expectedBeginnerId(environment, availabilityDays));
        reachedBeginner.add(result.templateId);
      }
    }
    expect(reachedBeginner.size).toBe(12);
  });

  it('the three routes never collide and jointly reach exactly 102/102 with no arbitrary fallback', () => {
    const all = new Set<TemplateId>();
    for (const sex of sexes) for (const environment of environments) for (const goalFamily of goalFamilies) for (const availabilityDays of days) {
      const r = selectBaseTemplateV127(baseInput({ sex, environment, goalFamily, availabilityDays }));
      if (r.status === 'SELECTED') all.add(r.templateId);
    }
    for (const population of populations) for (const environment of environments) for (const availabilityDays of specialDays) {
      const r = selectBaseTemplateV127(baseInput({ population, environment, availabilityDays }));
      if (r.status === 'SELECTED') all.add(r.templateId);
    }
    for (const environment of environments) for (const availabilityDays of days) {
      const r = selectBaseTemplateV127(baseInput({ isBeginner: true, environment, availabilityDays }));
      if (r.status === 'SELECTED') all.add(r.templateId);
    }
    expect(all.size).toBe(102);
    const expectedAll = new Set(V127_TEMPLATE_PROFILES.map((t) => t.id));
    expect(all).toEqual(expectedAll);
  });
});

describe('selectBaseTemplateV127 — precedence', () => {
  it('pregnancy takes precedence over beginner', () => {
    const result = selectBaseTemplateV127(baseInput({ population: 'pregnancy', isBeginner: true, sex: 'female', environment: 'gym', availabilityDays: 2 }));
    expect(result.status).toBe('SELECTED');
    expect(result.status === 'SELECTED' && result.templateId).toBe('T073');
    expect(result.trace.some((line) => line.startsWith('population_route:pregnancy'))).toBe(true);
  });

  it('postpartum takes precedence over beginner', () => {
    const result = selectBaseTemplateV127(baseInput({ population: 'postpartum', isBeginner: true, sex: 'female', environment: 'gym', availabilityDays: 2 }));
    expect(result.status === 'SELECTED' && result.templateId).toBe('T079');
  });

  it('frailty takes precedence over beginner', () => {
    const result = selectBaseTemplateV127(baseInput({ population: 'frailty', isBeginner: true, environment: 'gym', availabilityDays: 2 }));
    expect(result.status === 'SELECTED' && result.templateId).toBe('T085');
  });

  it('beginner overrides goal family (strength, conditioning both resolve to the beginner route)', () => {
    const strength = selectBaseTemplateV127(baseInput({ isBeginner: true, goalFamily: 'strength', environment: 'gym', availabilityDays: 3 }));
    const conditioning = selectBaseTemplateV127(baseInput({ isBeginner: true, goalFamily: 'conditioning', environment: 'gym', availabilityDays: 3 }));
    expect(strength.status === 'SELECTED' && strength.templateId).toBe('T092');
    expect(conditioning.status === 'SELECTED' && conditioning.templateId).toBe('T092');
  });

  it('beginner does not differentiate by sex for the same environment/days', () => {
    const male = selectBaseTemplateV127(baseInput({ isBeginner: true, sex: 'male', environment: 'home', availabilityDays: 5 }));
    const female = selectBaseTemplateV127(baseInput({ isBeginner: true, sex: 'female', environment: 'home', availabilityDays: 5 }));
    expect(male).toEqual(female);
  });

  it('regular strength routes to T025-T048', () => {
    const result = selectBaseTemplateV127(baseInput({ goalFamily: 'strength', sex: 'male', environment: 'gym', availabilityDays: 2 }));
    expect(result.status === 'SELECTED' && result.templateId).toBe('T025');
  });

  it('regular conditioning routes to T049-T072', () => {
    const result = selectBaseTemplateV127(baseInput({ goalFamily: 'conditioning', sex: 'male', environment: 'gym', availabilityDays: 2 }));
    expect(result.status === 'SELECTED' && result.templateId).toBe('T049');
  });

  it('regular hypertrophy/composition routes to T001-T024', () => {
    const result = selectBaseTemplateV127(baseInput({ goalFamily: 'hypertrophy_body_composition', sex: 'male', environment: 'gym', availabilityDays: 2 }));
    expect(result.status === 'SELECTED' && result.templateId).toBe('T001');
  });
});

describe('selectBaseTemplateV127 — metamorphic invariants (non-selection dimensions)', () => {

  it('intermediate vs advanced experience never changes the regular-family template at 6/7 days', () => {
    const sixDayIntermediate = selectBaseTemplateV127FromAnswers(completeAnswers({ level: 'intermediate', days: 6 }));
    const sixDayAdvanced = selectBaseTemplateV127FromAnswers(completeAnswers({ level: 'advanced', days: 6 }));
    const sevenDayIntermediate = selectBaseTemplateV127FromAnswers(completeAnswers({ level: 'intermediate', days: 7 }));
    expect(sixDayIntermediate).toEqual(sixDayAdvanced);
    expect(sixDayIntermediate).not.toEqual(sevenDayIntermediate);
  });

  it('current hypertrophy intents and deprecated values resolve to the same family as gain_muscle', () => {
    const gainMuscle = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'gain_muscle' }));
    const loseFat = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'lose_fat' }));
    const health = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'health' }));
    const bodyComposition = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'body_composition' }));
    const returnToTraining = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'return_to_training' }));
    expect(loseFat).toEqual(gainMuscle);
    expect(health).toEqual(gainMuscle);
    expect(bodyComposition).toEqual(gainMuscle);
    expect(returnToTraining).toEqual(gainMuscle);
  });

  it('changing goal family from hypertrophy to strength changes the template', () => {
    const hypertrophy = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'gain_muscle' }));
    const strength = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'strength' }));
    expect(hypertrophy).not.toEqual(strength);
  });

  it('changing goal family from strength to conditioning changes the template', () => {
    const strength = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'strength' }));
    const conditioning = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'conditioning' }));
    expect(strength).not.toEqual(conditioning);
  });

});

describe('selectBaseTemplateV127FromAnswers — goal normalization', () => {
  const table: Array<[string, string]> = [
    ['gain_muscle', 'hypertrophy_body_composition'],
    ['lose_fat', 'hypertrophy_body_composition'],
    ['health', 'hypertrophy_body_composition'],
    ['body_composition', 'hypertrophy_body_composition'],
    ['return_to_training', 'hypertrophy_body_composition'],
    ['strength', 'strength'],
    ['conditioning', 'conditioning'],
    ['hyper', 'hypertrophy_body_composition'],
    ['cut', 'hypertrophy_body_composition'],
    ['def', 'hypertrophy_body_composition'],
    ['recon', 'hypertrophy_body_composition'],
  ];

  it.each(table)('normalizes goal %s to family %s', (goal, family) => {
    const result = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: goal as never }));
    expect(result.status).toBe('SELECTED');
    const expectedFamily = family as GoalFamily;
    const direct = selectBaseTemplateV127(baseInput({ goalFamily: expectedFamily }));
    expect(result).toEqual(direct);
  });

  it('rejects the ambiguous legacy "perf" goal rather than defaulting silently', () => {
    const result = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'perf' as never }));
    expect(result.status).toBe('MISSING_INPUT');
    expect(result.status === 'MISSING_INPUT' && result.reasonCodes).toContain('GOAL_FAMILY_UNRECOGNIZED');
  });

  it('rejects an invalid/corrupted goal payload rather than defaulting silently', () => {
    const result = selectBaseTemplateV127FromAnswers(completeAnswers({ goal: 'not_a_real_goal' as never }));
    expect(result.status).toBe('MISSING_INPUT');
    expect(result.status === 'MISSING_INPUT' && result.reasonCodes).toContain('GOAL_FAMILY_UNRECOGNIZED');
  });
});

describe('selectBaseTemplateV127FromAnswers — frequency table', () => {
  it('regular family uses availability directly for all 2-7 days, uncapped', () => {
    for (const days of [2, 3, 4, 5, 6, 7]) {
      const result = selectBaseTemplateV127FromAnswers(completeAnswers({ days, level: 'intermediate' }));
      expect(result.status).toBe('SELECTED');
      expect(result.status === 'SELECTED' && result.templateId).toBe(expectedRegularId('male', 'gym', 'hypertrophy_body_composition', days));
    }
  });

  it.each([
    [2, 2], [3, 3], [4, 4], [5, 4], [6, 4], [7, 4],
  ])('pregnancy: availability %i days -> effective %i days', (availability, effective) => {
    const result = selectBaseTemplateV127(baseInput({ population: 'pregnancy', sex: 'female', environment: 'gym', availabilityDays: availability }));
    expect(result.status === 'SELECTED' && result.templateId).toBe(expectedSpecialId('pregnancy', 'gym', effective));
  });

  it.each([
    [2, 2], [3, 3], [4, 4], [5, 4], [6, 4], [7, 4],
  ])('postpartum: availability %i days -> effective %i days', (availability, effective) => {
    const result = selectBaseTemplateV127(baseInput({ population: 'postpartum', sex: 'female', environment: 'gym', availabilityDays: availability }));
    expect(result.status === 'SELECTED' && result.templateId).toBe(expectedSpecialId('postpartum', 'gym', effective));
  });

  it.each([
    [2, 2], [3, 3], [4, 4], [5, 4], [6, 4], [7, 4],
  ])('frailty: availability %i days -> effective %i days (no legacy 3-day cap)', (availability, effective) => {
    const result = selectBaseTemplateV127(baseInput({ population: 'frailty', environment: 'gym', availabilityDays: availability }));
    expect(result.status === 'SELECTED' && result.templateId).toBe(expectedSpecialId('frailty', 'gym', effective));
  });

  it('beginner uses availability directly for all 2-7 days', () => {
    for (const days of [2, 3, 4, 5, 6, 7]) {
      const result = selectBaseTemplateV127(baseInput({ isBeginner: true, environment: 'home', availabilityDays: days }));
      expect(result.status === 'SELECTED' && result.templateId).toBe(expectedBeginnerId('home', days));
    }
  });
});

describe('selectBaseTemplateV127FromAnswers — special population precedence end-to-end', () => {
  it('pregnancy + beginner-level answers still select the pregnancy template', () => {
    const answers = beginnerAnswers({
      sex: 'f', place: 'gym', days: 2,
      specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    });
    const result = selectBaseTemplateV127FromAnswers(answers);
    expect(result.status === 'SELECTED' && result.templateId).toBe('T073');
  });

  it('postpartum + beginner-level answers still select the postpartum template', () => {
    const answers = beginnerAnswers({
      sex: 'f', place: 'gym', days: 2,
      specialConditions: ['postpartum'],
      postpartumScreening: { timeSinceBirth: '3_6_months', deliveryType: 'vaginal', signs: ['none'], returnClearance: 'yes' },
    });
    const result = selectBaseTemplateV127FromAnswers(answers);
    expect(result.status === 'SELECTED' && result.templateId).toBe('T079');
  });

  it('frailty + beginner-level answers still select the frailty template', () => {
    const answers = beginnerAnswers({
      place: 'gym', days: 2,
      specialConditions: ['functional_limitation'],
      functionalScreening: { situations: ['stairs_difficulty'] },
    });
    const result = selectBaseTemplateV127FromAnswers(answers);
    expect(result.status === 'SELECTED' && result.templateId).toBe('T085');
  });

  it('beginner-level, no special population, selects the beginner route regardless of stated goal', () => {
    const strength = selectBaseTemplateV127FromAnswers(beginnerAnswers({ goal: 'strength', days: 3, place: 'gym' }));
    const conditioning = selectBaseTemplateV127FromAnswers(beginnerAnswers({ goal: 'conditioning', days: 3, place: 'gym' }));
    expect(strength.status === 'SELECTED' && strength.templateId).toBe('T092');
    expect(conditioning.status === 'SELECTED' && conditioning.templateId).toBe('T092');
  });
});

describe('selectBaseTemplateV127 — pure function contract', () => {
  it('does not mutate the injected catalog and is safe against a frozen catalog', () => {
    const frozen = Object.freeze(V127_TEMPLATE_PROFILES.map((t) => Object.freeze({ ...t }) as TemplateProfileV127));
    expect(() => selectBaseTemplateV127(baseInput(), frozen)).not.toThrow();
  });

  it('returns NOT_FOUND with a trace, never throwing, for an empty catalog', () => {
    const result = selectBaseTemplateV127(baseInput(), []);
    expect(result.status).toBe('NOT_FOUND');
    expect(result.trace.length).toBeGreaterThan(0);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const a = selectBaseTemplateV127(baseInput({ population: 'frailty', availabilityDays: 5 }));
    const b = selectBaseTemplateV127(baseInput({ population: 'frailty', availabilityDays: 5 }));
    expect(a).toEqual(b);
  });
});
