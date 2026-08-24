import { describe, expect, it } from 'vitest';
import { defaultQuiz, type Quiz } from '../../state/AppState';
import {
  cleanApplicableAnswers,
  questionnaireValidationErrors,
  updateQuizAnswer,
} from '../questionnaireSchema';

function standardQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    ...defaultQuiz,
    sex: 'm',
    goal: 'gain_muscle',
    level: 'intermediate',
    days: 4,
    duration: '60',
    place: 'gym',
    limits: ['none'],
    specialConditions: ['none'],
    muscleFocus: ['none'],
    ...overrides,
  };
}

describe('questionnaire schema and branching payload', () => {
  it('accepts the conventional scenario', () => {
    expect(questionnaireValidationErrors(standardQuiz())).toEqual([]);
  });

  it('accepts the home scenario with canonical equipment ids', () => {
    const quiz = standardQuiz({
      sex: 'f',
      goal: 'body_composition',
      place: 'home',
      days: 3,
      equipment: ['dumbbells', 'bands'],
    });
    expect(questionnaireValidationErrors(quiz)).toEqual([]);
  });

  it('requires a primary environment when place is both', () => {
    const quiz = standardQuiz({ place: 'both', equipment: ['bodyweight'] });
    expect(questionnaireValidationErrors(quiz)).toContain('primary_place_required');
    expect(questionnaireValidationErrors({ ...quiz, primaryPlace: 'gym' })).not.toContain('primary_place_required');
  });

  it('opens limitation impact and removes residual impact after none is selected', () => {
    let quiz = standardQuiz({ limits: ['knee'], limitationImpact: 'requires_adaptation' });
    expect(questionnaireValidationErrors(quiz)).not.toContain('limitation_impact_required');
    quiz = updateQuizAnswer(quiz, 'limits', ['none']);
    expect(quiz.limitationImpact).toBeNull();
  });

  it('validates a complete pregnancy screening', () => {
    const quiz = standardQuiz({
      sex: 'f',
      specialConditions: ['pregnancy'],
      pregnancyScreening: {
        weeks: 20,
        prenatalCare: 'yes',
        exerciseRestriction: 'no',
        complication: 'no',
        warningSigns: ['none'],
      },
    });
    expect(questionnaireValidationErrors(quiz)).not.toContain('pregnancy_screening_incomplete');
  });

  it('validates a complete postpartum screening', () => {
    const quiz = standardQuiz({
      sex: 'f',
      specialConditions: ['postpartum'],
      postpartumScreening: {
        timeSinceBirth: '3_6_months',
        deliveryType: 'cesarean',
        signs: ['none'],
        returnClearance: 'yes',
      },
    });
    expect(questionnaireValidationErrors(quiz)).not.toContain('postpartum_screening_incomplete');
  });

  it('validates functional screening from capability instead of age', () => {
    const quiz = standardQuiz({
      specialConditions: ['functional_limitation'],
      functionalScreening: { situations: ['balance_problems', 'support_needed'] },
    });
    expect(questionnaireValidationErrors(quiz)).not.toContain('functional_screening_incomplete');
    expect(Object.keys(quiz)).not.toContain('frailty');
  });

  it('cleans pregnancy answers when the router changes to none', () => {
    const pregnant = standardQuiz({
      sex: 'f',
      specialConditions: ['pregnancy'],
      pregnancyScreening: {
        weeks: 12,
        prenatalCare: 'yes',
        exerciseRestriction: 'no',
        complication: 'unsure',
        warningSigns: ['none'],
      },
    });
    const cleaned = updateQuizAnswer(pregnant, 'specialConditions', ['none']);
    expect(cleaned.specialConditions).toEqual(['none']);
    expect(cleaned.pregnancyScreening).toBeNull();
  });

  it('allows special conditions to coexist but keeps pregnancy/postpartum mutually exclusive', () => {
    const pregnancyAndFunctional = updateQuizAnswer(
      standardQuiz({ sex: 'f' }),
      'specialConditions',
      ['pregnancy', 'functional_limitation'],
    );
    expect(pregnancyAndFunctional.specialConditions).toEqual(['pregnancy', 'functional_limitation']);
    const switched = updateQuizAnswer(
      pregnancyAndFunctional,
      'specialConditions',
      ['pregnancy', 'functional_limitation', 'postpartum'],
    );
    expect(switched.specialConditions).toEqual(['functional_limitation', 'postpartum']);
    expect(switched.pregnancyScreening).toBeNull();
  });

  it('enforces none exclusivity and the two-priority cap', () => {
    const conflicted = standardQuiz({
      equipment: ['none', 'dumbbells'],
      muscleFocus: ['chest', 'back', 'arms'],
    });
    expect(questionnaireValidationErrors(conflicted)).toEqual(
      expect.arrayContaining(['exclusive_none_conflict', 'too_many_muscle_priorities']),
    );
    expect(cleanApplicableAnswers({ ...conflicted, place: 'home' }).equipment).toEqual(['dumbbells']);
  });
});
