import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/NutritionReadyBanner.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NutritionReadyBanner design regressions', () => {
  it('uses an opaque toast surface instead of the near-transparent surfaceElevated wash', () => {
    // Regression: `surfaceElevated` is `alpha.white05` in dark mode (5%
    // opacity) — meant for cards sitting on an already-opaque screen
    // background, not for a banner that floats over arbitrary content. That
    // let whatever was underneath (status bar, screen text) show through.
    const viewStart = source.indexOf('return <View onLayout={presentation.onLayout}');
    expect(viewStart).toBeGreaterThan(-1);
    const viewBlock = source.slice(viewStart, viewStart + 800);
    expect(viewBlock).toContain('theme.colors.toastBackground');
    expect(viewBlock).not.toContain('theme.colors.surfaceElevated');
  });

  it('positions below the safe area (status bar / Dynamic Island) instead of a fixed pixel offset', () => {
    expect(source).toContain('useSafeAreaInsets');
    const viewStart = source.indexOf('return <View onLayout={presentation.onLayout}');
    const viewBlock = source.slice(viewStart, viewStart + 800);
    expect(viewBlock).toContain('top: insets.top');
    expect(viewBlock).not.toMatch(/top:\s*56\b/);
  });

  it('gives the notification a tonal border, shadow and icon for contrast — not a bare text block', () => {
    const viewStart = source.indexOf('return <View onLayout={presentation.onLayout}');
    const viewBlock = source.slice(viewStart, viewStart + 1200);
    expect(viewBlock).toContain('theme.colors.toastSuccessBorder');
    expect(viewBlock).toMatch(/shadowColor:\s*theme\.colors\.success/);
    expect(viewBlock).toContain("<Icon name=\"check\"");
  });

  it('preserves the existing presentation lifecycle, open and dismiss behavior', () => {
    // Same `onLayout` hook driving `createNutritionNoticePresentation`'s
    // measure-then-markSeen flow, same two actions (open the plan, dismiss)
    // — only the container's visual styling changed.
    expect(source).toContain('onLayout={presentation.onLayout}');
    expect(source).toMatch(/onPress=\{\(\) => \{ setReady\(null\); onOpen\(\); \}\}/);
    expect(source).toMatch(/onPress=\{\(\) => setReady\(null\)\}/);
    expect(source).toContain("t('onboarding.readyTitle')");
    expect(source).toContain("t('onboarding.readyBody')");
    expect(source).toContain("t('onboarding.dismiss')");
  });
});
