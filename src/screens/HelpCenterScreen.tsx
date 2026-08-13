import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { Icon } from '../components/ui/Icon';
import { HELP_CATEGORIES, localHelpArticleRepository } from '../data/helpArticles';
import type { HelpArticle, HelpCategory } from '../types/support';
import { colors, fonts } from '../theme/tokens';

export function HelpCenterScreen({ onBack, onOpenArticle }: { onBack: () => void; onOpenArticle: (article: HelpArticle) => void }) {
  const { t } = useTranslation('support');
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HelpCategory | null>(null);
  useEffect(() => { localHelpArticleRepository.list().then(setArticles); }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return articles.filter(article => (!category || article.category === category) && (!needle || `${t(article.titleKey as never)} ${t(article.contentKey as never)}`.toLocaleLowerCase().includes(needle)));
  }, [articles, category, query, t]);
  return <ScreenBg><SafeAreaView style={{ flex: 1 }} edges={['top']}><SupportScreenHeader title={t('help.title')} onBack={onBack} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}>
    <View style={{ height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardBg, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 10, marginTop: 10 }}><Icon name="help-circle" size={17} color={colors.faint} /><TextInput value={query} onChangeText={setQuery} placeholder={t('help.search')} placeholderTextColor={colors.faint} style={{ flex: 1, color: '#fff', fontFamily: fonts.ui, fontSize: 14 }} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 18 }}>
      <Chip label={t('help.all')} active={!category} onPress={() => setCategory(null)} />
      {HELP_CATEGORIES.map(item => <Chip key={item} label={t(`help.categories.${item}` as never)} active={category === item} onPress={() => setCategory(item)} />)}
    </ScrollView>
    <Text style={{ color: colors.faint, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, marginBottom: 10 }}>{t('help.faq').toUpperCase()}</Text>
    <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.cardBorder }}>{filtered.map((article, index) => <Pressable key={article.id} onPress={() => onOpenArticle(article)} style={({ pressed }) => ({ minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, backgroundColor: pressed ? colors.cardBgHi : colors.cardBg, borderTopWidth: index ? 1 : 0, borderTopColor: colors.hair })}><Text style={{ flex: 1, color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14, lineHeight: 19 }}>{t(article.titleKey as never)}</Text><Icon name="chevron-right" size={15} color={colors.faint} /></Pressable>)}</View>
    {!filtered.length && <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 14, textAlign: 'center', marginTop: 30 }}>{t('help.empty')}</Text>}
  </ScrollView></SafeAreaView></ScreenBg>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: active ? colors.accentHi : colors.cardBorder, backgroundColor: active ? 'rgba(11,112,249,0.18)' : colors.cardBg }}><Text style={{ color: active ? '#fff' : colors.mute, fontFamily: fonts.uiSemi, fontSize: 12 }}>{label}</Text></Pressable>; }
