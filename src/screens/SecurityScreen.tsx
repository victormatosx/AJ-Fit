import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SettingsSection } from '../components/ui/SettingsSection';
import { PASSWORD_PROVIDER_ID } from '../lib/authProviders';
import { useAuth } from '../state/AuthContext';
import { spacing } from '../theme/tokens';

export function SecurityScreen({
  onBack,
  onOpenChangePassword,
}: {
  onBack: () => void;
  onOpenChangePassword?: () => void;
}) {
  const { t } = useTranslation('settings');
  const { linkedProviders } = useAuth();
  const canChangePassword = linkedProviders.includes(PASSWORD_PROVIDER_ID);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader title={t('security.screenTitle')} onBack={onBack} />
        <ScrollView
          contentContainerStyle={{ paddingTop: spacing[3.5], paddingBottom: spacing[10] }}
          showsVerticalScrollIndicator={false}
        >
          <SettingsSection
            title={t('security.sections.account').toUpperCase()}
            items={[
              ...(canChangePassword && onOpenChangePassword
                ? [{
                    icon: 'key' as const,
                    label: t('security.items.changePassword'),
                    onPress: onOpenChangePassword,
                  }]
                : []),
              { icon: 'eye', label: t('security.items.biometrics'), onPress: () => {} },
              { icon: 'shield', label: t('security.items.twoFactor'), onPress: () => {} },
            ]}
          />

          <SettingsSection
            title={t('security.sections.sessions').toUpperCase()}
            items={[
              {
                icon: 'check',
                label: t('security.items.currentDevice'),
                description: t('security.items.currentDeviceDescription'),
                onPress: () => {},
              },
              { icon: 'list', label: t('security.items.manageDevices'), onPress: () => {} },
            ]}
          />

          <SettingsSection
            title={t('security.sections.activity').toUpperCase()}
            items={[
              {
                icon: 'timer',
                label: t('security.items.lastLogin'),
                description: t('security.items.lastLoginDescription'),
                onPress: () => {},
              },
              { icon: 'file-text', label: t('security.items.securityHistory'), onPress: () => {} },
            ]}
          />

          <SettingsSection
            title={t('security.sections.safetyZone').toUpperCase()}
            description={t('security.safetyZoneDescription')}
            items={[
              {
                icon: 'trash',
                label: t('security.items.deleteAccount'),
                danger: true,
                onPress: () => {},
              },
            ]}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
