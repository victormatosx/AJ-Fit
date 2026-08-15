import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { Icon, type IconName } from '../../components/ui/Icon';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/**
 * Editorial row instead of a bordered/surfaced "settings" card: icon marker
 * + a thin connector line to the next row (progress -> adaptation), text to
 * the right. `last` drops the connector at row 2, the timeline's endpoint.
 */
function BenefitRow({
  icon,
  title,
  body,
  last,
}: {
  icon: IconName;
  title: string;
  body?: string;
  last?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing[3] }}>
      <View style={{ width: 36, alignItems: 'center' }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            backgroundColor: colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={colors.accentHi} />
        </View>
        {!last && (
          <View style={{ width: 1, flex: 1, minHeight: spacing[3], backgroundColor: colors.border, marginTop: spacing[1] }} />
        )}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : spacing[3.5] }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: '#fff', lineHeight: 20 }}>
          {title}
        </Text>
        {body && (
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: colors.mute, marginTop: 2 }}>
            {body}
          </Text>
        )}
      </View>
    </View>
  );
}

export function EvolutionInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar
            value={progress.total ? progress.current / progress.total : 0}
            segs={progress.total || 1}
          />
        </View>

        {/* `flexGrow: 1` on the content container + `flex:1,
            justifyContent:'center'` on the single wrapper below is what
            moves the *whole* composition's center of gravity down when it's
            shorter than the viewport — the four groups keep their own small,
            fixed internal gaps (never flex-stretched), only the block as a
            whole re-centers. On a short device/longer translation, content
            overflows this centering has no effect and it just scrolls, so
            nothing here depends on a specific screen height. */}
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: sizes.screenGutter,
            paddingTop: spacing[5],
            paddingBottom: spacing[5],
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flex: 1, justifyContent: 'center' }}>
            {/* Grupo 2 — Headline + subheadline lêem como uma unidade só:
                gap pequeno entre elas. */}
            <View>
              <Display size={28}>{t('interstitials.evolution.titleLine1')}</Display>
              <Display size={28} color={colors.accentHi}>
                {t('interstitials.evolution.titleLine2')}
              </Display>
              <Text
                style={{
                  marginTop: spacing[1.5],
                  fontFamily: fonts.ui,
                  fontSize: 15,
                  lineHeight: 21,
                  color: colors.mute,
                  maxWidth: 320,
                }}
              >
                {t('interstitials.evolution.intro')}
              </Text>
            </View>

            {/* Grupo 3 — label + os dois benefícios, mantidos próximos entre
                si; só o espaço ANTES do grupo aumentou. */}
            <View style={{ marginTop: spacing[7] }}>
              <Slash>{t('interstitials.evolution.cardsLabel')}</Slash>
              <View style={{ marginTop: spacing[3] }}>
                <BenefitRow
                  icon="chart"
                  title={t('interstitials.evolution.cards.progress.title')}
                  body={t('interstitials.evolution.cards.progress.body')}
                />
                <BenefitRow icon="swap" title={t('interstitials.evolution.cards.adapt.title')} last />
              </View>
            </View>

            {/* Grupo 4 — fechamento + CTA, mesma lógica: mais espaço antes
                do grupo, gap pequeno entre título/corpo/botão dentro dele. */}
            <View style={{ marginTop: spacing[7] }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 16.5, color: '#fff' }}>
                {t('interstitials.evolution.closing.title')}
              </Text>
              <Text
                style={{
                  marginTop: spacing[1],
                  fontFamily: fonts.ui,
                  fontSize: 14,
                  lineHeight: 20,
                  color: colors.mute,
                }}
              >
                {t('interstitials.evolution.closing.body')}
              </Text>

              <CtaButton onPress={onContinue} style={{ marginTop: spacing[4] }}>
                <CtaText>{t('interstitials.evolution.cta')}</CtaText>
              </CtaButton>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
