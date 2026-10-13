import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const samples = readFileSync(resolve(process.cwd(), 'src/services/healthWeightSamples.ts'), 'utf8');
const sync = readFileSync(resolve(process.cwd(), 'src/services/healthWeightSync.ts'), 'utf8');
const nutritionContext = readFileSync(
  resolve(process.cwd(), 'functions/src/nutrition/generation/context.ts'),
  'utf8',
);

describe('imported weight domain separation', () => {
  it('persists and deletes only healthWeightSamples, never assessments or nutrition documents', () => {
    expect(samples).toContain("const COLLECTION = 'healthWeightSamples'");
    expect(samples).not.toContain("const COLLECTION = 'assessments'");
    expect(samples).not.toContain("collection(db, 'users', uid, 'assessments'");
    expect(samples).not.toContain("collection(db, 'users', uid, 'nutrition'");
    expect(sync).not.toContain('addImportedAssessment');
  });

  it('does not change nutrition weight resolution to consume imported health weights', () => {
    expect(nutritionContext).toContain("collection('assessments')");
    expect(nutritionContext).not.toContain('healthWeightSamples');
  });
});
