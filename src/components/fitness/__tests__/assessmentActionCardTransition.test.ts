import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CODE = readFileSync('src/components/fitness/AssessmentActionCard.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('AssessmentActionCard modal transition', () => {
  it('dismisses the selector before dispatching either gated action', () => {
    const transition = CODE.slice(
      CODE.indexOf('const selectAction ='),
      CODE.indexOf('};', CODE.indexOf('const selectAction =')) + 2,
    );

    expect(transition).toMatch(/onClose\(\);\s*action\(\);/);
    expect(CODE.match(/onPress=\{\(\) => selectAction\(onPress\)\}/g)).toHaveLength(2);
  });

  it('keeps both choices behind the existing PremiumAction boundary', () => {
    expect(
      CODE.match(/<PremiumAction capability="CREATE_ASSESSMENT" onAllowed=\{(onGuided|onImport)\}>/g),
    ).toHaveLength(2);
  });
});
