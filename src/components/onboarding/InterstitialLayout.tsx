import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Display, Slash } from '../ui/Display';
import { CtaButton, CtaText } from '../ui/CtaButton';
import { SegBar } from '../ui/SegBar';
import { ScreenBg } from '../ui/ScreenBg';
import { OutlineNumber } from '../ui/OutlineNumber';
import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';

/**
 * Shared chrome for the funnel's value/education interstitials (no data
 * input, single "Continue" CTA). Progress bar is rendered "frozen" at the
 * last-answered-question value (see `computeOnboardingProgress`) so it
 * doesn't imply these screens are new questions.
 */
export function InterstitialLayout({
  eyebrow,
  progress,
  children,
  ctaLabel,
  onContinue,
}: {
  eyebrow: string;
  progress: { current: number; total: number };
  children: React.ReactNode;
  ctaLabel: string;
  onContinue: () => void;
}) {
  return (
    <ScreenBg>
      <OutlineNumber
        size={260}
        style={{ position: 'absolute', top: -40, right: -50, opacity: 0.35 }}
      >
        AJ
      </OutlineNumber>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
        </View>
        <View style={{ flex: 1, paddingHorizontal: sizes.screenGutter, paddingTop: spacing[6] }}>
          <Slash>{eyebrow}</Slash>
          <View style={{ marginTop: spacing[3], flex: 1 }}>{children}</View>
          <CtaButton onPress={onContinue} style={{ marginTop: spacing[4], marginBottom: spacing[2] }}>
            <CtaText>{ctaLabel}</CtaText>
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

export function InterstitialTitle({ children }: { children: React.ReactNode }) {
  return (
    <Display size={30} style={{ marginBottom: spacing[2] }}>
      {children}
    </Display>
  );
}

export function InterstitialBody({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  return (
    <Text
      style={{
        fontFamily: theme.fonts.ui,
        fontSize: 14.5,
        lineHeight: 21,
        color: theme.colors.textMuted,
        marginTop: spacing[1.5],
      }}
    >
      {children}
    </Text>
  );
}

export function InterstitialHighlight({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  return (
    <Text
      style={{
        fontFamily: theme.fonts.uiBold,
        fontSize: 15,
        color: theme.colors.primaryEmphasis,
        marginTop: spacing[3],
      }}
    >
      {children}
    </Text>
  );
}
