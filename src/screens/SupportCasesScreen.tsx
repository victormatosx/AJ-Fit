import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { ScreenBg } from '../components/ui/ScreenBg';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { Icon } from '../components/ui/Icon';
import { useAuth } from '../state/AuthContext';
import { observeOwnSupportCases, type SupportCase } from '../services/supportCases';
import { radii, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import {
  formatSupportConversationTimestamp,
  hasUnreadSupportMessage,
  matchesSupportCaseSearch,
  supportCaseStatusKind,
} from '../lib/supportMessagePresentation';

export function SupportCasesScreen({ onBack, onOpenCase }: { onBack: () => void; onOpenCase: (caseId: string) => void }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('support');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const visibleCases = cases.filter(item => (
    matchesSupportCaseSearch(item.subject, item.lastMessage, search, locale)
  ));

  useEffect(() => {
    if (!user) return;
    return observeOwnSupportCases(user.uid, value => { setCases(value); setLoading(false); setError(false); }, () => { setLoading(false); setError(true); });
  }, [user]);

  return <ScreenBg><SafeAreaView style={{ flex: 1 }} edges={['top']}>
    <SupportScreenHeader title={t('cases.title')} onBack={onBack} />
    <ScrollView contentContainerStyle={{ padding: spacing[5.5], paddingBottom: 40 }}>
      <TextInput
        accessibilityLabel={t('cases.search')}
        value={search}
        onChangeText={setSearch}
        placeholder={t('cases.search')}
        placeholderTextColor={theme.colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={{ height: 46, marginBottom: spacing[5], paddingHorizontal: spacing[4], borderRadius: radii.lg, borderWidth: 1, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.cardBackground, color: theme.colors.textPrimary, fontFamily: theme.fonts.ui, fontSize: 14 }}
      />
      {loading && <ActivityIndicator color={theme.colors.primaryEmphasis} />}
      {error && <Text style={{ color: theme.colors.formErrorText }}>{t('cases.loadError')}</Text>}
      {!loading && !error && cases.length === 0 && <Text style={{ color: theme.colors.textSecondary }}>{t('cases.empty')}</Text>}
      {!loading && !error && cases.length > 0 && visibleCases.length === 0 && <Text style={{ color: theme.colors.textSecondary }}>{t('cases.noResults')}</Text>}
      {visibleCases.map(item => {
        const statusKind = supportCaseStatusKind(item.state);
        const hasUnread = hasUnreadSupportMessage(item.unreadByUserCount);
        const closed = statusKind === 'closed';
        const unreadLabel = item.unreadByUserCount > 99
          ? '99+'
          : String(item.unreadByUserCount);
        const lastMessageTimestamp = formatSupportConversationTimestamp(
          item.lastMessageAt,
          locale,
          t('cases.yesterday'),
        );
        return <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.subject}${closed ? `. ${t('cases.status.closed')}` : ''}${hasUnread ? `. ${t('cases.newMessage')}` : ''}`}
          onPress={() => onOpenCase(item.id)}
          style={({ pressed }) => ({
            minHeight: 82,
            padding: spacing[3.5],
            marginBottom: spacing[3],
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: hasUnread ? theme.colors.primaryEmphasis : theme.colors.cardBorder,
            backgroundColor: theme.colors.cardBackground,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
            <LinearGradient
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('cases.supportAvatar')}
              colors={theme.gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 23, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="message" size={21} color={theme.colors.primaryForeground} stroke={1.9} />
            </LinearGradient>

            <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
              <Text
                numberOfLines={1}
                style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 15 }}
              >
                {item.subject}
              </Text>
              <Text
                numberOfLines={2}
                style={{ color: theme.colors.textSecondary, marginTop: spacing[1.5], fontSize: 12, lineHeight: 16 }}
              >
                {item.lastMessage}
              </Text>
              {lastMessageTimestamp ? (
                <Text style={{ color: theme.colors.textFaint, marginTop: spacing[1], fontFamily: theme.fonts.mono, fontSize: 9 }}>
                  {lastMessageTimestamp}
                </Text>
              ) : null}
            </View>

            {(hasUnread || closed) && (
              <View style={{ width: 74, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                {hasUnread ? (
                  <View
                    accessibilityLabel={`${t('cases.newMessage')}: ${item.unreadByUserCount}`}
                    style={{ minWidth: 24, height: 22, paddingHorizontal: spacing[1.5], borderRadius: 11, backgroundColor: theme.colors.primaryEmphasis, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.uiBold, fontSize: 10 }}>
                      {unreadLabel}
                    </Text>
                  </View>
                ) : <View style={{ height: 22 }} />}
                {closed && (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View accessibilityElementsHidden style={{ width: 5, height: 5, borderRadius: 3, marginRight: spacing[1], backgroundColor: theme.colors.formErrorText }} />
                    <Text style={{ color: theme.colors.textFaint, fontFamily: theme.fonts.ui, fontSize: 9 }}>
                      {t('cases.status.closed')}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </Pressable>;
      })}
    </ScrollView>
  </SafeAreaView></ScreenBg>;
}
