import React, { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AJMark } from '../../components/ui/AJMark';
import { Display } from '../../components/ui/Display';
import { colors, fonts, spacing } from '../../theme/tokens';

const AUTO_ADVANCE_MS = 2000;

/**
 * Pure transition screen — no progress bar, no eyebrow, no CTA. Advances on
 * its own after a fixed delay, same pattern as SplashScreen (timer owns the
 * `onDone` call, cleaned up on unmount so a stale timer can't fire onto
 * whatever screen the funnel already moved to).
 */
export function WelcomeInterstitialScreen({
  name,
  onContinue,
}: {
  name: string | null;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const advancing = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (advancing.current) return;
      advancing.current = true;
      onContinue();
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount, not on every onContinue identity change
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[6] }}>
      <AJMark size={120} />
      <Display size={26} style={{ marginTop: spacing[5], textAlign: 'center' }}>
        {name ? t('welcome.greeting', { name }) : t('welcome.greetingNoName')}
      </Display>
      <Text
        style={{
          marginTop: spacing[2],
          fontFamily: fonts.ui,
          fontSize: 14.5,
          lineHeight: 21,
          color: colors.mute,
          textAlign: 'center',
          maxWidth: 300,
        }}
      >
        {t('welcome.body')}
      </Text>
    </View>
  );
}
