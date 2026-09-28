import { describe, expect, it } from 'vitest';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import {
  buildPrescriptionInputSnapshot,
  isPrescriptionInputSnapshot,
  questionnaireAnswersFromPrescriptionInputs,
} from '../prescriptionInputs';

describe('PrescriptionInputSnapshot', () => {
  it('is deterministic and detached from later mutation of the source answers', () => {
    const answers = completeAnswers({
      level: 'beginner', limits: ['knee'],
      specialConditions: ['musculoskeletal_limitation'],
    });
    const first = buildPrescriptionInputSnapshot({
      answers, currentTrainingLevel: 'ADVANCED', source: 'PROGRAM_ADAPTATION',
    });
    const second = buildPrescriptionInputSnapshot({
      answers: structuredClone(answers), currentTrainingLevel: 'ADVANCED', source: 'PROGRAM_ADAPTATION',
    });
    expect(second).toEqual(first);
    expect(first.inputs.level).toBe('advanced');

    answers.limits.push('elbow');
    answers.specialConditions.length = 0;
    expect(first.inputs.limits).toEqual(['knee']);
    expect(first.inputs.specialConditions).toEqual(['musculoskeletal_limitation']);
  });

  it('changes identity when source or effective inputs change', () => {
    const answers = completeAnswers();
    const baseline = buildPrescriptionInputSnapshot({
      answers, currentTrainingLevel: 'INTERMEDIATE', source: 'QUESTIONNAIRE_BASELINE',
    });
    const adaptation = buildPrescriptionInputSnapshot({
      answers, currentTrainingLevel: 'INTERMEDIATE', source: 'PROGRAM_ADAPTATION',
    });
    const changed = buildPrescriptionInputSnapshot({
      answers: { ...answers, duration: '45' },
      currentTrainingLevel: 'INTERMEDIATE', source: 'PROGRAM_ADAPTATION',
    });
    expect(new Set([baseline.snapshotId, adaptation.snapshotId, changed.snapshotId]).size).toBe(3);
  });

  it('round-trips normalized inputs and rejects unknown input keys', () => {
    const snapshot = buildPrescriptionInputSnapshot({
      answers: completeAnswers({ trainingDays: ['MON', 'WED', 'FRI'] }),
      currentTrainingLevel: 'INTERMEDIATE', source: 'CYCLE_EVOLUTION',
    });
    expect(isPrescriptionInputSnapshot(snapshot)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snapshot.inputs, 'primaryPlace')).toBe(false);
    expect(questionnaireAnswersFromPrescriptionInputs(snapshot.inputs)).toMatchObject({
      level: 'intermediate', trainingDays: ['MON', 'WED', 'FRI'],
    });
    expect(isPrescriptionInputSnapshot({
      ...snapshot,
      inputs: { ...snapshot.inputs, unexpected: true },
    })).toBe(false);
  });

  it('accepts a legacy snapshot and folds both + primaryPlace into place', () => {
    const snapshot = buildPrescriptionInputSnapshot({
      answers: completeAnswers(),
      currentTrainingLevel: 'INTERMEDIATE', source: 'QUESTIONNAIRE_BASELINE',
    });
    const legacySnapshot = {
      ...snapshot,
      inputs: { ...snapshot.inputs, place: 'both', primaryPlace: 'home' },
    };
    expect(isPrescriptionInputSnapshot(legacySnapshot)).toBe(true);
    const restored = questionnaireAnswersFromPrescriptionInputs(legacySnapshot.inputs as never);
    expect(restored.place).toBe('home');
    expect(Object.prototype.hasOwnProperty.call(restored, 'primaryPlace')).toBe(false);
  });
});
