/**
 * Progression Engine V2 domain constants (Fase 2 —
 * docs/workout-lifecycle/v2/progression/01_PROGRESSION_RULES.md,
 * 06_ADHERENCE.md, 08_MOTIVATIONAL_RENEWAL.md).
 *
 * A single source for every numeric threshold the evaluator uses. Nothing
 * here has a UI/copy meaning — it is deliberately invisible to the user.
 *
 * Two variants exist: `PROGRESSION_V2_CONFIG` (NORMAL/production, unchanged
 * since Fase 2) and `PROGRESSION_V2_CONFIG_QA_ACCELERATED` (dev-only manual
 * QA — docs/workout-lifecycle/v2/qa/MANUAL_ACCELERATED_LIFECYCLE_QA.md).
 * Only the *time-window* fields differ between them — adherence quality
 * bands, the 4-cycle promotion rule, the inactivity-pause threshold and the
 * partial-session credit floor are identical in both, by design: QA
 * compresses the calendar, never the rules. This file is synced verbatim
 * into `functions/` (scripts/syncPrescriptionEngineToFunctions.cjs) so the
 * backend's `authoritativeEarnedFact` reads the exact same constants as the
 * client instead of a hand-duplicated copy.
 */
export const PROGRESSION_V2_CONFIG = {
  /** Beginner → Intermediate earliest gate (docs progression/02). */
  beginnerMinimumActiveDays: 28,
  /** Intermediate/Advanced cycle earliest gate (docs progression/03-05). */
  intermediateAdvancedMinimumActiveDays: 85,
  /** ≥70% adherence is required for any earned transition (docs progression/06). */
  adherenceEarnedThresholdBp: 7000,
  /** ≥85% adherence classifies the transition as HIGH quality (docs progression/06). */
  adherenceHighThresholdBp: 8500,
  /** Additional active days beyond the normal window before a low-adherence user is offered a Motivational Renewal (docs progression/08). */
  motivationalRenewalExtensionDays: 30,
  /** Earned Intermediate cycles required before Intermediate → Advanced (docs progression/04). */
  intermediateCyclesForPromotion: 4,
  /**
   * Consecutive prescribed training opportunities missed before Active Time
   * freezes (docs progression/07 leaves the exact definition to
   * implementation — see ADR-007). Expressed in *prescribed opportunities*,
   * not calendar days, so it scales with the user's own frequency instead of
   * penalizing low-frequency schedules.
   */
  inactivityMissedOpportunityThreshold: 3,
  /** Minimum share of a PARTIALLY_COMPLETED session's prescribed sets that must be COMPLETED for it to count toward progression (docs progression/06). */
  partialSessionMinSetCompletionPercent: 70,
} as const;

/**
 * Dev-only manual-QA variant. Values were chosen (not guessed) from the
 * active-time/prescribed-opportunity model in `activeTime.ts` /
 * `prescribedOpportunities.ts`: opportunities are `trainingDays ∩
 * countedActiveDates`, so a QA tester using a higher weekly frequency (e.g.
 * 5-6x/week) accumulates enough opportunities within these short windows to
 * still land cleanly on either side of the (unchanged) 70%/85% boundaries —
 * see docs/workout-lifecycle/v2/qa/MANUAL_ACCELERATED_LIFECYCLE_QA.md for
 * the worked examples. Never granted by the client — see
 * src/workoutLifecycle/qaPolicy.ts and firestore.rules `isAdmin()`-style
 * `workoutLifecycleQaAccelerated()` guard.
 */
export const PROGRESSION_V2_CONFIG_QA_ACCELERATED = {
  beginnerMinimumActiveDays: 7,
  intermediateAdvancedMinimumActiveDays: 10,
  adherenceEarnedThresholdBp: PROGRESSION_V2_CONFIG.adherenceEarnedThresholdBp,
  adherenceHighThresholdBp: PROGRESSION_V2_CONFIG.adherenceHighThresholdBp,
  motivationalRenewalExtensionDays: 5,
  intermediateCyclesForPromotion: PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion,
  inactivityMissedOpportunityThreshold: PROGRESSION_V2_CONFIG.inactivityMissedOpportunityThreshold,
  partialSessionMinSetCompletionPercent: PROGRESSION_V2_CONFIG.partialSessionMinSetCompletionPercent,
} as const;

export type ProgressionV2Config = {
  readonly [Key in keyof typeof PROGRESSION_V2_CONFIG]: number;
};

/** NORMAL: real production timelines. QA_ACCELERATED: dev-only compressed timelines — never client-selectable, see qaPolicy.ts. */
export type ProgressionPolicyMode = 'NORMAL' | 'QA_ACCELERATED';

export function resolveProgressionV2Config(mode: ProgressionPolicyMode): ProgressionV2Config {
  return mode === 'QA_ACCELERATED' ? PROGRESSION_V2_CONFIG_QA_ACCELERATED : PROGRESSION_V2_CONFIG;
}
