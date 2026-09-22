import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const HOME = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
const VISUAL_HOOK = readFileSync('src/home/useHomeInitialVisualReady.ts', 'utf8');
const FREQUENCY = readFileSync('src/components/home/FrequencyHeatmap.tsx', 'utf8');

describe('Home bootstrap visual commit wiring', () => {
  it('keeps Home mounted under an opaque, touch-intercepting overlay until visualReady', () => {
    expect(APP_SHELL).toContain('<HomeScreen');
    expect(APP_SHELL).toContain('testID="home-initial-loading-overlay"');
    expect(APP_SHELL).toContain('pointerEvents="auto"');
    expect(APP_SHELL).toContain('style={FULL_BLEED.overlayZ70}');
    expect(APP_SHELL).toContain('{!homeInitialVisualReady ? (');
  });

  it('blocks the TabBar while the bootstrap overlay exists', () => {
    expect(APP_SHELL).toContain("pointerEvents={overlayOpen || !homeInitialVisualReady ? 'none' : 'auto'}");
    expect(APP_SHELL).toContain('accessibilityElementsHidden={overlayOpen || !homeInitialVisualReady}');
  });

  it('mounts a new onLayout marker only after data settled and waits one frame', () => {
    expect(HOME).toContain('homeInitialDataSettled && !homeInitialVisualReady');
    expect(HOME).toContain('testID="home-initial-layout-commit-marker"');
    expect(HOME).toContain('onLayout={onInitialLayoutCommitted}');
    expect(VISUAL_HOOK).toContain("dispatch('LAYOUT_COMMITTED')");
    expect(VISUAL_HOOK).toContain('requestAnimationFrame(() =>');
    expect(VISUAL_HOOK).toContain("dispatch('FRAME_PAINTABLE')");
  });

  it('renders the initial frequency grid in the data commit without a width=0 measurement pass', () => {
    expect(FREQUENCY).toContain('useWindowDimensions()');
    expect(FREQUENCY).not.toContain('LayoutChangeEvent');
    expect(FREQUENCY).not.toContain('onLayout={onLayout}');
    expect(FREQUENCY).toContain('hasCommittedInitialWindowRef');
  });

  it('re-arms through the existing uid-keyed AppShell remount', () => {
    expect(APP_SHELL).toContain("<RestSessionProvider key={user?.uid ?? 'signed-out'}>");
  });
});
