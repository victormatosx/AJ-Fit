import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ptBR from '../../i18n/resources/pt-BR/settings.json';
import en from '../../i18n/resources/en/settings.json';
import es from '../../i18n/resources/es/settings.json';

const screenSource = readFileSync(
  resolve(__dirname, '../../screens/TwoFactorSettingsScreen.tsx'),
  'utf8',
);

describe('TwoFactorSettingsScreen visual redesign — logic untouched', () => {
  it('still derives status from the exact same useTotpMfa() hook, no second source of truth', () => {
    expect(screenSource).toContain("from '../hooks/useTotpMfa'");
    expect(screenSource).toContain('useTotpMfa(refreshToken)');
    // Status is computed purely from mfa.loading / statusUnavailable / mfa.enabled —
    // no other flag introduced to represent MFA state.
    expect(screenSource).toContain('const statusLabel = mfa.loading');
    expect(screenSource).toContain(
      "const statusUnavailable =\n    !mfa.loading && mfa.factors.length === 0 && mfa.issue !== null;",
    );
  });

  it('keeps the exact reactivation refresh/cleanup contract (docs/23 §10)', () => {
    expect(screenSource).toMatch(/useScreenFocusEffect\(\(\) => \{\s*void mfa\.refresh\(\);/);
    const start = screenSource.indexOf('useScreenFocusEffect(() => {');
    const cleanupStart = screenSource.indexOf('return () => {', start);
    const cleanupBlock = screenSource.slice(
      cleanupStart,
      screenSource.indexOf('};', cleanupStart) + 2,
    );
    expect(cleanupBlock).toContain('mfa.cancelDisable()');
    expect(cleanupBlock).not.toContain('setFactors');
  });

  it('the enable CTA still calls onOpenEnrollment directly, gated by canReauthenticate only', () => {
    expect(screenSource).toContain('onPress={onOpenEnrollment}');
    expect(screenSource).toContain('disabled={!mfa.canReauthenticate}');
  });

  it('the disable action still routes through the same confirmation + hook call', () => {
    expect(screenSource).toContain('const requestDisable = (factor: TotpFactor) => {');
    expect(screenSource).toContain('onPress: () => mfa.requestDisable(factor)');
    expect(screenSource).toContain('onPress={() => requestDisable(factor)}');
    // Disable row disabled exactly when disabling or reauthentication is unsupported —
    // same condition the old inline button used.
    expect(screenSource).toContain(
      'const disableDisabled = mfa.disabling || !mfa.canReauthenticate;',
    );
  });

  it('never fabricates enrollment metadata beyond what the service already returns', () => {
    for (const forbidden of ['enrolledDevice', 'deviceCount', 'lastCode', 'recoveryCode']) {
      expect(screenSource).not.toContain(forbidden);
    }
    // Enrollment date still comes from the real factor, not a guess.
    expect(screenSource).toContain('formatEnrollmentDate(\n                  factor.enrollmentTime,');
  });

  it('never touches Firebase, AsyncStorage or SecureStore directly from this screen', () => {
    for (const forbidden of [
      "from 'firebase/auth'",
      "from '@react-native-async-storage/async-storage'",
      "from 'expo-secure-store'",
      'console.log',
      'console.error',
    ]) {
      expect(screenSource).not.toContain(forbidden);
    }
  });

  it('reuses design-system tokens instead of new hardcoded colors for the redesigned hero/CTA', () => {
    expect(screenSource).toContain('colors.accentHi');
    expect(screenSource).toContain('colors.success');
    expect(screenSource).toContain('colors.dangerText');
    expect(screenSource).toContain('colors.textSecondary');
    // The only pre-existing hardcoded color is the untouched modal background.
    const hexLiterals = screenSource.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    expect(hexLiterals).toEqual(['#0a0620']);
  });

  it('ships the new copy in pt-BR, en and es without dropping existing keys', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.security.twoFactor.status.enabledSummary).toBeTruthy();
      expect(resource.security.twoFactor.actions.disableTwoFactor).toBeTruthy();
      expect(resource.security.twoFactor.status.enabled).toBeTruthy();
      expect(resource.security.twoFactor.status.disabled).toBeTruthy();
      expect(resource.security.twoFactor.actions.enable).toBeTruthy();
      expect(resource.security.twoFactor.actions.disable).toBeTruthy();
    }
  });

  it('renders the new copy keys in the screen source', () => {
    expect(screenSource).toContain("t('security.twoFactor.status.enabledSummary')");
    expect(screenSource).toContain("t('security.twoFactor.actions.disableTwoFactor')");
    expect(screenSource).toContain("t('security.twoFactor.description')");
  });
});
