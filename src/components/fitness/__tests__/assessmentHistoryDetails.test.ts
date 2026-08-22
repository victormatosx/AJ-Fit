import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HISTORY = readFileSync('src/components/fitness/AssessmentHistoryCard.tsx', 'utf8');
const SCREEN = readFileSync('src/screens/AssessmentScreen.tsx', 'utf8');

describe('Assessment history expanded details', () => {
  it('passes every persisted detail supported by guided and imported assessments', () => {
    for (const value of [
      'height: a.height',
      'notes: a.notes',
      "a.source === 'guided' ? a.age",
      "a.source === 'guided' ? a.sex",
      'Object.entries(a.folds)',
      "a.source === 'imported' ? a.bodyWater",
      "a.source === 'imported' ? a.basalMetabolism",
      "a.source === 'imported' ? a.visceralFat",
    ]) {
      expect(SCREEN).toContain(value);
    }
  });

  it('renders shared and source-specific detail sections', () => {
    for (const section of ['composition', 'context', 'skinfolds', 'additional', 'notes']) {
      expect(HISTORY).toContain(`history.details.sections.${section}`);
    }
    expect(HISTORY).toContain('entry.skinfolds?.length');
    expect(HISTORY).toContain('isImported && hasImportedDetails');
  });

  it('supports explicit open and close labels', () => {
    expect(HISTORY).toContain('history.labels.hideDetails');
    expect(HISTORY).toContain('accessibility.closeAssessment');
  });
});
