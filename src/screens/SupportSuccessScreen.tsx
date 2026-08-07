import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton } from '../components/ui/CtaButton';
import { Display } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

export function SupportSuccessScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('support');
  return <ScreenBg><SafeAreaView style={{ flex: 1, padding: 26, justifyContent: 'center' }}><View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: 'rgba(42,202,123,0.12)', borderWidth: 1, borderColor: 'rgba(42,202,123,0.35)', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}><Icon name="check" size={32} color="#60d99a" stroke={2.2} /></View><Display size={34} style={{ textAlign: 'center', marginTop: 24 }}>{t('success.title')}</Display><Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10, marginBottom: 30 }}>{t('success.subtitle')}</Text><CtaButton onPress={onBack}>{t('success.back')}</CtaButton></SafeAreaView></ScreenBg>;
}
