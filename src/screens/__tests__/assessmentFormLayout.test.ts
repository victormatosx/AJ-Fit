import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CODE = readFileSync('src/screens/AssessmentScreen.tsx', 'utf8');

describe('Assessment new-record layout', () => {
  it('shares the same modern header, intro and numbered-section primitives across both flows', () => {
    expect(CODE).toContain('function AssessmentFormIntro(');
    expect(CODE).toContain('function AssessmentFormSection(');
    expect(CODE.match(/<AssessmentFormIntro/g)).toHaveLength(2);
    expect(CODE.match(/<AssessmentFormSection/g)).toHaveLength(5);
    expect(CODE).toContain('maxWidth: sizes.contentMaxWidth');
  });

  it('groups the required date and weight fields in cards in both forms', () => {
    expect(CODE.match(/<AssessmentFormSection index=\{1\}/g)).toHaveLength(2);
    expect(CODE.match(/<FormDivider \/>/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(CODE.match(/normalizeDecimalInput\(value, 2\)/g)).toHaveLength(2);
  });

  it('keeps validation quiet until an invalid save attempt', () => {
    expect(CODE).toContain('{shake && !canSave && (');
  });

  it('places automatic BMI after skinfolds and immediately before guided results', () => {
    const guided = CODE.slice(
      CODE.indexOf('function GuidedAssessmentModal('),
      CODE.indexOf('function ImportAssessmentModal('),
    );
    const skinfolds = guided.indexOf("t('sections.skinfolds')");
    const automaticBmi = guided.indexOf("t('results.automaticBmi')");
    const results = guided.indexOf("t('results.title')");

    expect(skinfolds).toBeGreaterThan(-1);
    expect(automaticBmi).toBeGreaterThan(skinfolds);
    expect(results).toBeGreaterThan(automaticBmi);
  });

  it('keeps skinfold inputs in a stable two-column grid', () => {
    expect(CODE).toContain("justifyContent: 'space-between',\n                    rowGap: spacing[3]");
    expect(CODE).toContain("<View key={s} style={{ width: '48%' }}>");
    expect(CODE).not.toContain("<View key={s} style={{ width: '48.5%' }}>");
  });
});
