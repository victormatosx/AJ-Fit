import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { Icon, type IconName } from '../../components/ui/Icon';
import { colors, fonts, radii, sizes, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const JOURNEY_ICON_SIZE = 44;
const JOURNEY_CARD_PADDING = spacing[4];

/**
 * One step of the progress -> adaptation -> evolution journey. Slightly
 * larger than a plain benefit row (bigger icon badge, more internal
 * padding) so the three steps together carry the visual weight the center
 * of the screen needs. `highlighted` marks the closing step — same card
 * shape, inverted surface/badge colors — so it reads as the sequence's
 * conclusion without introducing a new visual language.
 */
function JourneyCard({
  icon,
  title,
  body,
  highlighted,
}: {
  icon: IconName;
  title: string;
  body?: string;
  highlighted?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: body ? 'flex-start' : 'center',
        gap: spacing[3.5],
        padding: JOURNEY_CARD_PADDING,
        borderRadius: radii.lg,
        backgroundColor: highlighted ? colors.accentSoft : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          width: JOURNEY_ICON_SIZE,
          height: JOURNEY_ICON_SIZE,
          borderRadius: 13,
          backgroundColor: highlighted ? colors.bg : colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={19} color={colors.accentHi} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: '#fff', lineHeight: 21 }}>
          {title}
        </Text>
        {body && (
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: colors.mute, marginTop: 3 }}>
            {body}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Short connector segment between two journey cards, centered under the
 * icon badge column so the three steps read as one continuous line. */
function JourneyConnector() {
  return (
    <View style={{ paddingLeft: JOURNEY_CARD_PADDING + JOURNEY_ICON_SIZE / 2 - 0.5, height: spacing[3] }}>
      <View style={{ flex: 1, width: 1, backgroundColor: colors.border }} />
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

        {/* The ScrollView needs its own `flex: 1` — without it, it sizes to
            its content instead of filling the space left under the progress
            bar, so `contentContainerStyle.flexGrow` below has nothing to
            grow *within* and the CTA (and everything after it) just ends
            wherever the content naturally stops, leaving dead space under
            it. This was the actual cause of the CTA sitting high with a big
            gap below it. With `flex: 1` in place, the single `flexGrow: 1`
            spacer right before the CTA is the only element that absorbs
            leftover height — everything above it (hero, journey) keeps its
            own fixed rhythm, so extra room on tall screens goes into that
            one spacer instead of stretching or re-centering the content. On
            short screens the spacer collapses to its `minHeight` and the
            ScrollView takes over. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: sizes.screenGutter,
            paddingTop: spacing[16],
            paddingBottom: spacing[3],
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexGrow: 1 }}>
            {/* Hero — unchanged size/weight; the extra room this screen
                needed belongs to the journey below, not the headline. */}
            <View>
              <Display size={32}>{t('interstitials.evolution.titleLine1')}</Display>
              <Display size={32} color={colors.accentHi}>
                {t('interstitials.evolution.titleLine2')}
              </Display>
              <Text
                style={{
                  marginTop: spacing[2],
                  fontFamily: fonts.ui,
                  fontSize: 15.5,
                  lineHeight: 22,
                  color: colors.mute,
                  maxWidth: 340,
                }}
              >
                {t('interstitials.evolution.intro')}
              </Text>
            </View>

            {/* Progresso -> adaptação -> evolução: the three concepts as one
                connected journey (bigger cards + a connector line between
                them) instead of two small benefit rows plus a separate
                closing card. This is the screen's main visual anchor now. */}
            <View style={{ marginTop: spacing[6] }}>
              <Slash>{t('interstitials.evolution.cardsLabel')}</Slash>
              <View style={{ marginTop: spacing[3.5] }}>
                <JourneyCard
                  icon="chart"
                  title={t('interstitials.evolution.cards.progress.title')}
                  body={t('interstitials.evolution.cards.progress.body')}
                />
                <JourneyConnector />
                <JourneyCard icon="swap" title={t('interstitials.evolution.cards.adapt.title')} />
                <JourneyConnector />
                <JourneyCard
                  icon="sparkles"
                  title={t('interstitials.evolution.closing.title')}
                  body={t('interstitials.evolution.closing.body')}
                  highlighted
                />
              </View>
            </View>

            <View style={{ minHeight: spacing[4], flexGrow: 1 }} />

            <CtaButton onPress={onContinue} style={{ marginBottom: spacing[2] }}>
              <CtaText>{t('interstitials.evolution.cta')}</CtaText>
            </CtaButton>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
