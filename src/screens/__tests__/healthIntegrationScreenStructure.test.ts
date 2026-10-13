import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 2 — structural guarantees for `HealthIntegrationScreen.tsx`. No
 * component renderer in this Node-only suite (see `usePremiumCapabilities.test.ts`
 * / `restOverlayNextExerciseStructure.test.ts` for the same pattern), so this
 * reads the source directly. Each check maps to an explicit Fase 2
 * requirement that would otherwise be easy to silently regress.
 */
const SCREEN_SOURCE = readFileSync('src/screens/HealthIntegrationScreen.tsx', 'utf8');
const SCREEN_CODE = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('HealthIntegrationScreen — reuses Fase 0/1 infrastructure, no second implementation', () => {
  it('uses the shared hook as its only source of connection/permission state', () => {
    expect(SCREEN_SOURCE).toContain(
      "import { useHealthIntegration, type UseHealthIntegrationResult } from '../hooks/useHealthIntegration'",
    );
  });

  it('never imports the native-facing service modules directly — no parallel connection/permission logic', () => {
    expect(SCREEN_CODE).not.toContain("from '../services/healthIntegration'");
    expect(SCREEN_CODE).not.toContain("from '../services/healthIntegrationPreferences'");
    expect(SCREEN_CODE).not.toContain('requestHealthPermissions(');
    expect(SCREEN_CODE).not.toContain('setHealthIntegrationIntent(');
    expect(SCREEN_CODE).not.toContain('checkHealthAvailability(');
  });

  it('scopes to the authenticated uid via useAuth, like every other identity-sensitive settings screen', () => {
    expect(SCREEN_SOURCE).toContain("import { useAuth } from '../state/AuthContext'");
    expect(SCREEN_SOURCE).toContain('const uid = user?.uid ?? null');
    expect(SCREEN_SOURCE).toContain('useHealthIntegration(uid)');
  });
});

describe('HealthIntegrationScreen — availability gate runs before connected/disconnected content', () => {
  it('checks unsupported/unavailable before branching on intent', () => {
    const availabilityCheckIndex = SCREEN_CODE.indexOf("health.availability.status === 'unsupported'");
    const intentCheckIndex = SCREEN_CODE.indexOf("health.intent === 'enabled'");
    expect(availabilityCheckIndex).toBeGreaterThan(-1);
    expect(intentCheckIndex).toBeGreaterThan(-1);
    expect(availabilityCheckIndex).toBeLessThan(intentCheckIndex);
  });

  it('never claims success in the unavailable/error path — renders UnavailableState, not the connected view', () => {
    const block = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf("health.availability.status === 'unsupported'"),
      SCREEN_CODE.indexOf("if (health.intent === 'enabled')"),
    );
    expect(block).toContain('<UnavailableState');
    expect(block).not.toContain("t('health:connected.statusTitle')");
  });

  it('shows a full-screen loading state before any availability/intent content, avoiding a wrong-state flash', () => {
    const loadingIndex = SCREEN_CODE.indexOf('health.loading');
    const availabilityIndex = SCREEN_CODE.indexOf("health.availability.status === 'unsupported'");
    expect(loadingIndex).toBeGreaterThan(-1);
    expect(loadingIndex).toBeLessThan(availabilityIndex);
    expect(SCREEN_SOURCE).toContain('<FullScreenLoading');
  });
});

describe('HealthIntegrationScreen — platform isolation (no iOS copy on Android, no Android copy on iOS)', () => {
  it('only shows the Android granted-permission pills behind an explicit platform check', () => {
    const occurrences = SCREEN_CODE.split("health.platform === 'android'").length - 1;
    // Weight row trailing + workout row trailing = 2 call sites.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('only shows the iOS "cannot verify permission" notice behind an explicit iOS check', () => {
    const noticeIndex = SCREEN_CODE.indexOf('connected.iosPermissionNotice');
    expect(noticeIndex).toBeGreaterThan(-1);
    const guardIndex = SCREEN_CODE.lastIndexOf("health.platform === 'ios'", noticeIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    // The guard must be the nearest preceding conditional, not an unrelated
    // earlier check — nothing Android-specific sits between them.
    expect(SCREEN_CODE.slice(guardIndex, noticeIndex)).not.toContain("platform === 'android'");
  });

  it('never presents OS authorization as "granted" for iOS — permissionsRequested is treated as non-committal', () => {
    expect(SCREEN_SOURCE).toContain('connected.iosPermissionNotice');
    // The platform-agnostic "granted" pill logic only reads `.granted` off the
    // Android arm of the discriminated union; iOS never resolves `isWeightGranted`/
    // `isWorkoutGranted` to true because `grantedAndroid` is null on iOS.
    expect(SCREEN_CODE).toContain("health.authorization?.platform === 'android' ? health.authorization.granted : null");
  });
});

describe('HealthIntegrationScreen — disconnect requires explicit confirmation', () => {
  it('never calls disconnect() directly from the disconnect row — it only opens a confirmation sheet', () => {
    const rowIndex = SCREEN_CODE.indexOf("accessibilityLabel={t('health:connected.disconnectAction', { provider })}");
    expect(rowIndex).toBeGreaterThan(-1);
    const nearbyOnPress = SCREEN_CODE.slice(rowIndex, SCREEN_CODE.indexOf('</Pressable>', rowIndex));
    expect(nearbyOnPress).toContain('setConfirmingDisconnect(true)');
    expect(nearbyOnPress).not.toContain('health.disconnect()');
  });

  it('calls disconnect() only from inside the confirmation sheet', () => {
    const sheetDeclIndex = SCREEN_CODE.indexOf('function DisconnectConfirmSheet');
    const disconnectCallIndex = SCREEN_CODE.indexOf('health.disconnect()');
    expect(sheetDeclIndex).toBeGreaterThan(-1);
    expect(disconnectCallIndex).toBeGreaterThan(-1);
    // The actual disconnect() call lives in the <DisconnectConfirmSheet onConfirm>
    // wiring below the component definitions, not inside the sheet's own body —
    // assert it is NOT inside the connected-state row construction instead.
    const connectedRowStart = SCREEN_CODE.indexOf("if (health.intent === 'enabled')");
    const connectedRowEnd = SCREEN_CODE.indexOf('disconnected.heroTitle');
    const connectedRowBlock = SCREEN_CODE.slice(connectedRowStart, connectedRowEnd);
    expect(connectedRowBlock).not.toContain('health.disconnect()');
  });

  it('explains consequences in the confirmation copy (does not revoke OS access, does not delete prior records)', () => {
    expect(SCREEN_SOURCE).toContain("t('health:disconnectConfirm.body'");
  });
});

describe('HealthIntegrationScreen — Fase 3 boundary: no fictitious data-deletion action', () => {
  it('does not implement any "delete imported data" action yet', () => {
    for (const forbidden of ['deleteImportedData', 'excludedImportedData', 'eraseHealthData', 'wipeHealthData']) {
      expect(SCREEN_CODE).not.toContain(forbidden);
    }
    expect(SCREEN_SOURCE).not.toContain('health:deleteImportedData');
  });
});

describe('HealthIntegrationScreen — concurrency guards are wired into the UI', () => {
  it('disables the Connect action while a request is already in flight', () => {
    const connectButtonIndex = SCREEN_CODE.indexOf('health.connect()');
    const nearby = SCREEN_CODE.slice(connectButtonIndex, connectButtonIndex + 400);
    expect(nearby).toContain('disabled={health.requestingPermissions}');
  });

  it('disables the Disconnect confirmation while a disconnect is already in flight', () => {
    expect(SCREEN_CODE).toContain('disabled={health.disconnecting}');
    expect(SCREEN_CODE).toContain('busy={health.disconnecting}');
  });

  it('disables retry while an availability refresh is already running', () => {
    expect(SCREEN_CODE).toContain('retrying={health.refreshing}');
    expect(SCREEN_CODE).toContain('disabled={retrying}');
  });
});

describe('HealthIntegrationScreen — errors are translated, never a raw/English-only message', () => {
  it('renders the error banner from a stable errorCode via i18n, not a raw error message string', () => {
    expect(SCREEN_SOURCE).toContain('health.errorCode');
    expect(SCREEN_CODE).toContain('t(`health:errors.${health.errorCode}`');
    expect(SCREEN_CODE).not.toContain('health.error}');
    expect(SCREEN_CODE).not.toContain('{health.error}');
  });

  it('reloads on resume from background and on screen focus, so a permission change in native settings is reflected', () => {
    expect(SCREEN_SOURCE).toContain('useScreenFocusEffect');
    expect(SCREEN_SOURCE).toContain("AppState.addEventListener('change'");
  });
});
