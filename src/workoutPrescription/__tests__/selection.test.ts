import { describe, expect, it } from 'vitest';
import { WORKOUT_TEMPLATES } from '../catalog';
import { selectTemplate } from '../selection';
import { completeAnswers, answersForTemplate } from './fixtures';

describe('selection engine T001-T090 matrix', () => {
  it.each(WORKOUT_TEMPLATES.map((template) => [template.id, template] as const))(
    'selects %s from its canonical metadata dimensions',
    (id, template) => {
      expect(selectTemplate(answersForTemplate(template))).toEqual(
        expect.objectContaining({
          status: 'SELECTED',
          decision: expect.objectContaining({ templateId: id }),
        }),
      );
    },
  );

  it('does not let experience, duration, muscle focus, or equipment select a different Txxx', () => {
    const base = completeAnswers();
    const variants = [
      { ...base, level: 'beginner' as const },
      { ...base, level: 'advanced' as const },
      { ...base, duration: '30' as const },
      { ...base, duration: '90' as const },
      { ...base, muscleFocus: ['chest', 'arms'] },
    ];
    const ids = variants.map((answers) => {
      const result = selectTemplate(answers);
      return result.status === 'SELECTED' ? result.decision.templateId : result.status;
    });
    expect(new Set(ids).size).toBe(1);
  });

  it('uses primaryPlace for both', () => {
    const result = selectTemplate(completeAnswers({ place: 'both', primaryPlace: 'home', equipment: ['bodyweight'] }));
    expect(result).toEqual(expect.objectContaining({
      status: 'SELECTED',
      decision: expect.objectContaining({ environment: 'home', templateId: 'T009' }),
    }));
  });

  it('caps special populations at four structured days without changing requestedDays', () => {
    const result = selectTemplate(completeAnswers({
      sex: 'f', days: 7, specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'] },
    }));
    expect(result).toEqual(expect.objectContaining({
      status: 'SELECTED',
      decision: expect.objectContaining({ templateId: 'T075', requestedDays: 7, prescribedStructuredDays: 4 }),
    }));
  });

  it('rejects invalid days and both without primaryPlace as missing dimensions/templates', () => {
    expect(selectTemplate(completeAnswers({ days: 1 }))).toEqual(expect.objectContaining({ status: 'MISSING_TEMPLATE' }));
    expect(selectTemplate(completeAnswers({ place: 'both', primaryPlace: null }))).toEqual(expect.objectContaining({ status: 'MISSING_TEMPLATE' }));
  });

  it('accepts unambiguous legacy goals and ignores legacy experience for selection', () => {
    expect(selectTemplate(completeAnswers({ goal: 'hyper', level: 'elite' }))).toEqual(
      expect.objectContaining({ status: 'SELECTED', decision: expect.objectContaining({ templateId: 'T003' }) }),
    );
    expect(selectTemplate(completeAnswers({ goal: 'cut' }))).toEqual(
      expect.objectContaining({ status: 'SELECTED', decision: expect.objectContaining({ templateId: 'T003' }) }),
    );
  });
});
