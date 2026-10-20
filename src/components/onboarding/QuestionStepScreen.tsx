import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SegBar } from '../ui/SegBar';
import { Icon } from '../ui/Icon';
import { StepOutlineNumber } from './StepOutlineNumber';
import { UnitToggle } from './UnitToggle';
import { measurementKindOf, type DisplayUnit } from './unitDisplay';
import { AqMonoLabel, AqPrimaryButton, AqRise } from '../ui/AcquisitionControls';
import { AjSpeechText } from '../aj/AjSpeechText';
import {
  AJ_ANSWER_ACKNOWLEDGE,
  AJ_PERCH_RADIO,
  AJ_REACT_HOLD_MS,
  AJ_REACT_STAGE,
  AJ_REDUCED_HOLD_MS,
  AJ_TYPING_MS_PER_CHAR,
  AJ_TYPING_QUESTION_DELAY_MS,
} from '../aj/ajMomentTiming';
import { AJ_BOT_LOOK_NEUTRAL, ajLeanLookAt, ajLeanRotateDeg } from '../aj/ajBotMotion';
import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import { computeAge } from '../../lib/ageCalculator';
import { useAjFunnelDirector } from './AjFunnelStage';
import {
  liftScale as computeLiftScale,
  liftTranslateY,
  perchPose,
  questionPose,
  reactionPose,
} from './ajFunnelChoreography';
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
  type ChoiceRowLift,
  type LooseT,
  type Question,
} from './QuestionRenderer';

/** Viewport height at or below which the step switches to its compact layout. */
const COMPACT_HEIGHT = 667;
/** Content never gets wider than this, centred, on tablets and large phones. */
const CONTENT_MAX_WIDTH = 480;

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
  question, title, subtitle,
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
  sectionLabel,
  reactionLine,
  optionLabel,
  optionDescription,
  bodyWeightWheel,
  measurementUnit,
  onMeasurementUnitChange,
}: {
  title?: string; subtitle?: string | null;
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  onNext: () => void;
  onBack: (() => void) | null;
  stepNumber: number;
  totalSteps: number;
  ctaLabel?: string;
  validateBeforeNext?: () => OnboardingSafetyBlockStatus | null;
  /** Mono kicker above the title. Resolved by the funnel, which owns the step map. */
  sectionLabel?: string | null;
  /**
   * What AJ says about the answer once the step resolves, or null for the
   * steps that get no reaction. Built by the funnel from answers it has
   * already recorded — this component never reads the questionnaire.
   */
  reactionLine?: string | null;
  /**
   * Resolves option copy for questions whose strings do not live under
   * `quiz:<id>.options.*`. The nutrition steps render through these same
   * controls but keep their own namespace — see `OnboardingFunnelScreen`.
   */
  optionLabel?: (value: string) => string;
  optionDescription?: (value: string) => string | null;
  /** Marks a `wheel` step as a body weight, so it follows the kg/lb preference. */
  bodyWeightWheel?: boolean;
  /**
   * Turns this ruler into a body measurement with a CM/FT or KG/LB selector.
   * The selection lives in the funnel (so both weight steps agree on it) and
   * is presentation only — the answer is stored in cm/kg either way.
   * Omitted for rulers that measure neither, which keep a single unit.
   */
  measurementUnit?: DisplayUnit | null;
  onMeasurementUnitChange?: (next: DisplayUnit) => void;
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
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const aj = useAjFunnelDirector();
  const { reduceMotion } = aj;
  const [safetyBlock, setSafetyBlock] = useState<OnboardingSafetyBlockStatus | null>(null);
  const canContinue = canContinueOverride ?? canContinueQuestion(question, value);
  const inlineAnswerControl = centerAnswerControlOnScreen ? undefined : answerControl;

  const compact = height <= COMPACT_HEIGHT;
  const isSingleChoice = question.kind === 'choice' || question.kind === 'choice-large';
  /**
   * A question with exactly one answer needs no confirm step — tapping the
   * option is the answer, and the design's selection animation carries the
   * step out. This is false for anything that takes several marks (multi,
   * multi-exact, compound) and for the questions whose answer is composed by
   * a control of their own (schedule, body map, nutrition), which keep their
   * explicit "Confirmar".
   */
  const autoAdvanceOnSelect = isSingleChoice && !answerControl;
  const optionCount = 'options' in question ? question.options.length : 0;
  // Single choice can never scroll — the selection animation lifts the chosen
  // row to the centre of the screen, and a row that scrolled away has nowhere
  // to lift from. Tightening the rows is how a long list fits instead, and a
  // short screen reaches that point sooner.
  const dense = optionCount > (compact ? 4 : 6);

  /* ── Step choreography ────────────────────────────────────────────────────
   * Nothing here decides *whether* the step advances — `canContinue`,
   * `validateBeforeNext` and `onNext` are untouched. It decides only what is
   * seen between the tap and the advance, and it guarantees `onNext` runs
   * exactly once per step no matter which path got there.
   * ──────────────────────────────────────────────────────────────────────── */

  const [titleDone, setTitleDone] = useState(false);
  const [liftValue, setLiftValue] = useState<string | null>(null);
  const [lift, setLift] = useState<ChoiceRowLift | null>(null);
  const [perchedValue, setPerchedValue] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  const advancedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const listRef = useRef<View>(null);
  const rowRects = useRef<Record<string, { y: number; height: number; width: number }>>({});

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  // Park AJ beside the title and start him talking. Two consecutive questions
  // resolve to the same pose, so this is a no-op in position and only the
  // expression changes — which is exactly what the design shows.
  useEffect(() => {
    aj.direct(questionPose(width, insets.top));
    aj.setLook(AJ_BOT_LOOK_NEUTRAL);
    aj.setMood('talk');
  }, [aj, width, insets.top]);

  const handleTitleDone = useCallback(() => {
    setTitleDone(true);
    aj.setTalking(false);
    aj.setMood('idle');
  }, [aj]);

  const handleTitleStart = useCallback(() => {
    aj.setTalking(true);
    aj.setMood('talk');
  }, [aj]);

  // Same reason as `validateRef`/`reactionRef` below: a step that resolves on
  // a timer must call the CURRENT `onNext`. The funnel rebuilds it per render
  // and the nutrition branch's closes over the draft, so a captured one would
  // advance on a stale answer — and on the last nutrition step it would refuse
  // to advance at all, because the completeness check would still be looking
  // at the draft from before the selection.
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  /** The single call site for the funnel's own advance. */
  const finish = useCallback(() => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    aj.setTalking(false);
    onNextRef.current();
  }, [aj]);

  // `validateBeforeNext` and `reactionLine` are rebuilt every render from the
  // funnel's current answers. A deferred step (the selection animation runs
  // for 1.8s before it resolves) must read the values as they are WHEN IT
  // RESOLVES, not as they were when the timer was scheduled — otherwise the
  // safety gate would judge the previous answer and the reaction would
  // describe it.
  const validateRef = useRef(validateBeforeNext);
  validateRef.current = validateBeforeNext;
  const reactionRef = useRef(reactionLine);
  reactionRef.current = reactionLine;

  /** Either hand over to the reaction, or advance straight away. */
  const resolveStep = useCallback(() => {
    if (!reactionRef.current) {
      finish();
      return;
    }
    setReacting(true);
    aj.direct(reactionPose(width, height));
    aj.setMood('happy');
    aj.setLook(AJ_BOT_LOOK_NEUTRAL);
    if (reduceMotion) {
      // Reduce Motion still has to let the line be *read*, so the hold is
      // capped rather than removed — the typing is what disappears.
      later(finish, AJ_REDUCED_HOLD_MS);
    }
  }, [finish, aj, width, height, reduceMotion, later]);

  /** Puts the step back the way it was, so a blocked answer stays correctable. */
  const unwindSelection = useCallback(() => {
    setLiftValue(null);
    setLift(null);
    setPerchedValue(null);
    aj.direct(questionPose(width, insets.top));
    aj.setMood('idle');
  }, [aj, width, insets.top]);

  /**
   * The gate always gets the last word, including on the steps that advance
   * by themselves. It runs here rather than at the tap because the answer has
   * only just been written to the funnel's state — evaluating it a tick after
   * the tap would judge the previous answer.
   */
  const attemptResolve = useCallback(() => {
    const block = validateRef.current?.() ?? null;
    if (block) {
      // The gate replaces the reaction entirely: nothing is celebrated, the
      // step does not advance, and the list comes back so the answer can
      // actually be changed — which is the only thing that clears the block.
      unwindSelection();
      setSafetyBlock(block);
      return;
    }
    resolveStep();
  }, [resolveStep, unwindSelection]);

  /**
   * The design's signature move: the chosen row lifts to the centre while the
   * others sink, AJ flies down and shrinks onto its radio, bounces, and the
   * step resolves.
   *
   * It runs on the TAP, because single choice has no confirm button — picking
   * an option is the answer. Questions that take several marks keep their
   * "Confirmar" and resolve through `handleNext` instead.
   */
  const perchOnChoice = useCallback(
    (chosen: string) => {
      const rect = rowRects.current[chosen];
      const node = listRef.current;
      if (!rect || !node) {
        attemptResolve();
        return;
      }
      node.measureInWindow((listX, listY) => {
        const rowCenterY = listY + rect.y + rect.height / 2;
        const rowCenterX = listX + rect.width / 2;
        const scale = computeLiftScale(rect.width, width);
        const dy = liftTranslateY(height, rowCenterY);
        // The radio sits at the row's trailing edge, inside the row's own 2pt
        // padding. After the row scales about its centre, the radio's centre
        // moves with it; vertically the row ends up centred on the screen.
        const radioCenterX = listX + rect.width - 2 - 11;
        const perchX = rowCenterX + (radioCenterX - rowCenterX) * scale;

        setLift({ dy, scale });
        setLiftValue(chosen);
        later(() => {
          setPerchedValue(chosen);
          aj.direct(perchPose(perchX, height / 2, scale));
        }, AJ_PERCH_RADIO.travelAtMs);
        later(() => aj.play('hop'), AJ_PERCH_RADIO.hopAtMs);
        later(attemptResolve, AJ_PERCH_RADIO.resolveAtMs);
      });
    },
    [aj, width, height, later, attemptResolve],
  );

  /**
   * Picking a single-choice option IS answering the question — there is no
   * confirm step to reach. The answer is written exactly as it always was
   * (`onChange`), and the gate still decides whether the step may advance.
   */
  const handleChoiceSelect = useCallback(
    (next: string, index: number, count: number) => {
      if (advancedRef.current || liftValue || reacting) return;
      aj.setLook(count > 0 ? [((index + 0.5) / count - 0.5) * 3, 2] : AJ_BOT_LOOK_NEUTRAL);
      onChange(next);
      if (reduceMotion) {
        // No lift, no flight — but the answer still has to land in state
        // before the gate reads it.
        later(attemptResolve, AJ_REDUCED_HOLD_MS);
        return;
      }
      perchOnChoice(next);
    },
    [aj, onChange, reduceMotion, later, attemptResolve, perchOnChoice, liftValue, reacting],
  );

  /** The confirm path, for every question that takes more than one mark. */
  const handleNext = () => {
    if (question.kind === 'wheel' && typeof value !== 'number') {
      onChange(question.default);
    }
    const nextSafetyBlock = validateBeforeNext?.() ?? null;
    if (nextSafetyBlock) {
      setSafetyBlock(nextSafetyBlock);
      return;
    }
    if (advancedRef.current || liftValue || reacting) return;

    if (reduceMotion) {
      resolveStep();
      return;
    }
    // AJ acknowledges from where he already is, and the step resolves much
    // sooner — there is no flight to wait through.
    aj.play('nod');
    later(resolveStep, AJ_ANSWER_ACKNOWLEDGE.resolveAtMs);
  };

  const handleLean = useCallback(
    (pct: number, atEdge: boolean) => {
      const pose = questionPose(width, insets.top);
      aj.direct({ ...pose, rotate: ajLeanRotateDeg(pct) });
      aj.setLook(ajLeanLookAt(pct));
      if (atEdge) aj.play('nod');
    },
    [aj, width, insets.top],
  );

  const handlePoke = useCallback(() => {
    aj.setLook([0, 2.2]);
    aj.play('nod');
  }, [aj]);

  const handleMultiToggled = useCallback(
    (_option: string, selected: boolean) => {
      aj.setLook([0, 2.2]);
      aj.play(selected ? 'hop' : 'nod');
    },
    [aj],
  );

  const titleFontSize = compact ? 26 : 30.4;
  const questionTitle = (title ?? tLoose(`quiz:${question.id}.title`)).toUpperCase();
  const questionSubKey = `quiz:${question.id}.sub`;
  const questionSub = subtitle !== undefined ? subtitle : i18n.exists(questionSubKey) ? tLoose(questionSubKey) : null;
  // Date and ruler steps place their own oversized value where the title's
  // reserved block would otherwise sit, so they don't reserve it.
  const reservesTitleBlock = question.kind !== 'date' && question.kind !== 'wheel';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, overflow: 'hidden' }}>
      <StepOutlineNumber value={stepNumber} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingTop: 15,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH,
            alignSelf: 'center',
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
            <SegBar value={stepNumber / totalSteps} segs={totalSteps} />
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
            {String(stepNumber).padStart(2, '0')}
            <Text style={{ opacity: 0.5 }}>/{totalSteps}</Text>
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            paddingHorizontal: 22,
            paddingTop: 12,
            paddingBottom: 34,
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH,
            alignSelf: 'center',
          }}
        >
          {/* `paddingRight` keeps the title clear of AJ, who is parked in the
              top-right corner by the funnel's persistent stage. */}
          <View
            style={{
              paddingRight: 86,
              // Two lines at the real display line height. The block is
              // reserved so the answers below it do not shift as the title
              // types itself in.
              minHeight: reservesTitleBlock ? displayLineHeight(titleFontSize) * 2 : 0,
            }}
          >
            {sectionLabel ? (
              <AqRise reduceMotion={reduceMotion}>
                <AqMonoLabel>{sectionLabel}</AqMonoLabel>
              </AqRise>
            ) : null}
            <AjSpeechText
              text={questionTitle}
              msPerChar={AJ_TYPING_MS_PER_CHAR.question}
              startDelayMs={AJ_TYPING_QUESTION_DELAY_MS}
              reduceMotion={reduceMotion}
              onStart={handleTitleStart}
              onDone={handleTitleDone}
              style={{
                marginTop: sectionLabel ? 10 : 0,
                fontFamily: theme.fonts.display,
                fontSize: titleFontSize,
                // `displayLineHeight`, never the prototype's `line-height:
                // .95`. That is a CSS value, and CSS lets a glyph overflow its
                // line box; React Native clips it instead, and Anton's tall
                // metrics make iOS shave the top off every capital. The helper
                // in `theme/tokens.ts` carries the ratio that was measured on
                // real devices — see its comment.
                lineHeight: displayLineHeight(titleFontSize),
                letterSpacing: 0.5,
                color: theme.colors.textPrimary,
                transform: [{ skewX: '-8deg' }],
              }}
            />
            {questionSub ? (
              <Text
                style={{
                  marginTop: 10,
                  color: theme.colors.textSubtleStrong,
                  fontSize: 13.5,
                  lineHeight: 20,
                  fontFamily: theme.fonts.ui,
                  opacity: titleDone ? 1 : 0,
                }}
              >
                {questionSub}
              </Text>
            ) : null}
          </View>

          {/* The answers stay invisible and untouchable until the title has
              finished typing — the design reveals them as the sentence lands. */}
          <View
            style={{
              flex: 1,
              marginTop: reservesTitleBlock ? 26 : 0,
              opacity: titleDone ? 1 : 0,
            }}
            pointerEvents={titleDone && !liftValue && !reacting ? 'auto' : 'none'}
          >

          {question.kind === 'date' ? (
            <View style={{ flex: 1, marginTop: 16 }}>
              <BirthDateWheel
                q={question}
                value={value as Date | null}
                onChange={onChange}
                onPoke={handlePoke}
              />
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
              {/* The unit selector is the first thing in the answer area, above
                  the number — and only on the body measurement steps, which are
                  the ones that have two units to offer. */}
              {measurementUnit && onMeasurementUnitChange ? (
                <UnitToggle
                  kind={measurementKindOf(measurementUnit)}
                  value={measurementUnit}
                  onChange={onMeasurementUnitChange}
                  reduceMotion={reduceMotion}
                  compact={compact}
                />
              ) : null}
              <NumberWheel
                q={question}
                value={(value as number) ?? question.default}
                onChange={onChange}
                onLean={handleLean}
                bodyWeight={bodyWeightWheel}
                measurement={measurementUnit ? measurementKindOf(measurementUnit) : undefined}
                displayUnit={measurementUnit ?? undefined}
                compact={compact}
              />
            </View>
          ) : isSingleChoice && !answerControl ? (
            // Never a ScrollView: the chosen row has to be on screen in order
            // to lift off it. `dense` is what makes a long list fit instead.
            <View ref={listRef} style={{ flex: 1, marginTop: 16 }} collapsable={false}>
              {question.kind === 'choice' ? (
                <ChoiceGrid
                  questionId={question.id}
                  options={question.options}
                  value={value as string}
                  onChange={(next) => handleChoiceSelect(
                    next,
                    question.options.findIndex((o) => o.v === next),
                    question.options.length,
                  )}
                  showOptionShort={question.showOptionShort}
                  labelFor={optionLabel}
                  descriptionFor={optionDescription}
                  dense={dense}
                  occupiedValue={perchedValue}
                  liftValue={liftValue}
                  lift={lift}
                  reduceMotion={reduceMotion}
                  onRowLayout={(optionValue, event) => {
                    rowRects.current[optionValue] = event.nativeEvent.layout;
                  }}
                />
              ) : question.kind === 'choice-large' ? (
                <ChoiceList
                  questionId={question.id}
                  options={question.options}
                  value={value as string}
                  onChange={(next) => handleChoiceSelect(
                    next,
                    question.options.findIndex((o) => o.v === next),
                    question.options.length,
                  )}
                  labelFor={optionLabel}
                  descriptionFor={optionDescription}
                  dense={dense}
                  occupiedValue={perchedValue}
                  liftValue={liftValue}
                  lift={lift}
                  reduceMotion={reduceMotion}
                  onRowLayout={(optionValue, event) => {
                    rowRects.current[optionValue] = event.nativeEvent.layout;
                  }}
                />
              ) : null}
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
              keyboardShouldPersistTaps="handled"
            >
              {inlineAnswerControl ? (
                stretchAnswerControl
                  ? <View style={{ flex: 1, marginBottom: 20 }}>{inlineAnswerControl}</View>
                  : inlineAnswerControl
              ) : null}
              {!answerControl && question.kind === 'multi' && (
                <MultiList
                  questionId={question.id}
                  options={question.options}
                  value={(value as string[]) || []}
                  onChange={onChange}
                  maxSelections={question.maxSelections}
                  exclusiveOption={question.exclusiveOption}
                  layout={question.layout}
                  dense={dense}
                  labelFor={optionLabel}
                  onToggled={handleMultiToggled}
                />
              )}
              {!answerControl && question.kind === 'multi-exact' && (
                <MultiList
                  questionId={question.id}
                  options={question.options}
                  value={(value as string[]) || []}
                  onChange={onChange}
                  maxSelections={question.count}
                  dense={dense}
                  labelFor={optionLabel}
                  onToggled={handleMultiToggled}
                />
              )}
              {!answerControl && question.kind === 'compound-choice' && (
                <CompoundChoiceList
                  question={question}
                  value={(value as Record<string, string | null>) ?? {}}
                  onChange={(next) => {
                    handleMultiToggled('', true);
                    onChange(next);
                  }}
                />
              )}
            </ScrollView>
          )}

          {question.kind === 'date' && value instanceof Date && computeAge(value) < question.minAge ? (
            <Text
              accessibilityRole="alert"
              style={{
                marginTop: 12,
                color: theme.colors.fieldErrorText,
                fontFamily: theme.fonts.ui,
                fontSize: 13.5,
                lineHeight: 19,
                textAlign: 'center',
              }}
            >
              {t('quiz:birthDate.minimumAge', { min: question.minAge })}
            </Text>
          ) : null}

          {answerFooter ? <View style={{ marginTop: 14 }}>{answerFooter}</View> : null}

            {/* Single choice has no confirm button: the tap IS the answer
                (see `handleChoiceSelect`). Everything that takes more than one
                mark — multi, compound, the ruler, the date, the composed
                pickers — still confirms explicitly. */}
            {autoAdvanceOnSelect ? null : (
              <AqPrimaryButton
                label={ctaLabel ?? t('common:actions.continue')}
                onPress={handleNext}
                disabled={!canContinue}
                style={{ marginTop: answerFooter ? 10 : 'auto' }}
              />
            )}
          </View>
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
            paddingHorizontal: 22,
          }}
        >
          {answerControl}
        </View>
      ) : null}

      {/* Reaction: AJ steps to the centre of the screen and the step clears
          out from under him, so the line is the only thing left. The mascot
          himself is the funnel's, one layer above this one. */}
      {reacting && reactionLine ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: theme.colors.background,
          }}
        >
          <AjSpeechText
            text={reactionLine}
            msPerChar={AJ_TYPING_MS_PER_CHAR.reaction}
            reduceMotion={reduceMotion}
            onStart={() => aj.setTalking(true)}
            onDone={() => {
              aj.setTalking(false);
              later(finish, AJ_REACT_HOLD_MS);
            }}
            style={{
              position: 'absolute',
              top: height * AJ_REACT_STAGE.yFraction + AJ_REACT_STAGE.speechOffsetY,
              left: 30,
              right: 30,
              textAlign: 'center',
              fontFamily: theme.fonts.ui,
              fontSize: 16,
              lineHeight: 23,
              color: theme.colors.textSpeechSoft,
            }}
          />
        </View>
      ) : null}

      <ProfessionalClearanceModal status={safetyBlock} onDismiss={() => setSafetyBlock(null)} />
    </View>
  );
}
