import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ptBR from '../../i18n/resources/pt-BR/settings.json';
import en from '../../i18n/resources/en/settings.json';
import es from '../../i18n/resources/es/settings.json';

const securitySource = readFileSync(
  resolve(__dirname, '../../screens/SecurityScreen.tsx'),
  'utf8',
);
const settingsSource = readFileSync(
  resolve(__dirname, '../../screens/SettingsScreen.tsx'),
  'utf8',
);
const appShellSource = readFileSync(
  resolve(__dirname, '../../screens/AppShell.tsx'),
  'utf8',
);
const settingsSectionSource = readFileSync(
  resolve(__dirname, '../../components/ui/SettingsSection.tsx'),
  'utf8',
);
const changePasswordSource = readFileSync(
  resolve(__dirname, '../../screens/ChangePasswordScreen.tsx'),
  'utf8',
);
const passwordServiceSource = readFileSync(
  resolve(__dirname, '../../services/password.ts'),
  'utf8',
);

describe('SecurityScreen structure', () => {
  it('renders the three required sections in order', () => {
    const sectionKeys = ['account', 'access', 'safetyZone'];
    const positions = sectionKeys.map((key) =>
      securitySource.indexOf(`t('security.sections.${key}')`),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('never fabricates device/session/history UI that has no backing implementation', () => {
    for (const forbidden of [
      'currentDevice',
      'manageDevices',
      'securityHistory',
      'Dispositivo atual',
      'Gerenciar dispositivos',
      'Histórico de segurança',
    ]) {
      expect(securitySource).not.toContain(forbidden);
    }
    // The old fake rows also don't survive in the localization resources.
    for (const resource of [ptBR, en, es]) {
      expect(resource.security.items).not.toHaveProperty('currentDevice');
      expect(resource.security.items).not.toHaveProperty('currentDeviceDescription');
      expect(resource.security.items).not.toHaveProperty('manageDevices');
      expect(resource.security.items).not.toHaveProperty('securityHistory');
    }
  });

  it('derives MFA status from the same hook TwoFactorSettingsScreen uses, not a second source of truth', () => {
    expect(securitySource).toContain("useTotpMfa();");
    expect(securitySource).toContain('mfa.enabled');
    expect(securitySource).toContain("t('security.twoFactor.status.enabled')");
    expect(securitySource).toContain("t('security.twoFactor.status.disabled')");
    expect(securitySource).toContain("t('security.twoFactor.status.loading')");
  });

  it('derives access method(s) from real linked providerData, never a client-inferred flow', () => {
    expect(securitySource).toContain('getReauthenticationProviders(user)');
    expect(securitySource).toContain("'security.items.accessMethods'");
    expect(securitySource).toContain("'security.items.accessMethod'");
    expect(securitySource).toContain('accessProviders.length > 1');
  });

  it('derives last login from Firebase Auth metadata, with no line rendered when unavailable', () => {
    expect(securitySource).toContain('parseLastSignInTime(user?.metadata.lastSignInTime)');
    expect(securitySource).toContain('describeLastSignIn(signInDate, locale)');
    expect(securitySource).toMatch(/if \(!signInDate\) return null;/);
  });

  it('keeps unsupported security features out of this screen entirely', () => {
    for (const forbidden of [
      'firebase',
      '/services/',
      'SecureStore',
      'LocalAuthentication',
      'useEffect',
      'useState',
      'Alert.',
    ]) {
      expect(securitySource).not.toContain(forbidden);
    }
  });

  it('opens and closes through the existing Settings overlay pattern', () => {
    expect(settingsSource).toContain('onOpenSecurity?: () => void;');
    expect(settingsSource).toContain('onPress: onOpenSecurity');
    expect(appShellSource).toContain('const [showSecurity, setShowSecurity] = useState(false);');
    expect(appShellSource).toContain('onOpenSecurity={() => setShowSecurity(true)}');
    expect(appShellSource).toContain('<SecurityScreen');
    expect(appShellSource).toContain('onBack={() => setShowSecurity(false)}');
    expect(securitySource).toContain('onOpenTwoFactor: () => void;');
    expect(securitySource).toContain('onPress: onOpenTwoFactor');
    expect(appShellSource).toContain('onOpenTwoFactor={() => setShowTwoFactor(true)}');
    expect(appShellSource).toContain('<TwoFactorSettingsScreen');
  });

  it('still navigates to account deletion through the existing overlay pattern', () => {
    expect(securitySource).toContain('onOpenDeleteAccount?: () => void;');
    expect(securitySource).toContain('onPress: onOpenDeleteAccount ?? (() => {})');
    expect(appShellSource).toContain('onOpenDeleteAccount={() => setShowDeleteAccount(true)}');
    expect(appShellSource).toContain('<DeleteAccountScreen');
  });

  it('guards password navigation for every linked-provider shape', () => {
    expect(securitySource).toContain('linkedProviders.includes(PASSWORD_PROVIDER_ID)');
    expect(securitySource).toContain('canChangePassword && onOpenChangePassword');
    expect(appShellSource).toContain('linkedProviders.includes(PASSWORD_PROVIDER_ID)');
    expect(appShellSource).toContain('showChangePassword && canChangePassword');
    expect(changePasswordSource).toContain('if (!change.allowed) onBack();');
    expect(changePasswordSource).toContain('if (!change.allowed) return null;');
    expect(passwordServiceSource).toContain('if (!hasPasswordProvider(user))');
  });

  it('keeps the mandatory Firebase operation order in the service only', () => {
    expect(changePasswordSource).not.toContain("from 'firebase/auth'");
    expect(passwordServiceSource.indexOf('await reauthenticateWithCredential')).toBeLessThan(
      passwordServiceSource.indexOf('await updatePassword'),
    );
  });

  it('prepares normal, pressed and disabled states in the shared item', () => {
    expect(settingsSectionSource).toContain('disabled?: boolean;');
    expect(settingsSectionSource).toContain('description?: string;');
    expect(settingsSectionSource).toContain('backgroundColor: pressed && interactive ? colors.surfacePressed');
    expect(settingsSectionSource).toContain('opacity: disabled ? opacity.disabled : 1');
    expect(settingsSectionSource).toContain('accessibilityState={onPress ? { disabled } : undefined}');
  });

  it('keeps localized Security copy in parity across pt-BR/en/es', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.security.screenTitle).toBeTruthy();
      expect(Object.keys(resource.security.sections)).toEqual(['account', 'access', 'safetyZone']);
      expect(resource.security.items.accessMethod).toBeTruthy();
      expect(resource.security.items.accessMethods).toBeTruthy();
      expect(resource.security.items.lastLogin).toBeTruthy();
      expect(resource.security.accessMethod.password).toBeTruthy();
      expect(resource.security.accessMethod.google).toBeTruthy();
      expect(resource.security.accessMethod.apple).toBeTruthy();
      expect(resource.security.lastLogin.today).toContain('{{time}}');
      expect(resource.security.lastLogin.yesterday).toContain('{{time}}');
      expect(resource.security.lastLogin.other).toContain('{{date}}');
      expect(resource.security.lastLogin.other).toContain('{{time}}');
      expect(resource.security.safetyZoneDescription).toBeTruthy();
      expect(resource.security.changePassword.feedback.currentPasswordIncorrect).toBeTruthy();
      expect(resource.security.changePassword.feedback.success).toBeTruthy();
    }
  });
});
