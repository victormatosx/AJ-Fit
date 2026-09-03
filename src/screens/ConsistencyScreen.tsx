import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { useTheme } from '../theme';

/** Retained as a truthful empty state for any stale internal route. The old
 * fixed July-2026 calendar was removed and this screen is no longer linked
 * from production navigation until execution history is wired. */
export function ConsistencyScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ paddingHorizontal: 22, paddingTop: 12 }}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('consistencyUnavailable.back')}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="arrow-left" size={18} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 12 }}>
          <Icon name="calendar" size={28} color={theme.colors.textFaint} />
          <Display size={22} style={{ textAlign: 'center' }}>{t('consistencyUnavailable.title')}</Display>
          <Text style={{ fontFamily: theme.fonts.ui, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
            {t('consistencyUnavailable.body')}
          </Text>
          <MonoLabel style={{ textAlign: 'center' }}>{t('consistencyUnavailable.note')}</MonoLabel>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}
