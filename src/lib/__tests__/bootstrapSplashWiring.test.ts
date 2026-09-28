import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const premiumGateSource = readFileSync(new URL('../premiumGate.ts', import.meta.url), 'utf8');
const appShellSource = readFileSync(
  new URL('../../screens/AppShell.tsx', import.meta.url),
  'utf8',
);
const paywallSource = readFileSync(
  new URL('../../screens/PaywallScreen.tsx', import.meta.url),
  'utf8',
);
const wordmarkSource = readFileSync(
  new URL('../../components/ui/WordmarkSplash.tsx', import.meta.url),
  'utf8',
);

describe('there is exactly one splash implementation, mounted once at the root', () => {
  it('the old animated/glowing SplashScreen.tsx never came back', () => {
    expect(existsSync(new URL('../../screens/SplashScreen.tsx', import.meta.url))).toBe(false);
    expect(appSource).not.toContain("from './src/screens/SplashScreen'");
  });

  it('the old static, no-glow BootSplash was retired — WordmarkSplash is the one and only splash now', () => {
    expect(existsSync(new URL('../../components/ui/BootSplash.tsx', import.meta.url))).toBe(false);
    expect(appSource).not.toContain('BootSplash');
    expect(appShellSource).not.toContain('BootSplash');
    expect(paywallSource).not.toContain('BootSplash');
  });

  it("'splash' is not a RootScreenId — the splash is not a router state", () => {
    const typeDecl = premiumGateSource.slice(
      premiumGateSource.indexOf('export type RootScreenId'),
      premiumGateSource.indexOf(';', premiumGateSource.indexOf('export type RootScreenId')),
    );
    expect(typeDecl).not.toContain("'splash'");
  });

  it('WordmarkSplash is mounted exactly once, in App.tsx, as an overlay sibling of the navigator — never inside AppShell or PaywallScreen', () => {
    expect(appSource).toContain("import { WordmarkSplash } from './src/components/ui/WordmarkSplash'");
    expect(appSource).toContain('<WordmarkSplash');
    expect(appShellSource).not.toMatch(/import.*WordmarkSplash|<WordmarkSplash/);
    expect(paywallSource).not.toMatch(/import.*WordmarkSplash|<WordmarkSplash/);
  });
});

describe('cold-start-only, one-shot: reuses the existing initialBootReadiness latch', () => {
  it('App.tsx seeds `booting` from the latch and marks it completed in onDone — never re-derived from React state', () => {
    expect(appSource).toContain(
      "import { hasCompletedInitialBoot, markInitialBootCompleted } from './src/lib/initialBootReadiness'",
    );
    expect(appSource).toMatch(/useState\(\(\) => !hasCompletedInitialBoot\(\)\)/);
    expect(appSource).toContain('markInitialBootCompleted()');
  });

  it('the splash is conditionally rendered on that boot state, so it can never remount later in the process (background/foreground, tab switches, internal navigation)', () => {
    expect(appSource).toMatch(/\{booting[\s\S]{0,80}<WordmarkSplash/);
  });
});

describe('a single destinationReady signal, fed by whichever destination is actually mounted', () => {
  it('RootNavigator receives an onDestinationReady callback and threads it to AppShell and the root PaywallScreen', () => {
    expect(appSource).toContain('function RootNavigator({ onDestinationReady }');
    expect(appSource).toContain('<AppShell onHomeReady={onDestinationReady} />');
    expect(appSource).toContain('onReady={onDestinationReady}');
  });

  it('auth/emailVerification/onboardingFunnel — and both terminal read-error branches — report ready immediately, no internal gate of their own', () => {
    expect(appSource).toMatch(
      /resolvedScreen === 'auth'[\s\S]{0,40}\|\|[\s\S]{0,40}resolvedScreen === 'emailVerification'[\s\S]{0,40}\|\|[\s\S]{0,40}resolvedScreen === 'onboardingFunnel'/,
    );
    expect(appSource).toContain('questionnaireReadError');
    expect(appSource).toContain('subscriptionReadError');
    expect(appSource).toMatch(/onDestinationReady\(\)/);
  });

  it("AppShell reports ready from the strict authoritative signal (homeInitialRevealReady), never the snapshot-satisfied homeVisible alone", () => {
    expect(appShellSource).toContain(
      'const homeInitialRevealReady = homeInitialVisualReady;',
    );
    expect(appShellSource).toMatch(/if \(homeInitialRevealReady\) onHomeReady\?\.\(\);/);
    expect(appShellSource).not.toMatch(/if \(homeVisible\) onHomeReady/);
  });

  it('PaywallScreen reports ready once centerState leaves loading (ready or a real error/offline/empty/unavailable card — never an infinite splash)', () => {
    expect(paywallSource).toMatch(/if \(centerState !== 'loading'\) onReady\?\.\(\);/);
  });
});

describe('every other loading surface reverted to its simple, pre-splash-redesign form — no cold-start branching left inside it', () => {
  it("AppShell's home-initial-loading-overlay is unconditionally FullScreenLoading again", () => {
    const overlayIdx = appShellSource.indexOf('testID="home-initial-loading-overlay"');
    const overlayBlock = appShellSource.slice(overlayIdx - 60, overlayIdx + 300);
    expect(overlayBlock).toContain('{!homeVisible ? (');
    expect(overlayBlock).toContain('<FullScreenLoading />');
  });

  it("PaywallScreen's Offerings-loading gate is unconditionally FullScreenLoading again", () => {
    expect(paywallSource).toContain("if (centerState === 'loading') return <FullScreenLoading />;");
  });

  it('the root gate (auth/profile/subscription/preferences/workout-readiness unresolved) is unconditionally FullScreenLoading again — occluded by WordmarkSplash during cold start, and correct as ordinary runtime loading afterward', () => {
    expect(appSource).toContain('return <FullScreenLoading />;');
  });

  it('FullScreenLoading remains available for feature-level loading (workout start/prep, on-demand Paywall) — untouched by this redesign', () => {
    expect(appShellSource).toContain("<FullScreenLoading accessibilityLabel={t('preparing.title')} />");
  });
});

describe('native splash → WordmarkSplash handoff', () => {
  it('preventAutoHideAsync still runs at module scope in App.tsx', () => {
    expect(appSource).toContain('NativeSplashScreen.preventAutoHideAsync()');
  });

  it('hideAsync moved into WordmarkSplash — called exactly once, only after layout measurement AND fonts are both ready', () => {
    expect(appSource).not.toContain('NativeSplashScreen.hideAsync()');
    const occurrences = wordmarkSource.split('NativeSplashScreen.hideAsync()').length - 1;
    expect(occurrences).toBe(1);
    expect(wordmarkSource).toMatch(/if \(measured && fontsLoaded\) NativeSplashScreen\.hideAsync\(\)/);
  });
});

describe('WordmarkSplash itself: no glow, no spinner, matches the #020010 background everywhere', () => {
  it('uses the provided white logo asset and the app-wide #020010 background — not the old #000000', () => {
    expect(wordmarkSource).toContain("require('../../../assets/aj-logo-branco.png')");
    expect(wordmarkSource).toContain("const BG = '#020010'");
  });

  it('has no glow/shadow styling, no ActivityIndicator', () => {
    expect(wordmarkSource).not.toMatch(/shadowColor|shadowOpacity|shadowRadius|glow[?:=]/i);
    expect(wordmarkSource).not.toContain('ActivityIndicator');
  });

  it('reuses the pure, independently-tested motion math instead of inlining the formulas again', () => {
    expect(wordmarkSource).toContain("from '../../lib/wordmarkMotion'");
    expect(wordmarkSource).not.toContain('easeInOutCubic(x)');
  });
});
