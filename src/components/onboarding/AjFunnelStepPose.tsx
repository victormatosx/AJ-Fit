import { useMemo } from 'react';
import type { AjBotMood } from '../aj/AjBot';
import type { AjStagePose } from '../aj/ajBotMotion';
import { useAjStagePose, type AjFunnelLayout } from './AjFunnelStage';
import {
  interstitialPose,
  questionPose,
  videoInterstitialPose,
} from './ajFunnelChoreography';
import type { OnboardingStepId } from '../../onboarding/steps';

/**
 * Where AJ stands on the funnel steps that are not questions.
 *
 * Ownership is split along one line, and only one:
 *
 * - **Question steps direct themselves.** `QuestionStepScreen` (and
 *   `NameStepScreen`) already hold everything a question's choreography
 *   needs — the typing state, the tapped row's measured rect, the ruler's
 *   current fraction — so the pose belongs next to that, not here.
 * - **Everything else is declared here**, in one list. Those steps are
 *   presentational screens with no mascot logic of their own, and spreading
 *   eight near-identical `useAjStagePose` calls across eight files would make
 *   "where is AJ on step X" an eight-file question.
 *
 * The partition matters because two owners directing one mascot would fight.
 * This component renders nothing and returns null for any step a question
 * component owns.
 */

type PoseSpec =
  | { kind: 'hidden' }
  | { kind: 'pose'; build: (layout: AjFunnelLayout) => AjStagePose; mood?: AjBotMood };

const centre = (layout: AjFunnelLayout) => interstitialPose(layout.width, layout.height);
const videoTop = (layout: AjFunnelLayout) => videoInterstitialPose(layout.width, layout.safeTop);
const questionCorner = (layout: AjFunnelLayout) => questionPose(layout.width, layout.safeTop);

const POSE_BY_STEP: Partial<Record<OnboardingStepId, PoseSpec>> = {
  // The three presentation slides keep their original composition, which has
  // no mascot and reserves no room for one — AJ would float over the
  // headline. He arrives on `welcome`, the first step that was designed
  // around him.
  presentation: { kind: 'hidden' },
  // The only step with nothing of its own to show, so AJ gets the middle.
  welcome: { kind: 'pose', build: centre, mood: 'happy' },
  // Every other interstitial carries real media (a carousel, a player), so AJ
  // takes the small high pose and leaves the frame its room.
  interstitial_evolution: { kind: 'pose', build: videoTop, mood: 'happy' },
  interstitial_methodology: { kind: 'pose', build: videoTop, mood: 'idle' },
  interstitial_guidedWorkout: { kind: 'pose', build: videoTop, mood: 'idle' },
  interstitial_ajFitProgress: { kind: 'pose', build: videoTop, mood: 'happy' },
  socialProof: { kind: 'pose', build: videoTop, mood: 'happy' },
  // A question-shaped step with its own dedicated screen: same corner as any
  // other question, so arriving at it is not a jump.
  healthIntegration: { kind: 'pose', build: questionCorner, mood: 'idle' },
  // A full-screen progress piece with no room for a mascot.
  analyzing: { kind: 'hidden' },
  // `plan` is absent on purpose: `PlanReadyScreen` directs AJ itself, because
  // his pose there is derived from the measured height of its own sheet —
  // something only that screen knows.
};

export function AjFunnelStepPose({ stepId }: { stepId: OnboardingStepId }) {
  const spec = POSE_BY_STEP[stepId];
  // Nutrition steps are questions; `QuestionStepScreen` owns them.
  if (!spec || stepId.startsWith('nutrition_')) return null;
  return <StagePose key={stepId} spec={spec} />;
}

function StagePose({ spec }: { spec: PoseSpec }) {
  const build = useMemo(
    () => (spec.kind === 'hidden' ? ('hidden' as const) : spec.build),
    [spec],
  );

  const options = useMemo(
    () => (spec.kind === 'hidden' ? undefined : { mood: spec.mood }),
    [spec],
  );

  useAjStagePose(build, options);
  return null;
}
