import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SettingsSection } from '../components/ui/SettingsSection';

export function AccountSettingsScreen({
  onBack,
  onOpenDeleteAccount,
  onOpenSubscription,
}: {
  onBack: () => void;
  onOpenDeleteAccount?: () => void;
  onOpenSubscription?: () => void;
}) {
  const { t } = useTranslation('settings');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader title={t('items.account')} onBack={onBack} />
        <ScrollView
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <SettingsSection
            title={t('items.account').toUpperCase()}
            items={[
              {
                icon: 'crown',
                label: t('items.subscription'),
                onPress: onOpenSubscription,
              },
              {
                icon: 'trash',
                label: t('items.deleteAccount'),
                danger: true,
                onPress: onOpenDeleteAccount,
              },
            ]}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
