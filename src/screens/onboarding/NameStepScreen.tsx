import React, { useState } from 'react';
import { View, TextInput, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { colors, fonts, radii, sizes, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const MAX_NAME_LENGTH = 40;

export function NameStepScreen({
  name,
  onChangeName,
  progress,
  onNext,
}: {
  name: string | null;
  onChangeName: (name: string) => void;
  progress: OnboardingProgress;
  onNext: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const [draft, setDraft] = useState(name ?? '');
  const trimmed = draft.trim();
  const canContinue = trimmed.length > 0;

  const commitAndContinue = () => {
    if (!canContinue) return;
    onChangeName(trimmed);
    onNext();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -28, right: 10 }}>
        <Svg width={280} height={220}>
          <SvgText
            x={280}
            y={220 * 0.85}
            fontFamily={fonts.display}
            fontSize={240}
            textAnchor="end"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1.5}
            fill="none"
          >
            01
          </SvgText>
        </Svg>
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
          <View style={{ flex: 1, paddingHorizontal: sizes.screenGutter, paddingTop: spacing[6] }}>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Slash>{t('name.eyebrow')}</Slash>
              <Display size={30} style={{ marginTop: spacing[2] }}>
                {t('name.title')}
              </Display>

              <TextInput
                value={draft}
                onChangeText={(txt) => setDraft(txt.slice(0, MAX_NAME_LENGTH))}
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={MAX_NAME_LENGTH}
                onSubmitEditing={commitAndContinue}
                accessibilityLabel={t('name.accessibility.input')}
                style={{
                  marginTop: spacing[6],
                  fontFamily: fonts.display,
                  fontSize: 22,
                  color: '#fff',
                  backgroundColor: colors.surfaceRaised,
                  borderRadius: radii.lg,
                  borderWidth: 1,
                  borderColor: canContinue ? colors.accentHi : colors.border,
                  paddingHorizontal: spacing[4],
                  paddingVertical: spacing[4],
                }}
              />
            </View>

            <CtaButton onPress={commitAndContinue} disabled={!canContinue} style={{ marginBottom: spacing[6] }}>
              <CtaText>{t('name.cta')}</CtaText>
            </CtaButton>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
