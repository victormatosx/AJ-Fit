import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SegBar } from '../../components/ui/SegBar';
import { Icon } from '../../components/ui/Icon';
import { StepOutlineNumber } from '../../components/onboarding/StepOutlineNumber';
import { AqMonoLabel, AqPrimaryButton } from '../../components/ui/AcquisitionControls';
import { AjSpeechText } from '../../components/aj/AjSpeechText';
import { AJ_TYPING_MS_PER_CHAR, AJ_TYPING_QUESTION_DELAY_MS } from '../../components/aj/ajMomentTiming';
import { useAjFunnelDirector } from '../../components/onboarding/AjFunnelStage';
import { namePose } from '../../components/onboarding/ajFunnelChoreography';
import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const MAX_NAME_LENGTH = 40;
const TITLE_FONT_SIZE = 30.4;

export function NameStepScreen({
  name,
  onChangeName,
  progress,
  onNext,
  onBack,
}: {
  name: string | null;
  onChangeName: (name: string) => void;
  progress: OnboardingProgress;
  onNext: () => void;
  /** The funnel's own `goBack`, same as every other step's. */
  onBack?: (() => void) | null;
}) {
  const { t } = useTranslation('onboarding');
  const { t: tCommon } = useTranslation('common');
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const aj = useAjFunnelDirector();
  const [draft, setDraft] = useState(name ?? '');
  const [focused, setFocused] = useState(false);
  const [titleDone, setTitleDone] = useState(false);
  const trimmed = draft.trim();
  const canContinue = trimmed.length > 0;
  const inputRef = useRef<TextInput>(null);

  const commitAndContinue = () => {
    if (!canContinue) return;
    onChangeName(trimmed);
    onNext();
  };

  // This step's title sits at the bottom of the screen rather than the top, so
  // AJ rises to meet it instead of staying parked beside a title that isn't
  // there — see `namePose`.
  useEffect(() => {
    aj.direct(namePose(width, insets.top));
    aj.setMood('talk');
  }, [aj, width, insets.top]);

  const stepNumber = String(progress.current).padStart(2, '0');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, overflow: 'hidden' }}>
      <StepOutlineNumber value={progress.current} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingTop: 15,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <Pressable
            onPress={onBack ?? undefined}
            disabled={!onBack}
            accessibilityRole="button"
            accessibilityLabel={tCommon('actions.back')}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              borderWidth: 1,
              borderColor: theme.colors.dividerStrong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: onBack ? 1 : 0.3,
            }}
          >
            <Icon name="arrow-left" size={16} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
          </View>
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 10,
              letterSpacing: 1.2,
              color: theme.colors.textLabelQuiet,
              minWidth: 34,
              textAlign: 'right',
            }}
          >
            {stepNumber}
            <Text style={{ opacity: 0.5 }}>/{progress.total}</Text>
          </Text>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* The question and the field live at the BOTTOM of this step, just
              above the keyboard — `marginTop: auto` is what puts them there,
              and it is why AJ rides down to the title instead of staying in
              the corner. */}
          <View style={{ flex: 1, paddingHorizontal: 22, paddingBottom: 34 }}>
            <View style={{ marginTop: 'auto', paddingRight: 86 }}>
              <AqMonoLabel>{t('name.eyebrow').toUpperCase()}</AqMonoLabel>
              <AjSpeechText
                text={t('name.title').toUpperCase()}
                msPerChar={AJ_TYPING_MS_PER_CHAR.question}
                startDelayMs={AJ_TYPING_QUESTION_DELAY_MS}
                reduceMotion={aj.reduceMotion}
                onStart={() => {
                  aj.setTalking(true);
                  aj.setMood('talk');
                }}
                onDone={() => {
                  setTitleDone(true);
                  aj.setTalking(false);
                  aj.setMood('idle');
                }}
                style={{
                  marginTop: 10,
                  fontFamily: theme.fonts.display,
                  fontSize: TITLE_FONT_SIZE,
                  // See `displayLineHeight` — Anton's metrics make iOS clip
                  // the top of every capital at a tight line height, and the
                  // prototype's CSS `line-height: .95` is exactly that.
                  lineHeight: displayLineHeight(TITLE_FONT_SIZE),
                  letterSpacing: 0.5,
                  color: theme.colors.textPrimary,
                  transform: [{ skewX: '-8deg' }],
                }}
              />
            </View>

            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={(txt) => {
                setDraft(txt.slice(0, MAX_NAME_LENGTH));
                // AJ watches the field while the name is typed.
                aj.setLook([0, 2.2]);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              maxLength={MAX_NAME_LENGTH}
              onSubmitEditing={commitAndContinue}
              accessibilityLabel={t('name.accessibility.input')}
              selectionColor={theme.colors.primaryEmphasis}
              style={{
                marginTop: 26,
                opacity: titleDone ? 1 : 0,
                fontFamily: theme.fonts.uiSemi,
                fontSize: 24,
                color: theme.colors.inputText,
                paddingVertical: 10,
                paddingHorizontal: 0,
                borderBottomWidth: 1.5,
                borderBottomColor: focused || canContinue
                  ? theme.colors.primaryEmphasis
                  : theme.colors.fieldBorderStrong,
              }}
            />

            <AqPrimaryButton
              label={t('name.cta')}
              onPress={commitAndContinue}
              disabled={!canContinue}
              style={{ marginTop: 26, opacity: titleDone ? 1 : 0 }}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
