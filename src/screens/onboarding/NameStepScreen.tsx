import React, { useState } from 'react';
import { View, Text, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={{ flex: 1, paddingHorizontal: sizes.screenGutter, paddingTop: spacing[6] }}>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Slash>{t('name.eyebrow')}</Slash>
              <Display size={30} style={{ marginTop: spacing[2] }}>
                {t('name.title')}
              </Display>

              <TextInput
                value={draft}
                onChangeText={(txt) => setDraft(txt.slice(0, MAX_NAME_LENGTH))}
                placeholder={t('name.placeholder')}
                placeholderTextColor={colors.faint}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={MAX_NAME_LENGTH}
                onSubmitEditing={commitAndContinue}
                accessibilityLabel={t('name.accessibility.input')}
                style={{
                  marginTop: spacing[6],
                  fontFamily: fonts.display,
                  fontSize: 34,
                  color: '#fff',
                  borderBottomWidth: 2,
                  borderBottomColor: canContinue ? colors.accentHi : 'rgba(255,255,255,0.15)',
                  paddingBottom: spacing[2],
                }}
              />
            </View>

            <CtaButton onPress={commitAndContinue} disabled={!canContinue} style={{ marginBottom: spacing[2] }}>
              <CtaText>{t('name.cta')}</CtaText>
            </CtaButton>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
