import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const provider = readFileSync(new URL('../DeepLinkContext.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../../screens/AppShell.tsx', import.meta.url), 'utf8');

describe('deep-link lifecycle wiring', () => {
  it('registers one URL listener, reads the initial URL and cleans up the subscription', () => {
    expect(provider.match(/Linking\.getInitialURL\(\)/g)).toHaveLength(1);
    expect(provider.match(/Linking\.addEventListener\('url'/g)).toHaveLength(1);
    expect(provider).toContain('subscription.remove()');
  });

  it('mounts the listener above the local and root bootstrap gates', () => {
    const providerStart = app.indexOf('<DeepLinkProvider>');
    const localGate = app.indexOf('{themeHydrated && fontsLoaded && i18nReady');
    const providerEnd = app.indexOf('</DeepLinkProvider>');

    expect(providerStart).toBeGreaterThan(-1);
    expect(providerStart).toBeLessThan(localGate);
    expect(localGate).toBeLessThan(providerEnd);
  });

  it('consumes only inside AppShell and preserves the existing workout authorization flow', () => {
    expect(appShell).toContain("pendingIntent.type === 'active-workout'");
    // The resume-vs-gated-confirmation decision now lives in
    // requestStartWorkout (shared with every other entry point) instead of
    // being duplicated inline here — the deep-link effect only decides
    // *whether* to call it.
    expect(appShell).toContain("if (tab !== 'workout' && startWorkoutFlow === 'idle')");
    expect(appShell).toContain('requestStartWorkout();');
    expect(appShell).toContain('consumeIntent(pendingIntent)');

    const deepLinkEffect = appShell.slice(
      appShell.indexOf('useEffect(() => {\n    // RootNavigator'),
      appShell.indexOf('const handleMissDecision'),
    );
    expect(deepLinkEffect).not.toContain("setTab('workout')");
  });
});
