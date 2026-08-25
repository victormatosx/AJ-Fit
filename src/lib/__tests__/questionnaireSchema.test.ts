import { describe, expect, it } from 'vitest';
import { defaultQuiz, type Quiz } from '../../state/AppState';
import {
  cleanApplicableAnswers,
  normalizeLoadedQuiz,
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
    limits: [],
    specialConditions: ['none'],
    muscleFocus: ['none'],
    ...overrides,
  };
}

describe('questionnaire schema and branching payload', () => {
  it('accepts the conventional scenario', () => {
    expect(questionnaireValidationErrors(standardQuiz())).toEqual([]);
  });

  it('maps a pre-router limitation into the musculoskeletal branch on read', () => {
    const loaded = normalizeLoadedQuiz({ limits: ['knee'], specialConditions: [] });
    expect(loaded.specialConditions).toEqual(['musculoskeletal_limitation']);
    expect(loaded.limits).toEqual(['knee']);
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

  it('requires musculoskeletal details and removes them when the router branch is deselected', () => {
    let quiz = standardQuiz({ specialConditions: ['musculoskeletal_limitation'], limits: ['knee'], limitationImpact: 'requires_adaptation' });
    expect(questionnaireValidationErrors(quiz)).not.toContain('limitation_impact_required');
    quiz = updateQuizAnswer(quiz, 'specialConditions', ['none']);
    expect(quiz.limits).toEqual([]);
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

  it('validates complete lipedema, dizziness, post-surgical, and medical-restriction branches together', () => {
    const quiz = standardQuiz({
      specialConditions: ['lipedema', 'dizziness_or_vertigo', 'post_surgical', 'medical_restriction'],
      lipedemaScreening: { symptomImpact: 'mild_or_occasional', professionalGuidance: 'yes' },
      dizzinessScreening: { symptomFrequency: 'occasional', affectsBalance: 'no' },
      postSurgicalScreening: { recoveryStatus: 'completed', bodyRegion: 'knee', returnClearance: 'cleared_no_restrictions' },
      medicalRestrictionScreening: { professionalExerciseRestriction: 'yes' },
    });
    expect(questionnaireValidationErrors(quiz)).toEqual([]);
  });

  it('reports incomplete phase 2 branches without inferring clinical answers', () => {
    const quiz = cleanApplicableAnswers(standardQuiz({
      specialConditions: ['lipedema', 'dizziness_or_vertigo', 'post_surgical', 'medical_restriction'],
    }));
    expect(questionnaireValidationErrors(quiz)).toEqual(expect.arrayContaining([
      'lipedema_screening_incomplete',
      'dizziness_screening_incomplete',
      'post_surgical_screening_incomplete',
      'medical_restriction_screening_incomplete',
    ]));
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

  it.each([
    ['lipedema', 'lipedemaScreening', { symptomImpact: 'interferes_with_exercises', professionalGuidance: 'yes' }],
    ['dizziness_or_vertigo', 'dizzinessScreening', { symptomFrequency: 'frequent', affectsBalance: 'yes' }],
    ['post_surgical', 'postSurgicalScreening', { recoveryStatus: 'in_progress', bodyRegion: 'shoulder', returnClearance: 'not_yet' }],
  ] as const)('cleans %s details after its router branch is removed', (condition, field, screening) => {
    const quiz = standardQuiz({ specialConditions: [condition], [field]: screening });
    const cleaned = updateQuizAnswer(quiz, 'specialConditions', ['none']);
    expect(cleaned[field]).toBeNull();
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
