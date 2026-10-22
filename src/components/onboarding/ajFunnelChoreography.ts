import type { AjStagePose } from '../aj/ajBotMotion';
import { AJ_GATE, AJ_INTERSTITIAL, AJ_PERCH_RADIO, AJ_REACT_STAGE } from '../aj/ajMomentTiming';
import type { OnboardingStepId } from '../../onboarding/steps';

/**
 * Where AJ stands on each kind of funnel step, and which answers he reacts to.
 *
 * Pure geometry and pure lookup, deliberately free of React and React Native:
 * this project's test suite runs in plain Node and cannot render a component,
 * so the numbers that decide whether AJ lands on a radio or next to a title
 * have to be readable without a renderer.
 *
 * Nothing here reads or writes funnel state. The sequence, the applicability
 * rules, the validation and the safety gate all stay where they are
 * (`steps.ts`, `questionDefs.ts`, `profileSteps.ts`, `onboardingSafetyGate.ts`);
 * this module only answers "given a layout, where does the mascot go".
 */

/** Horizontal gutter of the question layout, both sides. */
const GUTTER = 22;
/** AJ's size while a question is on screen. */
const QUESTION_SIZE = 66;
/** AJ's tilt in the question corner. */
const QUESTION_ROTATE = 8;
/** Distance from the top safe-area edge down to AJ's box on a question step. */
const QUESTION_OFFSET_Y = 57;
/** On the name step AJ sits level with the title instead of below it. */
const NAME_STEP_LIFT = 8;

/**
 * AJ parked beside the question title, top-right, tilted. Every question step
 * resolves to this pose, so travelling between two consecutive questions is a
 * no-op in position and only the content underneath changes.
 */
export function questionPose(screenWidth: number, safeTop: number): AjStagePose {
  return {
    x: screenWidth - GUTTER - QUESTION_SIZE,
    y: safeTop + QUESTION_OFFSET_Y,
    size: QUESTION_SIZE,
    rotate: QUESTION_ROTATE,
  };
}

/** The name step's title sits lower, so AJ rises to meet it. */
export function namePose(screenWidth: number, safeTop: number): AjStagePose {
  const pose = questionPose(screenWidth, safeTop);
  return { ...pose, y: pose.y - NAME_STEP_LIFT };
}

/** Centre stage for a reaction line, at a quarter of the screen's height. */
export function reactionPose(screenWidth: number, screenHeight: number): AjStagePose {
  return {
    x: (screenWidth - AJ_REACT_STAGE.size) / 2,
    y: screenHeight * AJ_REACT_STAGE.yFraction,
    size: AJ_REACT_STAGE.size,
    rotate: 0,
  };
}

/** Centre stage for an interstitial, welcome or social-proof step. */
export function interstitialPose(screenWidth: number, screenHeight: number): AjStagePose {
  return {
    x: (screenWidth - AJ_INTERSTITIAL.size) / 2,
    y: screenHeight * AJ_INTERSTITIAL.yFraction,
    size: AJ_INTERSTITIAL.size,
    rotate: 0,
  };
}

/** Video interstitials keep AJ small and high, leaving the player the room. */
export function videoInterstitialPose(screenWidth: number, safeTop: number): AjStagePose {
  return {
    x: (screenWidth - AJ_INTERSTITIAL.videoSize) / 2,
    y: safeTop + AJ_INTERSTITIAL.videoOffsetY,
    size: AJ_INTERSTITIAL.videoSize,
    rotate: 0,
  };
}

/**
 * Perched on a chosen option's radio. `radioCenterX`/`radioCenterY` are the
 * radio's measured centre AFTER the row has finished lifting, and `scale` is
 * the row's own lift scale — AJ shrinks to 34px times that, so he matches the
 * row he is standing on rather than the row's original size.
 */
export function perchPose(
  radioCenterX: number,
  radioCenterY: number,
  scale: number,
): AjStagePose {
  const size = AJ_PERCH_RADIO.perchedSize * scale;
  return {
    x: radioCenterX - size / 2,
    y: radioCenterY - size / 2,
    size,
    rotate: 0,
  };
}

/** Perched on the top edge of the safety sheet, looking down into it. */
export function gatePose(screenWidth: number, sheetTop: number): AjStagePose {
  return {
    x: (screenWidth - AJ_GATE.size) / 2,
    y: sheetTop - AJ_GATE.perchOffsetY,
    size: AJ_GATE.size,
    rotate: 0,
  };
}

/**
 * How much a chosen row grows while it lifts: enough to fill the gutters, but
 * never past the design's ceiling.
 */
export function liftScale(rowWidth: number, screenWidth: number): number {
  if (rowWidth <= 0) return 1;
  return Math.min(AJ_PERCH_RADIO.liftMaxScale, (screenWidth - 36) / rowWidth);
}

/** How far a chosen row travels to reach the vertical centre of the screen. */
export function liftTranslateY(screenHeight: number, rowCenterY: number): number {
  return screenHeight / 2 - rowCenterY;
}

/* ── Section labels ──────────────────────────────────────────────────────── */

/**
 * The mono kicker above each question title, as an i18n key suffix under
 * `quiz:sections`. Steps absent from this map render no kicker rather than a
 * guessed one — a wrong section label is worse than none.
 */
export const AJ_FUNNEL_SECTION_KEY: Partial<Record<OnboardingStepId, string>> = {
  name: 'aboutYou',
  sex: 'aboutYou',
  birthDate: 'aboutYou',
  height: 'aboutYou',
  weight: 'aboutYou',
  goal: 'goal',
  level: 'experience',
  days: 'routine',
  duration: 'routine',
  place: 'routine',
  equipment: 'routine',
  muscleFocus: 'focus',
  healthIntegration: 'integration',
  specialConditions: 'health',
  lipedemaScreening: 'healthLipedema',
  dizzinessScreening: 'healthBalance',
  postSurgicalStatus: 'healthPostSurgical',
  postSurgicalRegion: 'healthPostSurgical',
  pregnancyWeeks: 'healthPregnancy',
  pregnancyCare: 'healthPregnancy',
  pregnancyWarningSigns: 'healthPregnancy',
  postpartumContext: 'healthPostpartum',
  postpartumSigns: 'healthPostpartum',
  postpartumReturnClearance: 'healthPostpartum',
  functionalSituations: 'healthMobility',
  medicalRestrictionDetails: 'healthMedicalRestriction',
  commitment: 'commitment',
};

/** Nutrition steps all share one kicker, so they are matched by prefix. */
export const AJ_FUNNEL_NUTRITION_SECTION_KEY = 'nutrition';

export function sectionKeyForStep(stepId: OnboardingStepId): string | null {
  if (stepId.startsWith('nutrition_')) return AJ_FUNNEL_NUTRITION_SECTION_KEY;
  return AJ_FUNNEL_SECTION_KEY[stepId] ?? null;
}

/* ── Reactions ───────────────────────────────────────────────────────────── */

/**
 * The steps after which AJ steps forward and says something about the answer.
 * Deliberately a short list: a reaction after every question would stop being
 * a reaction. Allergies are conditional on there being an allergy to react to
 * (see `shouldReactToStep`).
 */
export const AJ_REACTION_STEP_IDS: readonly OnboardingStepId[] = [
  'weight',
  'goal',
  'days',
  'specialConditions',
  'functionalSituations',
  'nutrition_excludedAllergens',
  'nutrition_varietyPreference',
  'commitment',
];

const REACTION_STEP_SET = new Set<string>(AJ_REACTION_STEP_IDS);

/**
 * Whether this step earns a reaction. `hasContent` lets a caller suppress the
 * ones that would otherwise react to an empty answer — "no allergies" and
 * "only Other/None" among the limitations have nothing to say back.
 */
export function shouldReactToStep(stepId: OnboardingStepId, hasContent = true): boolean {
  if (!REACTION_STEP_SET.has(stepId)) return false;
  return hasContent;
}
