import { PROGRESSION_V2_CONFIG, type ProgressionV2Config } from './config';
import type { ProgressionDecision, ProgressionSnapshotV2 } from './types';

function minimumActiveDaysForLevel(
  level: ProgressionSnapshotV2['level'],
  config: ProgressionV2Config,
): number {
  return level === 'BEGINNER' ? config.beginnerMinimumActiveDays : config.intermediateAdvancedMinimumActiveDays;
}

/**
 * Pure, deterministic core of the Progression Engine V2 (docs §4/§39).
 *
 * Same `snapshot` + `config` always produces the same `ProgressionDecision`.
 * No I/O, no `Date.now()`, no Firestore writes, no prescription/exercise
 * selection, no XP. The caller resolves the snapshot (active program,
 * history, active time, adherence, earned cycle count) before calling this;
 * applying a decision is a separate, later step outside this module
 * (docs §43/§44).
 */
export function evaluateProgressionV2(
  snapshot: ProgressionSnapshotV2,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): ProgressionDecision {
  if (snapshot.hasInProgressExecution) {
    return { type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' };
  }

  const { activeDays } = snapshot.activeTime;
  const { ratio, quality } = snapshot.adherence;
  const earnedThreshold = config.adherenceEarnedThresholdBp / 10000;
  const minimumActiveDays = minimumActiveDaysForLevel(snapshot.level, config);
  const earned = activeDays >= minimumActiveDays && ratio >= earnedThreshold;

  if (earned) {
    if (snapshot.level === 'BEGINNER') {
      return {
        type: 'LEVEL_PROMOTION_ELIGIBLE',
        from: 'BEGINNER',
        to: 'INTERMEDIATE',
        quality,
        activeDays,
        adherence: snapshot.adherence,
        reason: 'LEVEL_PROMOTION_READY',
        validSessionCount: snapshot.validSessionCount,
      };
    }
    if (snapshot.level === 'INTERMEDIATE') {
      const wouldBeEarnedCycleCount = snapshot.earnedIntermediateCycleCount + 1;
      if (wouldBeEarnedCycleCount >= config.intermediateCyclesForPromotion) {
        return {
          type: 'LEVEL_PROMOTION_ELIGIBLE',
          from: 'INTERMEDIATE',
          to: 'ADVANCED',
          quality,
          activeDays,
          adherence: snapshot.adherence,
          reason: 'LEVEL_PROMOTION_READY',
          validSessionCount: snapshot.validSessionCount,
        };
      }
      return {
        type: 'EVOLUTION_ELIGIBLE',
        level: 'INTERMEDIATE',
        quality,
        activeDays,
        adherence: snapshot.adherence,
        reason: 'EARNED_CYCLE_READY',
        validSessionCount: snapshot.validSessionCount,
      };
    }
    // ADVANCED: unbounded cycles, never a level promotion (docs §36/§52).
    return {
      type: 'EVOLUTION_ELIGIBLE',
      level: 'ADVANCED',
      quality,
      activeDays,
      adherence: snapshot.adherence,
      reason: 'EARNED_CYCLE_READY',
      validSessionCount: snapshot.validSessionCount,
    };
  }

  // Earned eligibility always takes precedence over Motivational Renewal
  // (docs §29/§54) — this branch is only reached when `earned` is false.
  const extensionThreshold = minimumActiveDays + config.motivationalRenewalExtensionDays;
  if (activeDays >= extensionThreshold && ratio < earnedThreshold) {
    return {
      type: 'MOTIVATIONAL_RENEWAL_AVAILABLE',
      level: snapshot.level,
      activeDays,
      adherence: snapshot.adherence,
      reason: 'MOTIVATIONAL_EXTENSION_REACHED',
      validSessionCount: snapshot.validSessionCount,
    };
  }

  if (activeDays < minimumActiveDays) {
    return {
      type: 'PROGRESS_CONTINUES',
      reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED',
      activeDays,
      adherence: snapshot.adherence,
      validSessionCount: snapshot.validSessionCount,
    };
  }
  return {
    type: 'PROGRESS_CONTINUES',
    reason: 'ADHERENCE_BELOW_THRESHOLD',
    activeDays,
    adherence: snapshot.adherence,
    validSessionCount: snapshot.validSessionCount,
  };
}
