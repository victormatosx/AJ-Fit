import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync('src/components/fitness/EvolutionLockedPreview.tsx', 'utf8');

describe('EvolutionLockedPreview', () => {
  it('disables interaction with the demo content behind the blur', () => {
    expect(component).toContain("pointerEvents=\"none\"");
    expect(component).toContain('accessibilityElementsHidden');
    expect(component).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it('keeps the CTA reachable through the blur layer', () => {
    expect(component).toContain('pointerEvents="box-none"');
  });

  it('uses the same Android blur workaround as the photo vault locked state', () => {
    expect(component).toContain('BlurTargetView');
    expect(component).toContain('blurMethod="dimezisBlurViewSdk31Plus"');
  });

  it('renders the message as plain centered text, with no card behind it', () => {
    expect(component).not.toContain('borderColor: theme.colors.borderStrong');
    expect(component).not.toContain('backgroundColor: theme.colors.surfaceElevated');
  });

  it('fills the height its parent gives it instead of sizing to the (cropped) demo content, by default', () => {
    expect(component).toContain("rootFill: {\n    flex: 1,");
    expect(component).toContain("overflow: 'hidden'");
  });

  it('supports an inline mode that sizes to its demo content for sub-section locking', () => {
    expect(component).toContain('fillHeight?: boolean');
    expect(component).toContain('fillHeight = true');
  });
});
