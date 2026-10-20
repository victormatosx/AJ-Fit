import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { CtaButton } from '../components/ui/CtaButton';
import { MonoLabel } from '../components/ui/Display';
import { AjSpeechText } from '../components/aj/AjSpeechText';
import { AnalysisAjRing } from '../components/onboarding/AnalysisAjRing';
import {
  ANALYSIS_LAYOUT,
  analysisComposition,
  analysisLookAt,
} from '../components/onboarding/analysisComposition';
import { displayLineHeight } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAppState } from '../state/AppState';
import { useReducedMotionPreference } from '../lib/reducedMotion';
import { logInfo, logWarn } from '../lib/logger';
import { prepareWorkoutProgramLocally } from '../services/workoutPrograms';
import type { PrescriptionResult } from '../workoutPrescription/types';
import { onboardingGenerationFailurePresentation } from '../workoutPrescription/uiOutcome';

/**
 * The five checkpoints the screen narrates. One key per step: the pill's
 * label and the line AJ says while that step is active come from the same
 * entry, so the two can never drift apart.
 *
 * Deliberately label-only. The design prototype printed a value under each
 * finished row ("165 cm · 62 kg · IMC 22,8", "46 exercícios", "2.250 kcal"),
 * but those numbers are invented there; nothing this screen or the real
 * prescription computes is exposed as a per-step readout, so no value line is
 * rendered rather than a fabricated one.
 */
const STEP_KEYS = ['profile', 'volume', 'exercises', 'periodization', 'plan'] as const;

/** Design cadence for AJ's narration — slower than a question, faster than prose. */
const SPEECH_MS_PER_CHAR = 22;

export function AnalyzingScreen({
  onDone,
  onReviewAnswers,
}: {
  onDone: () => void;
  onReviewAnswers: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('onboarding');
  const { t: tPlan } = useTranslation('plan');
  const { quiz, setPreparedWorkoutProgram } = useAppState();
  const reduceMotion = useReducedMotionPreference();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState(0);
  const [talking, setTalking] = useState(false);
  const steps = STEP_KEYS.map((key) => t(`analyzing.steps.${key}`));

  // Phase 3, Part D — the REAL Prescription Engine now runs here (pre-auth,
  // local sources — `prepareWorkoutProgramLocally`), not just a timed
  // animation. `attempt` bumps to let the retry button re-run the exact
  // same computation after a failure (deterministic — see
  // `prepareWorkoutProgram`'s doc comment — a retry can only ever help if
  // the previous attempt's cause was a genuine transient anomaly, but it's
  // a safe, harmless escape hatch either way; the user is never stuck on
  // a dead screen).
  const [attempt, setAttempt] = useState(0);
  const [computeStatus, setComputeStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [failureStatus, setFailureStatus] = useState<Exclude<PrescriptionResult['status'], 'SUCCESS'> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    // Never logs full questionnaire answers — only technical identifiers.
    logInfo('onboarding', 'onboarding_workout_generation_started', { attempt });
    prepareWorkoutProgramLocally(quiz)
      .then((result) => {
        if (cancelled) return;
        const durationMs = Date.now() - startedAt;
        if (result.status === 'SUCCESS') {
          setPreparedWorkoutProgram(result);
          logInfo('onboarding', 'onboarding_workout_generation_succeeded', {
            templateId: result.templateId,
            planId: result.plan.planId,
            durationMs,
            status: result.status,
          });
          setComputeStatus('success');
        } else {
          setPreparedWorkoutProgram(null);
          setFailureStatus(result.status);
          logWarn('onboarding', 'onboarding_workout_generation_failed', {
            durationMs,
            status: result.status,
            reasonCode: result.reasonCodes[0],
          });
          setComputeStatus('error');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreparedWorkoutProgram(null);
        setFailureStatus(null);
        logWarn('onboarding', 'onboarding_workout_generation_failed', {
          durationMs: Date.now() - startedAt,
          status: 'EXCEPTION',
          errorClass: error instanceof Error ? error.constructor.name : typeof error,
        });
        setComputeStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `quiz` is intentionally captured once per `attempt`, not re-run on every keystroke-level change
  }, [attempt]);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(id);
          return 100;
        }
        return p + 1;
      });
    }, 52);
    return () => clearInterval(id);
  }, [attempt]);

  useEffect(() => {
    // Never advances on a timer alone (existing UX minimum) AND never
    // advances without the real result (Part D's "não avance... enquanto o
    // resultado obrigatório ainda não estiver pronto"). Whichever finishes
    // last is what gates `onDone`.
    if (progress >= 100 && computeStatus === 'success') {
      const id = setTimeout(onDone, 700);
      return () => clearTimeout(id);
    }
  }, [progress, computeStatus]);

  // Everything the presentation needs is derived from that same pair — the
  // visual state never runs ahead of, or behind, what the screen actually
  // knows. `completed` is true exactly when `onDone` has been scheduled, so
  // the celebration occupies the delay that already existed; no time is added.
  const completed = progress >= 100 && computeStatus === 'success';
  // Active step index: 0..steps.length-1. Clamped so the final step stays
  // "active" until the real result lands (never enters the "done" state on a
  // timer alone).
  const stepFloat = (progress / 100) * steps.length;
  const activeIdx = Math.min(steps.length - 1, Math.floor(stepFloat));
  const look = useMemo(
    () => (completed ? ([0, 0] as const) : analysisLookAt(activeIdx, STEP_KEYS.length)),
    [completed, activeIdx],
  );

  if (computeStatus === 'error') {
    const presentation = failureStatus
      ? onboardingGenerationFailurePresentation(failureStatus)
      : { outcomeKey: 'technicalError' as const, action: 'retry' as const };
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 16 }}>
            <Text
              style={{
                fontFamily: theme.fonts.display,
                fontSize: 26,
                lineHeight: displayLineHeight(26),
                color: theme.colors.textPrimary,
                textAlign: 'center',
              }}
            >
              {tPlan(`prescription.${presentation.outcomeKey}.title`)}
            </Text>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textMuted, textAlign: 'center' }}>
              {tPlan(`prescription.${presentation.outcomeKey}.body`)}
            </Text>
            <CtaButton
              onPress={presentation.action === 'retry'
                ? () => {
                    setProgress(0);
                    setFailureStatus(null);
                    setComputeStatus('pending');
                    setAttempt((a) => a + 1);
                  }
                : onReviewAnswers}
            >
              <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.display, fontSize: 16 }}>
                {presentation.action === 'retry'
                  ? t('analyzing.error.retry')
                  : t('analyzing.error.reviewAnswers')}
              </Text>
            </CtaButton>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const composition = analysisComposition(height - insets.top, steps.length);
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  // Announced at step granularity, never per frame: a live region that
  // retriggered on every 1% tick would talk over itself for five seconds.
  const announcedPercent = completed
    ? 100
    : Math.round((activeIdx / steps.length) * 100);
  const line = completed
    ? t('analyzing.speech.done')
    : t(`analyzing.speech.${STEP_KEYS[activeIdx]}`);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Only the top edge is a safe-area inset: the design's own 36pt
          bottom gap already clears the home indicator, and adding the inset
          on top of it would push the checklist off a 844pt screen. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: ANALYSIS_LAYOUT.paddingTop,
            paddingBottom: Math.max(ANALYSIS_LAYOUT.paddingBottom, insets.bottom),
          }}
        >
          <View style={{ marginBottom: ANALYSIS_LAYOUT.ringGap }}>
            <AnalysisAjRing
              geometry={composition.ring}
              progress={percent / 100}
              stepIndex={activeIdx}
              completed={completed}
              mood={completed ? 'happy' : talking ? 'talk' : 'think'}
              look={look}
              talking={talking}
              reduceMotion={reduceMotion}
            />
          </View>

          {/* ── Percentage ── */}
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={t('analyzing.accessibility.progress', { progress: announcedPercent })}
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: 8,
              marginBottom: ANALYSIS_LAYOUT.percentGap,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text
                style={{
                  fontFamily: theme.fonts.display,
                  fontSize: 26,
                  lineHeight: displayLineHeight(26),
                  color: theme.colors.textPrimary,
                  fontVariant: ['tabular-nums'],
                  transform: [{ skewX: '-8deg' }],
                }}
              >
                {percent}
              </Text>
              <Text
                style={{
                  fontFamily: theme.fonts.display,
                  fontSize: 14,
                  lineHeight: displayLineHeight(26),
                  color: theme.colors.primaryEmphasis,
                  transform: [{ skewX: '-8deg' }],
                }}
              >
                %
              </Text>
            </View>
            <MonoLabel>
              {(completed ? t('analyzing.completed') : t('analyzing.compiling')).toUpperCase()}
            </MonoLabel>
          </View>

          {/* ── Title ── */}
          <View style={{ alignItems: 'center', marginBottom: ANALYSIS_LAYOUT.titleGap }}>
            <Text
              style={{
                fontFamily: theme.fonts.display,
                fontSize: composition.titleSize,
                lineHeight: displayLineHeight(composition.titleSize),
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: theme.colors.textPrimary,
                textAlign: 'center',
                transform: [{ skewX: '-8deg' }],
              }}
            >
              {`${t('analyzing.titleLine1')}\n${t('analyzing.titleLine2')}`}
            </Text>
          </View>

          {/* ── What AJ is saying about the step in progress ── */}
          <View
            accessibilityLiveRegion="polite"
            style={{
              minHeight: ANALYSIS_LAYOUT.speechMinHeight,
              marginBottom: ANALYSIS_LAYOUT.speechGap,
              paddingHorizontal: 10,
              alignItems: 'center',
            }}
          >
            <AjSpeechText
              key={line}
              text={line}
              msPerChar={SPEECH_MS_PER_CHAR}
              reduceMotion={reduceMotion}
              onStart={() => setTalking(true)}
              onDone={() => setTalking(false)}
              style={{
                fontFamily: theme.fonts.ui,
                fontSize: 14.5,
                lineHeight: 21,
                color: theme.colors.textSecondaryStrong,
                textAlign: 'center',
              }}
            />
          </View>

          {/* ── Synced checklist ── */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: ANALYSIS_LAYOUT.rowGap }}
            showsVerticalScrollIndicator={false}
          >
            {steps.map((label, i) => {
              const done = completed || i < activeIdx;
              const active = !completed && i === activeIdx;
              return (
                <StepPill
                  key={STEP_KEYS[i]}
                  label={label}
                  paddingVertical={composition.rowPaddingVertical}
                  reduceMotion={reduceMotion}
                  state={done ? 'done' : active ? 'active' : 'pending'}
                  accessibilityLabel={t(
                    done
                      ? 'analyzing.accessibility.stepDone'
                      : active
                        ? 'analyzing.accessibility.stepActive'
                        : 'analyzing.accessibility.stepPending',
                    { label },
                  )}
                />
              );
            })}
          </ScrollView>

          {/* ── Escape hatch — unchanged behaviour, it still goes back a step ── */}
          <Pressable
            accessibilityRole="button"
            onPress={onReviewAnswers}
            style={{
              minHeight: ANALYSIS_LAYOUT.reviewMinHeight,
              marginTop: ANALYSIS_LAYOUT.reviewGap,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiSemi,
                fontSize: 13.5,
                color: theme.colors.textSubtle,
              }}
            >
              {t('analyzing.error.reviewAnswers')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ── Checklist pieces ────────────────────────────────────────────────────────

type StepState = 'pending' | 'active' | 'done';

function StepPill({
  label,
  state,
  paddingVertical,
  reduceMotion,
  accessibilityLabel,
}: {
  label: string;
  state: StepState;
  paddingVertical: number;
  reduceMotion: boolean;
  accessibilityLabel: string;
}) {
  const { theme } = useTheme();
  const isActive = state === 'active';

  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    paddingVertical,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    opacity: state === 'pending' ? 0.5 : 1,
  };

  const content = (
    <>
      <StepIndicator state={state} reduceMotion={reduceMotion} />
      <Text
        style={{
          fontFamily: theme.fonts.uiSemi,
          fontSize: 14.5,
          color: state === 'pending' ? theme.colors.textInactive : theme.colors.textPrimary,
          flex: 1,
        }}
      >
        {label}
      </Text>
    </>
  );

  if (!isActive) {
    return (
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        style={{
          ...row,
          backgroundColor: theme.colors.surfaceQuiet,
          borderColor: theme.colors.border,
        }}
      >
        {content}
      </View>
    );
  }

  return (
    <LinearGradient
      accessible
      accessibilityLabel={accessibilityLabel}
      colors={theme.gradients.stepActive}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        ...row,
        borderColor: theme.colors.primaryBorderFocus,
        shadowColor: theme.colors.primary,
        shadowOpacity: 0.55,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
      }}
    >
      {content}
    </LinearGradient>
  );
}

function StepIndicator({ state, reduceMotion }: { state: StepState; reduceMotion: boolean }) {
  const { theme } = useTheme();
  // Active step spins — mirrors @keyframes aj2-spin-slow (0.9s linear).
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'active' || reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [state, reduceMotion, spin]);

  if (state === 'done') {
    // Solid blue disc, white check, and the design's soft bloom around it.
    return (
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: theme.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: theme.colors.primary,
          shadowOpacity: 0.6,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Icon name="check" size={14} color={theme.colors.primaryForeground} stroke={2.6} />
      </View>
    );
  }

  if (state === 'active') {
    const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <Animated.View
        style={{
          width: 26,
          height: 26,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate }],
        }}
      >
        <Svg width={26} height={26} viewBox="0 0 26 26">
          {/* Track — dim ring for the unfilled portion */}
          <Circle
            cx="13"
            cy="13"
            r="10"
            fill="none"
            stroke={theme.colors.primaryBorderQuiet}
            strokeWidth={2.5}
          />
          {/* Quarter arc, the moving head of the spinner */}
          <Path
            d="M13 3 a10 10 0 0 1 10 10"
            fill="none"
            stroke={theme.colors.primaryEmphasis}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    );
  }

  // Pending — small 5px dot inside a subtle 26px ring.
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: theme.colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: theme.colors.indicatorInactive,
        }}
      />
    </View>
  );
}
