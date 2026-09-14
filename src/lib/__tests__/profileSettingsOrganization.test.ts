import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const profileSource = readFileSync(
  resolve(__dirname, '../../screens/ProfileScreen.tsx'),
  'utf8',
);
const settingsSource = readFileSync(
  resolve(__dirname, '../../screens/SettingsScreen.tsx'),
  'utf8',
);
const accountSettingsSource = readFileSync(
  resolve(__dirname, '../../screens/AccountSettingsScreen.tsx'),
  'utf8',
);
const smartAlertsSource = readFileSync(
  resolve(__dirname, '../../components/ui/SmartAlertsSection.tsx'),
  'utf8',
);

describe('Profile and Settings organization', () => {
  it('keeps Profile focused on identity, progress and account', () => {
    expect(profileSource).toContain("t('groups.evolution.title')");
    expect(profileSource).toContain("label: t('assessment.title')");
    expect(profileSource).toContain('onPress: onOpenAssessment');
    expect(profileSource).toContain("label: t('groups.goalsPlan.items.viewPlan')");
    expect(profileSource).toContain("label: t('groups.account.items.editProfile')");
    expect(profileSource).toContain("label: t('groups.account.items.settings')");
    expect(profileSource).toContain('onPress: onOpenSettings');
    expect(profileSource).not.toContain("label: t('groups.account.items.subscription')");
    expect(profileSource).not.toContain('onOpenSubscription');

    expect(profileSource).not.toContain("t('groups.goalsPlan.items.goal.label')");
    expect(profileSource).not.toContain("t('groups.goalsPlan.items.plan.label')");
    expect(profileSource).not.toContain("t('groups.goalsPlan.items.frequency.label')");
    expect(profileSource).not.toContain("t('groups.preferences.title')");
    expect(profileSource).not.toContain("t('groups.account.items.privacy')");
    expect(profileSource).not.toContain('<LinearGradient');
  });

  it('preserves login methods and session behavior in Profile', () => {
    expect(profileSource).toContain('PROVIDER_META.map');
    expect(profileSource).toContain('linkedProviders.includes');
    expect(profileSource).toContain('onPress: confirmLogout');
    expect(profileSource).toContain('logout().catch');
  });

  it('prepares smart alerts without rendering an empty slot', () => {
    expect(profileSource).toContain(
      "<SmartAlertsSection title={t('smartAlerts.title').toUpperCase()} items={[]} />",
    );
    expect(smartAlertsSource).toContain('if (items.length === 0) return null;');
    expect(smartAlertsSource).toContain('items: SmartAlertItem[]');
  });

  it('keeps only app behavior preferences in Settings', () => {
    expect(settingsSource).not.toContain("t('settings:sections.workout')");
    expect(settingsSource).not.toContain("t('settings:items.subscription')");
    expect(settingsSource).not.toContain("t('settings:items.loginMethods')");
    expect(settingsSource).not.toContain("t('settings:items.workoutPreferences')");

    expect(settingsSource).toContain("t('settings:items.notifications')");
    expect(settingsSource).not.toContain("t('settings:items.timersAndSounds')");

    expect(settingsSource).toContain('setLangPickerOpen(true)');
    expect(settingsSource).toContain('changeLanguageForUser({ uid: user.uid, next })');
    expect(settingsSource).toContain('setUnitsPickerOpen(true)');
    expect(settingsSource).toContain('changeUnitsForUser({ uid: user.uid, next })');
  });

  it('reads the displayed app version from the Expo app config', () => {
    expect(settingsSource).toContain("import Constants from 'expo-constants'");
    expect(settingsSource).toContain('const appVersion = Constants.expoConfig?.version;');
    expect(settingsSource).toContain('value: appVersionLabel');
    expect(settingsSource).not.toContain("value: 'v1.0.0'");
  });

  it('opens Account from Privacy and Data and preserves the legal and Support actions', () => {
    for (const key of [
      'account',
      'privacyPolicy',
      'termsOfUse',
    ]) {
      expect(settingsSource).toContain(`t('settings:items.${key}')`);
    }
    expect(settingsSource).not.toContain("t('settings:items.deleteAccount')");
    expect(settingsSource).not.toContain("t('settings:items.acceptedConsents')");
    expect(settingsSource).not.toContain("t('settings:items.exportData')");

    expect(settingsSource).toContain('onPress: onOpenHelpCenter');
    expect(settingsSource).toContain('onPress: onReportProblem');
    expect(settingsSource).toContain('onPress: onSendSuggestion');
  });

  it('centralizes Subscription and Delete account in the Account sub-screen', () => {
    expect(accountSettingsSource).toContain("label: t('items.subscription')");
    expect(accountSettingsSource).toContain('onPress: onOpenSubscription');
    expect(accountSettingsSource).toContain("label: t('items.deleteAccount')");
    expect(accountSettingsSource).toContain('onPress: onOpenDeleteAccount');
    expect(accountSettingsSource).toContain('danger: true');
  });
});
