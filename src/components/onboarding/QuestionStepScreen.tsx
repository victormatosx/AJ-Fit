import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display } from '../ui/Display';
import { SegBar } from '../ui/SegBar';
import { CtaButton, CtaText } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { ImperialHeightInput } from '../ui/ImperialHeightInput';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsContext';
import { computeAge } from '../../lib/ageCalculator';
import {
  ProfessionalClearanceModal,
  type OnboardingSafetyBlockStatus,
} from './ProfessionalClearanceModal';
import {
  BirthDateWheel,
  canContinueQuestion,
  ChoiceGrid,
  ChoiceList,
  CompoundChoiceList,
  MultiList,
  NumberWheel,
  type LooseT,
  type Question,
} from './QuestionRenderer';

/**
 * Chrome shared by every Quiz-keyed question step inside the onboarding
 * funnel: back button, progress bar (question count, not raw step count —
 * see `computeOnboardingProgress`), title/sub, the answer control, and CTA.
 * Mirrors the legacy QuizScreen's per-question layout so existing questions
 * look unchanged to the user.
 *
 * `OnboardingFunnelScreen` renders every question through this exact same
 * component (same type, same tree position), so without an explicit `key`
 * React would reuse this instance across question→question transitions
 * instead of unmounting it — it keys the element on `currentStepId`
 * specifically so every question is its own visual identity, and the
 * funnel's single step-transition mechanism (`AnimatedStepContainer`)
 * applies uniformly to it like any other step. No motion lives in this
 * component itself.
 */
export function QuestionStepScreen({
  question,
  value,
  onChange,
  onNext,
  onBack,
  stepNumber,
  totalSteps,
  ctaLabel,
  validateBeforeNext,
  answerControl,
  answerFooter,
  centerAnswerControlOnScreen,
  stretchAnswerControl,
  canContinueOverride,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  onNext: () => void;
  onBack: (() => void) | null;
  stepNumber: number;
  totalSteps: number;
  ctaLabel?: string;
  validateBeforeNext?: () => OnboardingSafetyBlockStatus | null;
  /** Optional composed control for questions that update multiple persisted fields at once. */
  answerControl?: React.ReactNode;
  /** Optional action anchored below the scrollable answer area and above the CTA. */
  answerFooter?: React.ReactNode;
  /** Positions a composed control at the geometric center of the full viewport. */
  centerAnswerControlOnScreen?: boolean;
  /** Stretches an inline (non-centered) answer control to fill the leftover
   * vertical space between the title block and the CTA, instead of sizing to
   * its own content. Lets controls with an internal aspect-ratio layout
   * (e.g. the muscle-focus body map) measure real available room via
   * `onLayout` and grow into it. */
  stretchAnswerControl?: boolean;
  canContinueOverride?: boolean;
}) {
  const { t, i18n } = useTranslation(['quiz', 'common']);
  const { theme } = useTheme();
  const tLoose = t as unknown as LooseT;
  const { resolvedUnits } = useUnits();
  const [safetyBlock, setSafetyBlock] = useState<OnboardingSafetyBlockStatus | null>(null);
  const canContinue = canContinueOverride ?? canContinueQuestion(question, value);
  const inlineAnswerControl = centerAnswerControlOnScreen ? undefined : answerControl;
  const handleNext = () => {
    if (question.kind === 'wheel' && typeof value !== 'number') {
      onChange(question.default);
    }
    const nextSafetyBlock = validateBeforeNext?.() ?? null;
    if (nextSafetyBlock) {
      setSafetyBlock(nextSafetyBlock);
      return;
    }
    onNext();
  };

  const outlineFontSize = 240;
  const outlineSvgW = 280;
  const outlineSvgH = 220;
  const outlineN = String(stepNumber).padStart(2, '0');

  const questionTitle = tLoose(`quiz:${question.id}.title`).toUpperCase();
  const questionSubKey = `quiz:${question.id}.sub`;
  const questionSub = i18n.exists(questionSubKey) ? tLoose(questionSubKey) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -28, right: 10 }}>
        <Svg width={outlineSvgW} height={outlineSvgH}>
          <SvgText
            x={outlineSvgW}
            y={outlineSvgH * 0.85}
            fontFamily={theme.fonts.display}
            fontSize={outlineFontSize}
            textAnchor="end"
            stroke={theme.colors.decorativeOutlineSoft}
            strokeWidth={1.5}
            fill="none"
          >
            {outlineN}
          </SvgText>
        </Svg>
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <Pressable
            onPress={onBack ?? undefined}
            disabled={!onBack}
            accessibilityRole="button"
            accessibilityLabel={t('common:actions.back')}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: theme.colors.surfaceElevated,
              borderWidth: 1,
              borderColor: theme.colors.inputBorderSubtle,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: onBack ? 1 : 0.3,
            }}
          >
            <Icon name="arrow-left" size={17} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SegBar value={stepNumber / totalSteps} segs={totalSteps} />
          </View>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, color: theme.colors.textFaint }}>
            {String(stepNumber).padStart(2, '0')}
            <Text style={{ opacity: 0.4 }}>/{totalSteps}</Text>
          </Text>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 }}>
          <View style={{ marginBottom: 24 }}>
            <Display size={32}>{questionTitle}</Display>
            {questionSub && (
              <Text style={{ marginTop: 10, color: theme.colors.textMuted, fontSize: 14, fontFamily: theme.fonts.ui }}>
                {questionSub}
              </Text>
            )}
          </View>

          {question.kind === 'date' ? (
            <View style={{ flex: 1, marginTop: 16 }}>
              <BirthDateWheel q={question} value={value as Date | null} onChange={onChange} />
            </View>
          ) : question.kind === 'wheel' ? (
            // Rendered outside the vertical ScrollView below (same treatment as
            // `date` above): the ruler picker's own horizontal ScrollView would
            // otherwise be nested inside a vertical one, and RN's touch responder
            // negotiation between nested opposite-axis ScrollViews is unreliable —
            // a gesture starting outside the inner ScrollView's hit area can be
            // claimed by the outer one and leave the inner one unresponsive to the
            // next touch. The wheel's content is fixed-height and never needs to
            // scroll, so isolating it structurally removes the conflict entirely
            // instead of patching around it.
            <View style={{ flex: 1, marginTop: 16 }}>
              {question.id === 'height' && resolvedUnits === 'imperial' ? (
                <ImperialHeightInput
                  valueCm={(value as number) ?? question.default}
                  minCm={question.min}
                  maxCm={question.max}
                  onChangeCm={onChange}
                  feetLabel={t('quiz:height.feet')}
                  inchesLabel={t('quiz:height.inches')}
                />
              ) : (
                <NumberWheel q={question} value={(value as number) ?? question.default} onChange={onChange} />
              )}
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1, marginTop: 16 }}
              contentContainerStyle={
                stretchAnswerControl
                  ? { flexGrow: 1 }
                  : inlineAnswerControl
                    ? { flexGrow: 1, justifyContent: 'center' }
                    : undefined
              }
              showsVerticalScrollIndicator={false}
            >
              {inlineAnswerControl ? (
                stretchAnswerControl
                  ? <View style={{ flex: 1, marginBottom: 20 }}>{inlineAnswerControl}</View>
                  : inlineAnswerControl
              ) : (!answerControl && question.kind === 'choice' && (
                <ChoiceGrid
                  questionId={question.id}
                  options={question.options}
                  value={value as string}
                  onChange={onChange}
                />
              ))}
              {!answerControl && question.kind === 'choice-large' && (
                <ChoiceList
                  questionId={question.id}
                  options={question.options}
                  value={value as string}
                  onChange={onChange}
                />
              )}
              {!answerControl && question.kind === 'multi' && (
                <MultiList
                  questionId={question.id}
                  options={question.options}
                  value={(value as string[]) || []}
                  onChange={onChange}
                  maxSelections={question.maxSelections}
                  exclusiveOption={question.exclusiveOption}
                />
              )}
              {!answerControl && question.kind === 'multi-exact' && (
                <MultiList
                  questionId={question.id}
                  options={question.options}
                  value={(value as string[]) || []}
                  onChange={onChange}
                  maxSelections={question.count}
                />
              )}
              {!answerControl && question.kind === 'compound-choice' && (
                <CompoundChoiceList
                  question={question}
                  value={(value as Record<string, string | null>) ?? {}}
                  onChange={onChange}
                />
              )}
            </ScrollView>
          )}

          {question.kind === 'date' && value instanceof Date && computeAge(value) < question.minAge ? (
            <Text
              accessibilityRole="alert"
              style={{ marginTop: 12, color: theme.colors.feedbackErrorText, fontFamily: theme.fonts.ui, fontSize: 13, textAlign: 'center' }}
            >
              {t('quiz:birthDate.minimumAge', { min: question.minAge })}
            </Text>
          ) : null}

          {answerFooter ? <View style={{ marginTop: 14 }}>{answerFooter}</View> : null}

          <CtaButton onPress={handleNext} disabled={!canContinue} style={{ marginTop: answerFooter ? 10 : 14 }}>
            <CtaText>{ctaLabel ?? t('common:actions.continue')}</CtaText>
          </CtaButton>
        </View>
      </SafeAreaView>
      {centerAnswerControlOnScreen && answerControl ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            justifyContent: 'center',
            paddingHorizontal: 24,
          }}
        >
          {answerControl}
        </View>
      ) : null}
      <ProfessionalClearanceModal status={safetyBlock} onDismiss={() => setSafetyBlock(null)} />
    </View>
  );
}
