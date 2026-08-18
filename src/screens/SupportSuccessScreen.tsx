import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { colors, fonts, spacing } from '../theme/tokens';
import { useScreenFocusEffect } from '../state/ScreenActivity';

const AUTO_RETURN_MS = 3000;

export function SupportSuccessScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('support');

  // Auto-return is tied to ACTIVATION, not mount: this screen is
  // prewarmed+materialized (docs/23_navegacao_e_lifecycle.md §14) and stays
  // alive across every support flow, so a plain useEffect(fn, []) would only
  // fire once for the component's whole lifetime instead of once per visit.
  // The cleanup returned here runs the moment the screen deactivates —
  // whether that's the timer's own `onBack()` navigating away or the user
  // leaving manually before the 3s mark — so a stale timer can never fire
  // `onBack()` a second time after the user already moved on.
  useScreenFocusEffect(() => {
    const timer = setTimeout(onBack, AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  });

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: spacing[6], justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <Icon name="check" size={40} color="#60d99a" stroke={2.4} />

          <MonoLabel color="#60d99a" style={{ marginTop: spacing[6] }}>
            {t('success.eyebrow')}
          </MonoLabel>
          <Display size={28} style={{ textAlign: 'center', marginTop: spacing[3] }}>
            {t('success.title')}
          </Display>
          <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 22, textAlign: 'center', marginTop: spacing[3], maxWidth: 300 }}>
            {t('success.subtitle')}
          </Text>
        </View>

        <View style={{ marginTop: spacing[10], alignItems: 'center' }}>
          <Text style={{ color: colors.faint, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.5 }}>
            {t('success.returning').toUpperCase()}
          </Text>
          <Pressable accessibilityRole="button" onPress={onBack} style={{ marginTop: spacing[3], paddingVertical: spacing[2], paddingHorizontal: spacing[3] }}>
            <Text style={{ color: colors.mute, fontFamily: fonts.uiMed, fontSize: 13 }}>{t('success.back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}
