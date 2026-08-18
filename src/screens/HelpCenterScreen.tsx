import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { SupportChip } from '../components/support/SupportChip';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Icon, type IconName } from '../components/ui/Icon';
import { HELP_CATEGORIES, localHelpArticleRepository } from '../data/helpArticles';
import type { HelpArticle, HelpCategory } from '../types/support';
import { alpha, colors, fonts, radii, spacing } from '../theme/tokens';
import { useScreenFocusEffect } from '../state/ScreenActivity';

export function HelpCenterScreen({
  onBack,
  onOpenArticle,
  onOpenReportProblem,
  onOpenSuggestion,
  onOpenTalkToSupport,
}: {
  onBack: () => void;
  onOpenArticle: (article: HelpArticle) => void;
  onOpenReportProblem?: () => void;
  onOpenSuggestion?: () => void;
  onOpenTalkToSupport?: () => void;
}) {
  const { t } = useTranslation(['support', 'settings']);
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HelpCategory | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  // Materialized + prewarmed (docs/23_navegacao_e_lifecycle.md §14) — reload
  // on every activation instead of only once per mount, and start each
  // visit with a clean search/filter instead of whatever was typed last time.
  useScreenFocusEffect(() => {
    localHelpArticleRepository.list().then(setArticles);
    setQuery('');
    setCategory(null);
  });
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return articles.filter(
      article =>
        (!category || article.category === category) &&
        (!needle || `${t(article.titleKey as never)} ${t(article.contentKey as never)}`.toLocaleLowerCase().includes(needle)),
    );
  }, [articles, category, query, t]);

  const allMoreHelpItems: Array<{ icon: IconName; label: string; onPress?: () => void }> = [
    { icon: 'alert-triangle', label: t('settings:items.reportProblem'), onPress: onOpenReportProblem },
    { icon: 'sparkles', label: t('settings:items.sendSuggestion'), onPress: onOpenSuggestion },
    { icon: 'message', label: t('support:help.talkToSupport'), onPress: onOpenTalkToSupport },
  ];
  const moreHelpItems = allMoreHelpItems.filter(item => item.onPress);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader title={t('support:help.title')} onBack={onBack} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing[5.5], paddingBottom: 40 }}>
          <View style={{ marginTop: spacing[2] }}>
            <Slash>{t('support:help.eyebrow')}</Slash>
            <Display size={32} style={{ marginTop: spacing[3] }}>
              {t('support:help.heroTitle')}
            </Display>
            <Text style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 21, marginTop: spacing[3], maxWidth: 320 }}>
              {t('support:help.heroSubtitle')}
            </Text>
          </View>

          <View
            style={{
              height: 54,
              marginTop: spacing[6],
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: searchFocused ? colors.focus : colors.cardBorder,
              backgroundColor: colors.surfaceRaised,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing[4],
              gap: spacing[2.5],
            }}
          >
            <Icon name="help-circle" size={17} color={searchFocused ? colors.accentHi : colors.faint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={t('support:help.search')}
              placeholderTextColor={colors.faint}
              style={{ flex: 1, color: colors.text, fontFamily: fonts.uiMed, fontSize: 14 }}
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing[2], paddingVertical: spacing[5] }}>
            <SupportChip label={t('support:help.all')} active={!category} onPress={() => setCategory(null)} />
            {HELP_CATEGORIES.map(item => (
              <SupportChip
                key={item}
                label={t(`support:help.categories.${item}` as never)}
                active={category === item}
                onPress={() => setCategory(item)}
              />
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing[2] }}>
            <MonoLabel>{t('support:help.faq')}</MonoLabel>
            <MonoLabel color={colors.faint}>{String(filtered.length).padStart(2, '0')}</MonoLabel>
          </View>

          <View style={{ borderTopWidth: filtered.length ? 1 : 0, borderTopColor: colors.hair }}>
            {filtered.map(article => (
              <Pressable
                key={article.id}
                onPress={() => onOpenArticle(article)}
                style={({ pressed }) => ({
                  minHeight: 58,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  paddingVertical: spacing[3.5],
                  borderBottomWidth: 1,
                  borderBottomColor: colors.hair,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14.5, lineHeight: 20 }}>
                  {t(article.titleKey as never)}
                </Text>
                <Icon name="chevron-right" size={15} color={colors.faint} />
              </Pressable>
            ))}
          </View>

          {!filtered.length && (
            <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 14, textAlign: 'center', marginTop: 30 }}>
              {t('support:help.empty')}
            </Text>
          )}

          {!!moreHelpItems.length && (
            <View style={{ marginTop: spacing[8] }}>
              <MonoLabel style={{ marginBottom: spacing[2] }}>{t('support:help.moreHelp')}</MonoLabel>
              <View style={{ borderTopWidth: 1, borderTopColor: colors.hair }}>
                {moreHelpItems.map(item => (
                  <Pressable
                    key={item.label}
                    onPress={item.onPress}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing[3],
                      paddingVertical: spacing[3.5],
                      borderBottomWidth: 1,
                      borderBottomColor: colors.hair,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: radii.control,
                        backgroundColor: alpha.blue12,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={item.icon} size={14} color={colors.accentHi} />
                    </View>
                    <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.uiMed, fontSize: 14 }}>{item.label}</Text>
                    <Icon name="chevron-right" size={15} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
