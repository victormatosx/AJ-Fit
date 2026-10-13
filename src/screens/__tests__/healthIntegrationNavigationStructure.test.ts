import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 2 — navigation wiring guarantees, source-inspection style (see
 * `appShellNavigationStructure.test.ts`). The regression this guards against
 * is concrete: forgetting to add a new overlay flag to `overlayOpen` leaves
 * the Home tab bar interactive underneath the new screen.
 *
 * The Settings entry now opens `ConnectedAppsScreen` first (a navigational
 * list of connectable apps), which in turn opens the pre-existing
 * `HealthIntegrationScreen` — see `ConnectedAppsScreen.tsx`.
 */
const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const APP_SHELL_CODE = APP_SHELL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SETTINGS_SCREEN = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const CONNECTED_APPS_SCREEN = readFileSync('src/screens/ConnectedAppsScreen.tsx', 'utf8');
const CONNECTED_APPS_CODE = CONNECTED_APPS_SCREEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppShell — ConnectedAppsScreen wiring', () => {
  it('imports the screen and declares its own show/hide flag', () => {
    expect(APP_SHELL_CODE).toContain("import { ConnectedAppsScreen } from './ConnectedAppsScreen'");
    expect(APP_SHELL_CODE).toContain('const [showConnectedApps, setShowConnectedApps] = useState(false)');
  });

  it('includes showConnectedApps in overlayOpen — otherwise the tab bar stays interactive underneath it', () => {
    const overlayOpenBlock = APP_SHELL_CODE.slice(
      APP_SHELL_CODE.indexOf('const overlayOpen ='),
      APP_SHELL_CODE.indexOf(';', APP_SHELL_CODE.indexOf('const overlayOpen =')),
    );
    expect(overlayOpenBlock).toContain('showConnectedApps');
  });

  it('renders ConnectedAppsScreen gated by its flag, remounting per uid, and hands it the Health Integration opener', () => {
    const renderIndex = APP_SHELL_CODE.indexOf('showConnectedApps ? (');
    expect(renderIndex).toBeGreaterThan(-1);
    const block = APP_SHELL_CODE.slice(renderIndex, APP_SHELL_CODE.indexOf('<ConnectedAppsScreen', renderIndex) + 400);
    expect(block).toContain('<ConnectedAppsScreen');
    expect(block).toContain("key={user?.uid ?? 'signed-out'}");
    expect(block).toContain('onBack={() => setShowConnectedApps(false)}');
    expect(block).toContain('onOpenHealthIntegration={() => setShowHealthIntegration(true)}');
  });

  it('passes onOpenConnectedApps into SettingsScreen', () => {
    expect(APP_SHELL_CODE).toContain('onOpenConnectedApps={() => setShowConnectedApps(true)}');
  });
});

describe('AppShell — HealthIntegrationScreen wiring (unchanged, now reached via ConnectedAppsScreen)', () => {
  it('imports the screen and declares its own show/hide flag', () => {
    expect(APP_SHELL_CODE).toContain("import { HealthIntegrationScreen } from './HealthIntegrationScreen'");
    expect(APP_SHELL_CODE).toContain('const [showHealthIntegration, setShowHealthIntegration] = useState(false)');
  });

  it('includes showHealthIntegration in overlayOpen — otherwise the tab bar stays interactive underneath it', () => {
    const overlayOpenBlock = APP_SHELL_CODE.slice(
      APP_SHELL_CODE.indexOf('const overlayOpen ='),
      APP_SHELL_CODE.indexOf(';', APP_SHELL_CODE.indexOf('const overlayOpen =')),
    );
    expect(overlayOpenBlock).toContain('showHealthIntegration');
  });

  it('renders HealthIntegrationScreen gated by its flag, remounting per uid like other identity-sensitive secondary screens', () => {
    const renderIndex = APP_SHELL_CODE.indexOf('showHealthIntegration ? (');
    expect(renderIndex).toBeGreaterThan(-1);
    const block = APP_SHELL_CODE.slice(renderIndex, APP_SHELL_CODE.indexOf('<HealthIntegrationScreen', renderIndex) + 400);
    expect(block).toContain('<HealthIntegrationScreen');
    expect(block).toContain("key={user?.uid ?? 'signed-out'}");
    expect(block).toContain('onBack={() => setShowHealthIntegration(false)}');
  });

  it('no longer opens directly from SettingsScreen — only ConnectedAppsScreen triggers it', () => {
    expect(APP_SHELL_CODE).not.toContain('onOpenHealthIntegration={() => setShowHealthIntegration(true)}\n          onOpenAccount');
  });
});

describe('SettingsScreen — "Apps conectados" entry', () => {
  it('accepts onOpenConnectedApps and wires it to a dedicated section', () => {
    expect(SETTINGS_SCREEN).toContain('onOpenConnectedApps?: () => void');
    expect(SETTINGS_SCREEN).toContain("t('settings:sections.healthIntegration')");
    expect(SETTINGS_SCREEN).toContain('onPress: onOpenConnectedApps');
  });

  it('shows a status indicator derived from the local, per-uid persisted intent — not a guess', () => {
    expect(SETTINGS_SCREEN).toContain('getLastKnownHealthIntegrationIntent');
    expect(SETTINGS_SCREEN).toContain("from '../services/healthIntegrationPreferences'");
    expect(SETTINGS_SCREEN).toContain('healthIntegrationStatusLabel');
  });

  it('keeps the Fase 0 and Fase 1 DEV/QA panels present and still gated to development builds', () => {
    expect(SETTINGS_SCREEN).toContain('isHealthSpikeQaPanelAllowed');
    expect(SETTINGS_SCREEN).toContain('HealthSpikeQaSheet');
    expect(SETTINGS_SCREEN).toContain('isHealthIntegrationQaPanelAllowed');
    expect(SETTINGS_SCREEN).toContain('HealthIntegrationQaSheet');
  });
});

describe('ConnectedAppsScreen — list of connectable apps, opens the existing detail screen', () => {
  it('reuses the same persisted-intent read SettingsScreen uses, not a live native check', () => {
    expect(CONNECTED_APPS_CODE).toContain('getLastKnownHealthIntegrationIntent');
    expect(CONNECTED_APPS_CODE).toContain('readHealthIntegrationIntent');
    expect(CONNECTED_APPS_CODE).toContain("from '../services/healthIntegrationPreferences'");
    expect(CONNECTED_APPS_CODE).not.toContain("from '../hooks/useHealthIntegration'");
  });

  it('names the platform-appropriate provider, same convention as the rest of the health feature', () => {
    expect(CONNECTED_APPS_CODE).toContain("platform === 'android' ? 'Health Connect' : 'Apple Health'");
  });

  it('tapping the provider row calls onOpenHealthIntegration — opening the existing HealthIntegrationScreen, not a reimplementation', () => {
    expect(CONNECTED_APPS_CODE).toContain('onPress={onOpenHealthIntegration}');
  });

  it('wires the shared back button accessibility label', () => {
    expect(CONNECTED_APPS_CODE).toContain("accessibilityLabel={t('common:actions.back')}");
    expect(CONNECTED_APPS_CODE).toContain('onPress={onBack}');
  });
});
