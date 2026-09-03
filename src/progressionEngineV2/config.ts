/**
 * Progression Engine V2 domain constants (Fase 2 —
 * docs/workout-lifecycle/v2/progression/01_PROGRESSION_RULES.md,
 * 06_ADHERENCE.md, 08_MOTIVATIONAL_RENEWAL.md).
 *
 * A single source for every numeric threshold the evaluator uses. Nothing
 * here has a UI/copy meaning — it is deliberately invisible to the user.
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

export type ProgressionV2Config = {
  readonly [Key in keyof typeof PROGRESSION_V2_CONFIG]: number;
};
