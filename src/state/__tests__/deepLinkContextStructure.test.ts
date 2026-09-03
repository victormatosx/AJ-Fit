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
    expect(appShell).toContain("if (tab !== 'workout' && !showWorkoutConfirmation)");
    expect(appShell).toContain('setShowWorkoutConfirmation(true)');
    expect(appShell).toContain('consumeIntent(pendingIntent)');

    const deepLinkEffect = appShell.slice(
      appShell.indexOf("if (!pendingIntent || overlayOpen) return;"),
      appShell.indexOf('// FASE 3→5'),
    );
    expect(deepLinkEffect).not.toContain("setTab('workout')");
  });
});
