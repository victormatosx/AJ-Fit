import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton } from '../components/ui/CtaButton';
import { Display, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import type { HelpArticle } from '../types/support';
import { colors, fonts } from '../theme/tokens';

export function HelpArticleScreen({ article, onBack, onOpenTicket }: { article: HelpArticle; onBack: () => void; onOpenTicket: (subject: string) => void }) {
  const { t } = useTranslation('support');
  const [resolved, setResolved] = useState<boolean | null>(null);
  const title = t(article.titleKey as never);
  return <ScreenBg><SafeAreaView style={{ flex: 1 }} edges={['top']}><SupportScreenHeader title={t('article.header')} onBack={onBack} /><ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
    <Slash>{t(`help.categories.${article.category}` as never)}</Slash><Display size={30} style={{ marginTop: 12 }}>{title}</Display>
    <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: fonts.ui, fontSize: 15, lineHeight: 24, marginTop: 20 }}>{t(article.contentKey as never)}</Text>
    <View style={{ height: 1, backgroundColor: colors.hair, marginVertical: 28 }} /><Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 15, textAlign: 'center', marginBottom: 14 }}>{t('article.solved')}</Text>
    {resolved === null && <View style={{ flexDirection: 'row', gap: 10 }}><CtaButton style={{ flex: 1 }} onPress={() => setResolved(true)}>{t('article.yes')}</CtaButton><CtaButton ghost style={{ flex: 1 }} onPress={() => setResolved(false)}>{t('article.no')}</CtaButton></View>}
    {resolved === true && <View style={{ alignItems: 'center', gap: 10 }}><Icon name="check" size={24} color="#60d99a" /><Text style={{ color: '#60d99a', fontFamily: fonts.uiSemi }}>{t('article.glad')}</Text></View>}
    {resolved === false && <View style={{ padding: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardBg }}><Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 16, marginBottom: 12 }}>{t('article.stillNeedHelp')}</Text><CtaButton onPress={() => onOpenTicket(title)}>{t('article.openTicket')}</CtaButton></View>}
  </ScrollView></SafeAreaView></ScreenBg>;
}
