import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const view = readFileSync('src/components/fitness/BodyEvolutionView.tsx', 'utf8');
const assessment = readFileSync('src/screens/AssessmentScreen.tsx', 'utf8');
const service = readFileSync('src/services/assessments.ts', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');

describe('body measurements evolution', () => {
  it('renders the measurement chart below composition with a complete dropdown', () => {
    // The call site gained a `sex` prop for the body map alongside the list;
    // the wiring this guards is still `compositionAssessments`, below composition.
    expect(view.indexOf('<BodyMeasurementsChart assessments={compositionAssessments}')).toBeGreaterThan(
      view.indexOf("t('progress.body.composition')"),
    );
    expect(view).toContain('MEASUREMENT_SITE_KEYS.map');
    expect(view).toContain('displayValue: `${formatMeasurement(point.value)} ${displayedUnit.toUpperCase()}`');
    expect(view).toContain("accessibilityHint={t('progress.chartInteractionHint')}");
    // Folds still come from guided assessments only. The series is now built
    // for every site at once (the list shows each site's own change), so the
    // lookup key is the loop's `key` rather than the selected site.
    expect(view).toContain("entry.source === 'guided' ? entry.folds[key] : undefined");
    expect(view).toContain("const displayedUnit = 'mm'");
  });

  it('uses only the original skinfold fields and adds no body-circumference form or schema', () => {
    expect(assessment).not.toContain('BodyMeasurementFields');
    expect(assessment).not.toContain('numericMeasurements');
    expect(service).not.toContain('BodyMeasurements');
    expect(rules).not.toContain("'measurements'");
  });
});

describe('body evolution locked preview', () => {
  it('wraps the real panel in EvolutionLockedPreview, fed by demo data, only when there is no real assessment', () => {
    expect(view).toContain("import { EvolutionLockedPreview } from './EvolutionLockedPreview'");
    expect(view).toContain("import { buildDemoAssessments } from './demoAssessmentData'");
    expect(view).toContain('const compositionLatest = hasRealAssessment ? latest : demoAssessments[0]');
    expect(view).toContain('<EvolutionLockedPreview');
    expect(view).toContain("title={t('progress.body.empty.title')}");
    expect(view).toContain("description={t('progress.body.empty.description')}");
    // The "open full assessment" row must stay gated on the REAL assessment, not the demo fallback.
    expect(view).toContain('{onOpenAssessment && hasRealAssessment ?');
  });
});
