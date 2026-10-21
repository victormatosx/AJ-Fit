import { describe,expect,it } from 'vitest';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import {
  buildPrescriptionInputSnapshot,
  isPrescriptionInputSnapshot,
  questionnaireAnswersFromPrescriptionInputs,
} from '../prescriptionInputs';

describe('PrescriptionInputSnapshot', () => {

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
