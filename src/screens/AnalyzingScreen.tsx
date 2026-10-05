import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { CtaButton } from '../components/ui/CtaButton';
import { CircularProgressRing } from '../components/ui/CircularProgressRing';
import { displayLineHeight } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAppState } from '../state/AppState';
import { logInfo, logWarn } from '../lib/logger';
import { prepareWorkoutProgramLocally } from '../services/workoutPrograms';
import type { PrescriptionResult } from '../workoutPrescription/types';
import { onboardingGenerationFailurePresentation } from '../workoutPrescription/uiOutcome';

export function AnalyzingScreen({
  name,
  onDone,
  onReviewAnswers,
}: {
  name?: string | null;
  onDone: () => void;
  onReviewAnswers: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('onboarding');
  const { t: tPlan } = useTranslation('plan');
  const { quiz, setPreparedWorkoutProgram } = useAppState();
  const [progress, setProgress] = useState(0);
  const steps = [
    t('analyzing.steps.profile'),
    t('analyzing.steps.volume'),
    t('analyzing.steps.exercises'),
    t('analyzing.steps.periodization'),
    t('analyzing.steps.plan'),
  ];

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

  // Active step index: 0..steps.length-1. Clamped so the final step stays
  // "active" until onDone fires (never enters the "done" state itself).
  const stepFloat = (progress / 100) * steps.length;
  const activeIdx = Math.min(steps.length - 1, Math.floor(stepFloat));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: 40,
            paddingBottom: 36,
          }}
        >
          <View style={{ marginBottom: 26 }}>
            <CircularProgressRing
              progress={progress}
              label={t('analyzing.compiling')}
              accessibilityLabel={t('analyzing.accessibility.progress', { progress })}
              pulseGlow
            />
          </View>

          {/* ── Title ── */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Text
              style={{
                fontFamily: theme.fonts.display,
                fontSize: 32,
                lineHeight: displayLineHeight(32),
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: theme.colors.textPrimary,
                textAlign: 'center',
                transform: [{ skewX: '-8deg' }],
              }}
            >
              {renderHighlightedTitle(
                name
                  ? `${t('analyzing.titleWithNameLine1').toUpperCase()}\n${t('analyzing.titleWithNameLine2', { name }).toUpperCase()}`
                  : `${t('analyzing.titleLine1').toUpperCase()}\n${t('analyzing.titleLine2').toUpperCase()}`,
                theme.colors.primaryEmphasis,
              )}
            </Text>
          </View>

          {/* ── Synced checklist ── */}
          <View style={{ gap: 10 }}>
            {steps.map((label, i) => {
              const done = i < activeIdx;
              const active = i === activeIdx;
              return (
                <StepPill
                  key={i}
                  label={label}
                  state={done ? 'done' : active ? 'active' : 'pending'}
                />
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// Splits the title on "jornada" (any case) and paints that word in the
// accent blue — the rest of the title stays white.
function renderHighlightedTitle(text: string, highlightColor: string) {
  const parts = text.split(/(jornada)/i);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^jornada$/i.test(part) ? (
      <Text key={i} style={{ color: highlightColor }}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

type StepState = 'pending' | 'active' | 'done';

function StepPill({ label, state }: { label: string; state: StepState }) {
  const { theme } = useTheme();
  const isActive = state === 'active';
  const opacity = state === 'pending' ? 0.5 : 1;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 15,
        paddingHorizontal: 18,
        borderRadius: 16,
        backgroundColor: isActive ? theme.colors.primarySurfaceActive : theme.colors.surfaceQuiet,
        borderWidth: 1,
        borderColor: isActive ? theme.colors.primaryBorderActive : theme.colors.border,
        shadowColor: isActive ? theme.colors.primaryEmphasis : 'transparent',
        shadowOpacity: isActive ? 0.75 : 0,
        shadowRadius: isActive ? 28 : 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: isActive ? 10 : 0,
        opacity,
      }}
    >
      <StepIndicator state={state} />
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
    </View>
  );
}

function StepIndicator({ state }: { state: StepState }) {
  const { theme } = useTheme();
  // Active step spins — mirrors @keyframes aj2-spin-slow (0.9s linear).
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'active') return;
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
  }, [state, spin]);

  if (state === 'done') {
    // Flat solid-blue disc + white check. No halo — the item has already
    // finished; the LED bloom lives on the active step only.
    return (
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: theme.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
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
            stroke={theme.colors.borderStrong}
            strokeWidth={2.5}
          />
          {/* Fake drop-shadow: a wider, softer twin sits beneath the arc so
              the moving head reads as a lit-up LED (RN-SVG can't do a real
              filter="drop-shadow"). */}
          <Path
            d="M13 3 a10 10 0 0 1 10 10"
            fill="none"
            stroke={theme.colors.primary}
            strokeWidth={6}
            strokeLinecap="round"
            opacity={0.55}
          />
          {/* Bright blue arc on top */}
          <Path
            d="M13 3 a10 10 0 0 1 10 10"
            fill="none"
            stroke={theme.colors.primaryEmphasis}
            strokeWidth={2.8}
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
