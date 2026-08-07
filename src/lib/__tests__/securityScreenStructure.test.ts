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
  it('renders the four required sections in order', () => {
    const sectionKeys = ['account', 'sessions', 'activity', 'safetyZone'];
    const positions = sectionKeys.map((key) =>
      securitySource.indexOf(`t('security.sections.${key}')`),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('renders all eight requested entries and both secondary texts', () => {
    for (const key of [
      'changePassword',
      'biometrics',
      'twoFactor',
      'currentDevice',
      'manageDevices',
      'lastLogin',
      'securityHistory',
      'deleteAccount',
    ]) {
      expect(securitySource).toContain(`t('security.items.${key}')`);
    }

    expect(securitySource).toContain("description: t('security.items.currentDeviceDescription')");
    expect(securitySource).toContain("description: t('security.items.lastLoginDescription')");
    expect(securitySource).toContain("description={t('security.safetyZoneDescription')}");
    expect(securitySource).toMatch(/deleteAccount'[\s\S]{0,120}danger: true/);
  });

  it('keeps unsupported security features UI-only', () => {
    for (const forbidden of [
      'firebase',
      '/services/',
      'SecureStore',
      'LocalAuthentication',
      'useEffect',
      'useState',
      'async ',
      'await ',
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

  it('keeps localized Security copy in parity', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.security.screenTitle).toBeTruthy();
      expect(Object.keys(resource.security.sections)).toEqual([
        'account',
        'sessions',
        'activity',
        'safetyZone',
      ]);
      expect(resource.security.items.currentDeviceDescription).toBeTruthy();
      expect(resource.security.items.lastLoginDescription).toBeTruthy();
      expect(resource.security.safetyZoneDescription).toBeTruthy();
      expect(resource.security.changePassword.feedback.currentPasswordIncorrect).toBeTruthy();
      expect(resource.security.changePassword.feedback.success).toBeTruthy();
    }
  });
});
