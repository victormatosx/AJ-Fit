import { describe, expect, it } from 'vitest';
import { buildDemoAssessments } from '../demoAssessmentData';

describe('buildDemoAssessments', () => {
  it('returns at least two chronologically-ordered points, newest first', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const assessments = buildDemoAssessments(now);

    expect(assessments.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i + 1 < assessments.length; i += 1) {
      const newer = assessments[i]!.measuredAt.toDate().getTime();
      const older = assessments[i + 1]!.measuredAt.toDate().getTime();
      expect(newer).toBeGreaterThan(older);
    }
  });

  it('never dates a demo entry in the future relative to the given "now"', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const assessments = buildDemoAssessments(now);
    assessments.forEach((assessment) => {
      expect(assessment.measuredAt.toDate().getTime()).toBeLessThanOrEqual(now.getTime());
    });
  });

  it('provides guided folds so the measurements sub-chart has data to show', () => {
    const assessments = buildDemoAssessments(new Date('2026-10-09T12:00:00Z'));
    assessments.forEach((assessment) => {
      expect(assessment.source).toBe('guided');
      if (assessment.source === 'guided') {
        expect(assessment.folds.chest).not.toBeNull();
      }
    });
  });
});
