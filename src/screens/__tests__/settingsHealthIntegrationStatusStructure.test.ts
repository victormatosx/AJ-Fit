import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 2 follow-up: the "Integrações de saúde" row in SettingsScreen must
 * reflect the *persisted* intent after a cold app start, not just the
 * in-memory hint (which is empty until the health screen has been opened at
 * least once this session). No component renderer in this Node-only suite
 * (see `usePremiumCapabilities.test.ts`), so this reads the source directly —
 * same convention as every other screen-structure test in this repo.
 */
const SETTINGS_SCREEN = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const SETTINGS_CODE = SETTINGS_SCREEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('SettingsScreen — health integration status survives a cold app start', () => {
  it('confirms the status against the persisted value, not only the in-memory hint', () => {
    expect(SETTINGS_SCREEN).toContain(
      "import {\n  getLastKnownHealthIntegrationIntent,\n  readHealthIntegrationIntent,\n} from '../services/healthIntegrationPreferences'",
    );
    expect(SETTINGS_CODE).toContain('readHealthIntegrationIntent(uid)');
  });

  it('never seeds the status as "not_configured" while the persisted value is still loading', () => {
    // The initial useState seed falls back to the 'loading' sentinel, not
    // 'not_configured', whenever there is no warm in-memory hint yet.
    expect(SETTINGS_CODE).toContain(
      "useState<HealthConnectionIntent | 'loading'>(\n    () => (user ? getLastKnownHealthIntegrationIntent(user.uid) ?? 'loading' : 'not_configured'),",
    );
  });

  it('translates the loading state through a dedicated, distinct i18n key — never reuses "not configured" copy', () => {
    expect(SETTINGS_CODE).toContain("healthIntegrationIntent === 'loading'");
    expect(SETTINGS_CODE).toContain("t('settings:values.healthIntegrationLoading')");
  });
});

describe('SettingsScreen — health integration status updates on return / account switch', () => {
  it('refreshes on mount/uid change AND every time this screen regains focus', () => {
    expect(SETTINGS_CODE).toContain('useEffect(() => {\n    refreshHealthIntegrationIntent();\n  }, [refreshHealthIntegrationIntent]);');
    expect(SETTINGS_CODE).toContain('useScreenFocusEffect(() => {\n    refreshHealthIntegrationIntent();\n  });');
  });

  it('re-seeds the uid ref and re-derives the sync hint before the persisted read resolves, for every uid (including signed-out)', () => {
    const fnStart = SETTINGS_CODE.indexOf('const refreshHealthIntegrationIntent = useCallback(() => {');
    const fnEnd = SETTINGS_CODE.indexOf('}, [uid]);', fnStart);
    const fn = SETTINGS_CODE.slice(fnStart, fnEnd);
    expect(fn).toContain('healthIntegrationUidRef.current = uid');
    expect(fn).toContain("setHealthIntegrationIntent('not_configured')");
    expect(fn).toContain("setHealthIntegrationIntent(getLastKnownHealthIntegrationIntent(uid) ?? 'loading')");
  });

  it('guards the async confirmation against a stale uid — an outgoing account\'s late response must not overwrite the new account\'s row', () => {
    const readCallIndex = SETTINGS_CODE.indexOf('readHealthIntegrationIntent(uid).then((intent) => {');
    expect(readCallIndex).toBeGreaterThan(-1);
    const callbackBody = SETTINGS_CODE.slice(readCallIndex, SETTINGS_CODE.indexOf('});', readCallIndex));
    expect(callbackBody).toContain('if (healthIntegrationUidRef.current !== uid) return;');
  });
});

describe('SettingsScreen — intent is never confused with native authorization', () => {
  it('derives the row status only from the persisted intent, never from an OS-reported permission snapshot', () => {
    expect(SETTINGS_CODE).not.toContain('HealthAuthorizationSnapshot');
    expect(SETTINGS_CODE).not.toContain('getGrantedHealthPermissions');
    expect(SETTINGS_CODE).not.toContain('requestHealthPermissions');
  });
});
