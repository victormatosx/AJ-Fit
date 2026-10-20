import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { RISE_IN_EASING } from '../ui/RiseIn';
import { AJ_RISE } from '../aj/ajMomentTiming';
import type { OnboardingStepId } from '../../onboarding/steps';

/**
 * 400ms, matching `AJ_RISE` — the approved design gives every step's content
 * the same arrival as the blocks inside it, so a step entering and a section
 * of that step settling are one gesture rather than two speeds. (It was 320ms
 * before the design landed, chosen for the same reason: responsiveness under
 * a fast run of taps. 400ms is still comfortably inside that.)
 */
const STEP_TRANSITION_DURATION = AJ_RISE.durationMs;
const STEP_TRANSITION_TRANSLATE_Y = AJ_RISE.translateY;

/**
 * Single, uniform entrance transition for every step in the funnel —
 * question, interstitial, presentation, social proof, processing, result.
 * Reuses the axis/easing/distance of `RiseIn` (`src/components/ui/RiseIn.tsx`),
 * the pre-existing per-section reveal `PlanReadyScreen` already used before
 * any of this funnel motion work existed — the one transition in the funnel
 * independently validated as feeling good in the real app. Duration here is
 * shorter than `RiseIn`'s own 600ms (320ms) because this fires once per tap
 * as a single block, not as a 5-section cascade — at 600ms a fast sequence
 * of `CONTINUAR` taps reads as sluggish; 320ms keeps the same "settle into
 * place" language responsive. No lateral movement, no direction handling —
 * `RiseIn` itself has none, and neither does the reference transition.
 *
 * `currentStepId` is always the single visual source of truth: React swaps
 * `children` immediately, in the same commit as the navigation state
 * update — there is no exit phase and no retained/frozen previous tree.
 * Every step, including consecutive questions, now genuinely remounts here
 * (see `key={currentStepId}` on `QuestionStepScreen` in
 * `OnboardingFunnelScreen`), so this single mechanism applies uniformly —
 * no per-step-kind exceptions, no `disableTransition`.
 */
export function AnimatedStepContainer({
  stepKey,
  children,
}: {
  stepKey: OnboardingStepId;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotionPreference();
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const mountedOnce = useRef(false);

  useLayoutEffect(() => {
    if (!mountedOnce.current) {
      // First render of the whole funnel — nothing to transition from.
      mountedOnce.current = true;
      return;
    }
    animRef.current?.stop();

    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.setValue(0);
    translateY.setValue(STEP_TRANSITION_TRANSLATE_Y);
    animRef.current = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: STEP_TRANSITION_DURATION,
        easing: RISE_IN_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: STEP_TRANSITION_DURATION,
        easing: RISE_IN_EASING,
        useNativeDriver: true,
      }),
    ]);
    animRef.current.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retriggers only on step identity
  }, [stepKey]);

  useEffect(
    () => () => {
      animRef.current?.stop();
    },
    [],
  );

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}
