import { useMemo } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SettingsSection, type SettingsItemData } from '../components/ui/SettingsSection';
import {
  getReauthenticationProviders,
  PASSWORD_PROVIDER_ID,
  type ReauthenticationProvider,
} from '../lib/authProviders';
import { describeLastSignIn, parseLastSignInTime } from '../lib/lastSignIn';
import { useAuth } from '../state/AuthContext';
import { spacing } from '../theme/tokens';

/** Firebase provider IDs, in the exact order `getReauthenticationProviders` returns them. */
const ACCESS_METHOD_LABEL_KEY: Record<ReauthenticationProvider, string> = {
  password: 'security.accessMethod.password',
  google: 'security.accessMethod.google',
  apple: 'security.accessMethod.apple',
};

export function SecurityScreen({
  onBack,
  onOpenChangePassword,
}: {
  onBack: () => void;
  onOpenChangePassword?: () => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const { user, linkedProviders } = useAuth();
  const canChangePassword = linkedProviders.includes(PASSWORD_PROVIDER_ID);

  // `user` (and therefore `providerData`) comes straight from AuthContext,
  // which replaces it wholesale on every auth-state change — no stale
  // per-UID cache to worry about across an A → logout → B transition.
  const accessProviders = useMemo(() => getReauthenticationProviders(user), [user]);
  const accessMethodValue = accessProviders.length
    ? accessProviders.map((provider) => t(ACCESS_METHOD_LABEL_KEY[provider] as never)).join(', ')
    : null;

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const lastSignInLabel = useMemo(() => {
    const signInDate = parseLastSignInTime(user?.metadata.lastSignInTime);
    if (!signInDate) return null;
    const description = describeLastSignIn(signInDate, locale);
    if (description.kind === 'today') {
      return t('security.lastLogin.today', { time: description.time });
    }
    if (description.kind === 'yesterday') {
      return t('security.lastLogin.yesterday', { time: description.time });
    }
    return t('security.lastLogin.other', { date: description.date, time: description.time });
  }, [user?.metadata.lastSignInTime, locale, t]);

  const protectionItems: SettingsItemData[] = canChangePassword && onOpenChangePassword
    ? [{ icon: 'key', label: t('security.items.changePassword'), onPress: onOpenChangePassword }]
    : [];

  const accessItems: SettingsItemData[] = [
    ...(accessMethodValue
      ? [
          {
            icon: 'lock' as const,
            label: t(
              accessProviders.length > 1
                ? 'security.items.accessMethods'
                : 'security.items.accessMethod',
            ),
            description: accessMethodValue,
          },
        ]
      : []),
    ...(lastSignInLabel
      ? [
          {
            icon: 'timer' as const,
            label: t('security.items.lastLogin'),
            description: lastSignInLabel,
          },
        ]
      : []),
  ];

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader title={t('security.screenTitle')} onBack={onBack} />
        <ScrollView
          contentContainerStyle={{ paddingTop: spacing[3.5], paddingBottom: spacing[10] }}
          showsVerticalScrollIndicator={false}
        >
          {protectionItems.length > 0 && (
            <SettingsSection
              title={t('security.sections.account').toUpperCase()}
              items={protectionItems}
            />
          )}

          {accessItems.length > 0 && (
            <SettingsSection
              title={t('security.sections.access').toUpperCase()}
              items={accessItems}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
