import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AjBotStage, type AjStageOrbit } from '../aj/AjBotStage';
import type { AjBotMood } from '../aj/AjBot';
import {
  AJ_BOT_HOP,
  AJ_BOT_LOOK_NEUTRAL,
  AJ_BOT_NOD,
  type AjStagePose,
} from '../aj/ajBotMotion';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { questionPose } from './ajFunnelChoreography';

/**
 * The onboarding funnel's single AJ.
 *
 * The funnel remounts its content on every step (`AnimatedStepContainer` keyed
 * on `currentStepId`), which is exactly what the step transition needs and
 * exactly what the mascot must not experience: an AJ inside that subtree would
 * be destroyed and rebuilt 44 times, replaying his entrance on every question
 * and making "travel from the previous step's pose" impossible to express.
 *
 * So the mascot lives here instead — one instance, mounted once, outside the
 * remounting subtree, rendered as an overlay above it. Steps don't render a
 * mascot; they *direct* this one through `useAjFunnelDirector()`, handing it a
 * pose and an expression. Between two questions that resolve to the same pose
 * the instruction is a no-op and AJ simply stays put while the content behind
 * him changes, which is what the design shows.
 *
 * The component owns no funnel state and makes no decisions about the funnel.
 * It is a stage: it knows where the mascot is standing and what face he is
 * making, nothing else.
 */

export interface AjFunnelLayout {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
}

export interface AjFunnelDirector {
  /** OS Reduce Motion, resolved once here so every step agrees on it. */
  reduceMotion: boolean;
  /** Screen box the pose helpers in `ajFunnelChoreography` need. */
  layout: AjFunnelLayout;
  /** Move AJ. Travel is automatic; passing the current pose costs nothing. */
  direct: (next: AjStagePose, options?: { immediate?: boolean }) => void;
  followOrbit: (orbit: AjStageOrbit | null) => void;
  setMood: (mood: AjBotMood) => void;
  setLook: (look: readonly [number, number]) => void;
  /** Drives the mouth. Callers pair this with their own typed line. */
  setTalking: (talking: boolean) => void;
  /** One-shot bounce or nod; AJ returns to idle (and to floating) afterwards. */
  play: (phase: 'hop' | 'nod') => void;
  /** Hide the mascot entirely, for steps that own their own full-screen art. */
  setVisible: (visible: boolean) => void;
}

const AjFunnelStageContext = createContext<AjFunnelDirector | null>(null);

/**
 * Steps outside the funnel (the forced-questionnaire entry points, tests,
 * Storybook-style harnesses) can render a question without a stage above them.
 * They get a director that accepts every instruction and drops it, so no step
 * component needs a null check around its own choreography.
 */
const INERT_DIRECTOR: AjFunnelDirector = {
  reduceMotion: true,
  layout: { width: 0, height: 0, safeTop: 0, safeBottom: 0 },
  direct: () => {},
  followOrbit: () => {},
  setMood: () => {},
  setLook: () => {},
  setTalking: () => {},
  play: () => {},
  setVisible: () => {},
};

export function useAjFunnelDirector(): AjFunnelDirector {
  return useContext(AjFunnelStageContext) ?? INERT_DIRECTOR;
}

/**
 * Declares where AJ stands for as long as this step is mounted, or hides him
 * for the steps that own their own full-screen art (the analysis, and the Plan
 * screen, which runs its own mascot inside its own layout).
 *
 * Every non-question step needs one of these. Without it AJ simply stays where
 * the previous step left him — parked in the question corner, floating over an
 * interstitial that has no question for him to be standing next to.
 *
 * `build` receives the resolved screen box and is re-run whenever it changes
 * (rotation, a different device, the keyboard resizing the window), so a pose
 * expressed as "centre of the screen" stays centred.
 */
export function useAjStagePose(
  build: ((layout: AjFunnelLayout) => AjStagePose) | 'hidden',
  options?: { mood?: AjBotMood; look?: readonly [number, number] },
): AjFunnelDirector {
  const director = useAjFunnelDirector();
  const { direct, setVisible, setMood, setLook, layout } = director;
  const mood = options?.mood;
  const look = options?.look;

  useEffect(() => {
    if (build === 'hidden') {
      setVisible(false);
      return () => setVisible(true);
    }
    setVisible(true);
    direct(build(layout));
    return () => undefined;
  }, [build, layout, direct, setVisible]);

  useEffect(() => {
    if (mood) setMood(mood);
  }, [mood, setMood]);

  useEffect(() => {
    if (look) setLook(look);
  }, [look, setLook]);

  return director;
}

export function AjFunnelStage({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotionPreference();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rootRef = useAnimatedRef<View>();

  const layout = useMemo<AjFunnelLayout>(
    () => ({ width, height, safeTop: insets.top, safeBottom: insets.bottom }),
    [width, height, insets.top, insets.bottom],
  );

  // The first pose is the question corner rather than anything off-screen:
  // the funnel can mount directly onto a resumed question (draft restore, dev
  // jump), and AJ sliding in from nowhere on that mount would announce a
  // transition the user never made.
  const [pose, setPose] = useState<AjStagePose>(() => questionPose(width, insets.top));
  const [immediate, setImmediate] = useState(false);
  const [orbit, setOrbit] = useState<AjStageOrbit | null>(null);
  const followOrbit = useCallback((next: AjStageOrbit | null) => {
    setOrbit((current) => {
      if (!current || !next) return next;
      return current.anchor === next.anchor && current.progress === next.progress
        && current.size === next.size && current.onArrived === next.onArrived ? current : next;
    });
  }, []);
  const [mood, setMoodState] = useState<AjBotMood>('idle');
  const [look, setLookState] = useState<readonly [number, number]>(AJ_BOT_LOOK_NEUTRAL);
  const [talking, setTalkingState] = useState(false);
  const [visible, setVisibleState] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'hop' | 'nod'>('idle');
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const direct = useCallback((next: AjStagePose, options?: { immediate?: boolean }) => {
    setOrbit(null);
    setImmediate(Boolean(options?.immediate));
    // Pose identity, not object identity: steps rebuild their pose on every
    // render, and handing `AjBotStage` a new-but-equal object would restart
    // the travel animation each time.
    setPose((current) =>
      current.x === next.x
        && current.y === next.y
        && current.size === next.size
        && (current.rotate ?? 0) === (next.rotate ?? 0)
        ? current
        : next);
  }, []);

  const setMood = useCallback((next: AjBotMood) => setMoodState(next), []);
  const setTalking = useCallback((next: boolean) => setTalkingState(next), []);
  const setVisible = useCallback((next: boolean) => setVisibleState(next), []);
  const setLook = useCallback((next: readonly [number, number]) => {
    setLookState((current) =>
      current[0] === next[0] && current[1] === next[1] ? current : next);
  }, []);

  const play = useCallback(
    (next: 'hop' | 'nod') => {
      if (reduceMotion) return;
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
      // Through `idle` first, so two bounces in a row genuinely replay:
      // `AjBot` restarts a phase when the phase *changes*, and hop -> hop is
      // not a change.
      setPhase('idle');
      const duration = next === 'hop' ? AJ_BOT_HOP.durationMs : AJ_BOT_NOD.durationMs;
      phaseTimer.current = setTimeout(() => {
        setPhase(next);
        phaseTimer.current = setTimeout(() => setPhase('idle'), duration);
      }, 0);
    },
    [reduceMotion],
  );

  useEffect(
    () => () => {
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
    },
    [],
  );

  const director = useMemo<AjFunnelDirector>(
    () => ({ reduceMotion, layout, direct, followOrbit, setMood, setLook, setTalking, play, setVisible }),
    [reduceMotion, layout, direct, followOrbit, setMood, setLook, setTalking, play, setVisible],
  );

  return (
    <AjFunnelStageContext.Provider value={director}>
      <Animated.View ref={rootRef} collapsable={false} style={{ flex: 1 }}>
        {children}
        {/* Always mounted, even while `visible` is false — see `AjBotStage`'s
            `visible` prop. Unmounting here (as this used to do) meant every
            hidden-to-shown step (e.g. the presentation's "Montar meu plano"
            into `name`) remounted the stage fresh and snapped straight to
            position instead of fading/travelling in. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <AjBotStage
            pose={pose}
            mood={mood}
            phase={phase}
            look={look}
            talking={talking}
            reduceMotion={reduceMotion}
            visible={visible}
            travel={immediate ? 'instant' : 'default'}
            orbit={orbit}
            coordinateRef={rootRef}
          />
        </View>
      </Animated.View>
    </AjFunnelStageContext.Provider>
  );
}
