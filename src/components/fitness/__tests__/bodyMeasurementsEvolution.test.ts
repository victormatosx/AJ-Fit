import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const view = readFileSync('src/components/fitness/BodyEvolutionView.tsx', 'utf8');
const assessment = readFileSync('src/screens/AssessmentScreen.tsx', 'utf8');
const service = readFileSync('src/services/assessments.ts', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');

describe('body measurements evolution', () => {
  it('renders the measurement chart below composition with a complete dropdown', () => {
    expect(view.indexOf('<BodyMeasurementsChart assessments={assessments} />')).toBeGreaterThan(
      view.indexOf("t('progress.body.composition')"),
    );
    expect(view).toContain('MEASUREMENT_SITE_KEYS.map');
    expect(view).toContain('displayValue: `${formatMeasurement(point.value)} ${displayedUnit.toUpperCase()}`');
    expect(view).toContain("accessibilityHint={t('progress.chartInteractionHint')}");
    expect(view).toContain("entry.source === 'guided' ? entry.folds[selected] : undefined");
    expect(view).toContain("const displayedUnit = 'mm'");
  });

  it('uses only the original skinfold fields and adds no body-circumference form or schema', () => {
    expect(assessment).not.toContain('BodyMeasurementFields');
    expect(assessment).not.toContain('numericMeasurements');
    expect(service).not.toContain('BodyMeasurements');
    expect(rules).not.toContain("'measurements'");
  });
});
