import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display } from '../ui/Display';
import { SegBar } from '../ui/SegBar';
import { CtaButton, CtaText } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { ImperialHeightInput } from '../ui/ImperialHeightInput';
import { colors, fonts } from '../../theme/tokens';
import type { Quiz } from '../../state/AppState';
import { useUnits } from '../../state/UnitsContext';
import {
  BirthDateWheel,
  canContinueQuestion,
  ChoiceGrid,
  ChoiceList,
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
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  onNext: () => void;
  onBack: (() => void) | null;
  stepNumber: number;
  totalSteps: number;
  ctaLabel?: string;
}) {
  const { t, i18n } = useTranslation(['quiz', 'common']);
  const tLoose = t as unknown as LooseT;
  const { resolvedUnits } = useUnits();
  const canContinue = canContinueQuestion(question, value);

  const outlineFontSize = 240;
  const outlineSvgW = 280;
  const outlineSvgH = 220;
  const outlineN = String(stepNumber).padStart(2, '0');

  const questionTitle = tLoose(`quiz:${question.id}.title`).toUpperCase();
  const questionSubKey = `quiz:${question.id}.sub`;
  const questionSub = i18n.exists(questionSubKey) ? tLoose(questionSubKey) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -28, right: 10 }}>
        <Svg width={outlineSvgW} height={outlineSvgH}>
          <SvgText
            x={outlineSvgW}
            y={outlineSvgH * 0.85}
            fontFamily={fonts.display}
            fontSize={outlineFontSize}
            textAnchor="end"
            stroke="rgba(255,255,255,0.22)"
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
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: onBack ? 1 : 0.3,
            }}
          >
            <Icon name="arrow-left" size={17} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SegBar value={stepNumber / totalSteps} segs={totalSteps} />
          </View>
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
            {String(stepNumber).padStart(2, '0')}
            <Text style={{ opacity: 0.4 }}>/{totalSteps}</Text>
          </Text>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 }}>
          <View style={{ marginBottom: 24 }}>
            <Display size={32}>{questionTitle}</Display>
            {questionSub && (
              <Text style={{ marginTop: 10, color: colors.mute, fontSize: 14, fontFamily: fonts.ui }}>
                {questionSub}
              </Text>
            )}
          </View>

          {question.kind === 'date' ? (
            <View style={{ flex: 1, marginTop: 16 }}>
              <BirthDateWheel q={question} value={value as Date | null} onChange={onChange} />
            </View>
          ) : (
            <ScrollView style={{ flex: 1, marginTop: 16 }} showsVerticalScrollIndicator={false}>
              {question.kind === 'choice' && (
                <ChoiceGrid
                  questionId={question.id}
                  options={question.options}
                  value={value as string}
                  onChange={onChange}
                />
              )}
              {question.kind === 'choice-large' && (
                <ChoiceList
                  questionId={question.id}
                  options={question.options}
                  value={value as string}
                  onChange={onChange}
                />
              )}
              {question.kind === 'wheel' && question.id === 'height' && resolvedUnits === 'imperial' && (
                <ImperialHeightInput
                  valueCm={(value as number) ?? question.default}
                  minCm={question.min}
                  maxCm={question.max}
                  onChangeCm={onChange}
                  feetLabel={t('quiz:height.feet')}
                  inchesLabel={t('quiz:height.inches')}
                />
              )}
              {question.kind === 'wheel' &&
                !(question.id === 'height' && resolvedUnits === 'imperial') && (
                  <NumberWheel q={question} value={(value as number) ?? question.default} onChange={onChange} />
                )}
              {question.kind === 'multi' && (
                <MultiList
                  questionId={question.id}
                  options={question.options}
                  value={(value as string[]) || []}
                  onChange={onChange}
                  maxSelections={question.maxSelections}
                />
              )}
            </ScrollView>
          )}

          <CtaButton onPress={onNext} disabled={!canContinue} style={{ marginTop: 14 }}>
            <CtaText>{ctaLabel ?? t('common:actions.continue')}</CtaText>
          </CtaButton>
        </View>
      </SafeAreaView>
    </View>
  );
}
