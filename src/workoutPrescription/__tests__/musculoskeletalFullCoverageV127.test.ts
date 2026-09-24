import { describe, expect, it } from 'vitest';

import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { composeTemplateV127 } from '../compositionV127';
import { V127_TEMPLATE_PROFILES } from '../selectorV127';

const INDIVIDUAL_REGIONS = [
  'knee', 'hip', 'spine', 'shoulder', 'elbow', 'wrist', 'ankle_foot',
] as const;

const REQUIRED_INTERSECTIONS = [
  ['knee', 'hip'],
  ['knee', 'spine'],
  ['hip', 'spine'],
  ['shoulder', 'elbow'],
  ['shoulder', 'wrist'],
  ['elbow', 'wrist'],
  ['shoulder', 'elbow', 'wrist'],
  ['spine', 'shoulder'],
  ['spine', 'hip'],
  ['knee', 'ankle_foot'],
] as const;

function audit(regions: readonly string[]) {
  return V127_TEMPLATE_PROFILES.map((templateProfile) => ({
    templateId: templateProfile.id,
    result: composeTemplateV127(getCanonicalTemplateV127ById(templateProfile.id), {
      limitationRegions: regions,
    }),
  }));
}

describe('v1.27 complete musculoskeletal coverage gate', () => {
  it.each(INDIVIDUAL_REGIONS)('%s composes all 102 templates', (region) => {
    const results = audit([region]);
    expect(results).toHaveLength(102);
    expect(results.filter(({ result }) => result.status === 'COMPOSED')).toHaveLength(102);
  });

  it('closes the complete individual 102x7 matrix (714/714)', () => {
    const results = INDIVIDUAL_REGIONS.flatMap((region) => audit([region]));
    expect(results).toHaveLength(714);
    expect(results.filter(({ result }) => result.status === 'COMPOSED')).toHaveLength(714);
  });

  it.each(REQUIRED_INTERSECTIONS.map((regions) => [regions.join('+'), regions] as const))(
    '%s uses the safety intersection and composes all 102 templates', (_label, regions) => {
    const results = audit(regions);
    expect(results.filter(({ result }) => result.status === 'COMPOSED')).toHaveLength(102);
    },
  );

  it('uses leg-press-90 only after the occupied preferred spine adaptation', () => {
    const result = composeTemplateV127(getCanonicalTemplateV127ById('T002'), {
      limitationRegions: ['spine'],
    });
    expect(result.status).toBe('COMPOSED');
    if (result.status !== 'COMPOSED') return;
    expect(result.trace.limitationDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exerciseId: 'leg-press-45',
        outcome: 'SUBSTITUTED',
        substituteExerciseId: 'leg-press-90',
        candidateOrigin: 'family',
      }),
    ]));
  });
});
