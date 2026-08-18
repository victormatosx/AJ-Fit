import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton } from '../components/ui/CtaButton';
import { Display, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import type { HelpArticle } from '../types/support';
import { alpha, colors, fonts, radii, spacing } from '../theme/tokens';

export function HelpArticleScreen({ article, onBack, onOpenTicket }: { article: HelpArticle; onBack: () => void; onOpenTicket: (subject: string) => void }) {
  const { t } = useTranslation('support');
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  // Materialized + prewarmed (docs/23_navegacao_e_lifecycle.md §14) — this
  // screen can go straight from one article to a different one without ever
  // becoming inactive in between (both are the same `supportRoute.name ===
  // 'article'`), so activation alone isn't a reliable "new session" signal
  // here. `article` identity is: reset feedback whenever the article itself
  // changes, regardless of whether the screen was ever deactivated.
  useEffect(() => {
    setResolved(null);
    setModalVisible(false);
  }, [article.id]);
  const title = t(article.titleKey as never);
  const paragraphs = (t(article.contentKey as never) as string).split('\n\n');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader title={t('article.header')} onBack={onBack} />
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing[5.5], paddingBottom: spacing[6] }}>
          <View>
            <Slash>{t(`help.categories.${article.category}` as never)}</Slash>
            <Display size={30} style={{ marginTop: spacing[3] }}>
              {title}
            </Display>
            {paragraphs.map((paragraph, index) => (
              <Text
                key={index}
                style={{
                  color: colors.textSecondary,
                  fontFamily: fonts.ui,
                  fontSize: 15,
                  lineHeight: 24,
                  marginTop: index === 0 ? spacing[5] : spacing[4],
                }}
              >
                {paragraph}
              </Text>
            ))}
          </View>

          <View style={{ flex: 1, minHeight: spacing[8] }} />

          <View>
            <View style={{ height: 1, backgroundColor: colors.hair, marginBottom: spacing[6] }} />
            <Text style={{ color: colors.mute, fontFamily: fonts.uiSemi, fontSize: 13.5, textAlign: 'center', marginBottom: spacing[4] }}>
              {t('article.solved')}
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing[2.5] }}>
              <FeedbackPill label={t('article.yes')} icon="check" active={resolved === true} onPress={() => setResolved(true)} />
              <FeedbackPill label={t('article.no')} active={resolved === false} onPress={() => { setResolved(false); setModalVisible(true); }} />
            </View>

            {resolved === true && (
              <Text style={{ color: '#60d99a', fontFamily: fonts.uiSemi, fontSize: 13, textAlign: 'center', marginTop: spacing[3] }}>
                {t('article.glad')}
              </Text>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)} statusBarTranslucent>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('article.dismiss')}
          onPress={() => setModalVisible(false)}
          style={{ flex: 1, backgroundColor: colors.overlayStrong, justifyContent: 'center', paddingHorizontal: 34 }}
        >
          <Pressable
            accessibilityRole="none"
            onPress={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 340,
              alignSelf: 'center',
              padding: spacing[6],
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              backgroundColor: colors.bg2,
            }}
          >
            <Slash>{t('help.eyebrow')}</Slash>
            <Display size={24} style={{ marginTop: spacing[3] }}>
              {t('article.modalTitle')}
            </Display>
            <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, marginTop: spacing[3] }}>
              {t('article.modalDescription')}
            </Text>
            <CtaButton
              style={{ marginTop: spacing[6] }}
              onPress={() => {
                setModalVisible(false);
                onOpenTicket(title);
              }}
            >
              {t('article.openTicket')}
            </CtaButton>
            <Pressable
              accessibilityRole="button"
              onPress={() => setModalVisible(false)}
              style={{ alignItems: 'center', paddingVertical: spacing[3], marginTop: spacing[1] }}
            >
              <Text style={{ color: colors.mute, fontFamily: fonts.uiMed, fontSize: 13.5 }}>{t('article.dismiss')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBg>
  );
}

function FeedbackPill({ label, icon, active, onPress }: { label: string; icon?: 'check'; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[1.5],
        minWidth: 96,
        justifyContent: 'center',
        paddingHorizontal: spacing[5],
        height: 44,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: active ? colors.accentHi : colors.cardBorder,
        backgroundColor: active ? alpha.blue18 : colors.cardBg,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon && active && <Icon name={icon} size={14} color="#fff" stroke={2.2} />}
      <Text style={{ color: active ? '#fff' : colors.mute, fontFamily: fonts.uiSemi, fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}
