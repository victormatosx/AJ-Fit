import type { QuestionnaireAnswers, SafetyDecision, SafetyReasonCode, SafetyStatus } from './types';

const STATUS_WEIGHT: Record<SafetyStatus, number> = {
  CLEAR: 0,
  ADAPTED: 1,
  REQUIRES_CLEARANCE: 2,
  BLOCKED: 3,
};

type MutableDecision = {
  status: SafetyStatus;
  reasons: SafetyReasonCode[];
  requiredModifierIds: string[];
  protectedConstraints: string[];
};

function add(
  decision: MutableDecision,
  status: SafetyStatus,
  reason: SafetyReasonCode,
  modifierId?: string,
  constraints: string[] = [],
) {
  if (STATUS_WEIGHT[status] > STATUS_WEIGHT[decision.status]) decision.status = status;
  decision.reasons.push(reason);
  if (modifierId) decision.requiredModifierIds.push(modifierId);
  decision.protectedConstraints.push(...constraints);
}

export function evaluateSafety(answers: QuestionnaireAnswers): SafetyDecision {
  const decision: MutableDecision = {
    status: 'CLEAR',
    reasons: [],
    requiredModifierIds: [],
    protectedConstraints: [],
  };
  const has = (condition: QuestionnaireAnswers['specialConditions'][number]) =>
    answers.specialConditions.includes(condition);

  if (has('medical_restriction')) {
    const restriction = answers.medicalRestrictionScreening?.professionalExerciseRestriction;
    if (restriction === 'yes' || restriction === 'unsure') {
      add(decision, 'REQUIRES_CLEARANCE', 'MEDICAL_RESTRICTION_UNREPRESENTABLE');
    }
  }

  if (has('pregnancy')) {
    const screening = answers.pregnancyScreening;
    if (screening?.warningSigns.some((sign) => sign !== 'none')) {
      add(decision, 'BLOCKED', 'PREGNANCY_RED_FLAG');
    } else if (screening?.exerciseRestriction === 'yes') {
      add(decision, 'REQUIRES_CLEARANCE', 'PREGNANCY_RESTRICTION');
    } else if (screening?.complication === 'yes' || screening?.complication === 'unsure') {
      add(decision, 'REQUIRES_CLEARANCE', 'PREGNANCY_COMPLICATION');
    } else {
      add(decision, 'ADAPTED', 'PREGNANCY_POPULATION', 'population:pregnancy');
    }
  }

  if (has('postpartum')) {
    const screening = answers.postpartumScreening;
    if (screening?.returnClearance === 'not_yet' || screening?.returnClearance === 'with_restrictions') {
      add(decision, 'REQUIRES_CLEARANCE', 'POSTPARTUM_NOT_CLEARED');
    } else if (screening?.signs.some((sign) => sign !== 'none')) {
      add(decision, 'REQUIRES_CLEARANCE', 'POSTPARTUM_SYMPTOMS');
    } else {
      add(decision, 'ADAPTED', 'POSTPARTUM_POPULATION', 'population:postpartum');
    }
  }

  if (has('functional_limitation')) {
    const situations = answers.functionalScreening?.situations.filter((value) => value !== 'none') ?? [];
    if (situations.length > 0) {
      const balanceRisk = situations.some((value) =>
        ['support_needed', 'balance_problems', 'recent_fall'].includes(value),
      );
      add(
        decision,
        'ADAPTED',
        balanceRisk ? 'FUNCTIONAL_BALANCE_OR_FALL_RISK' : 'FUNCTIONAL_CAPACITY_LIMITATION',
        'population:functional_capacity',
        balanceRisk ? ['balance_support_required'] : [],
      );
    }
  }

  if (has('post_surgical')) {
    const screening = answers.postSurgicalScreening;
    if (screening?.recoveryStatus === 'unsure') {
      add(decision, 'REQUIRES_CLEARANCE', 'POST_SURGICAL_STATUS_UNSURE');
    } else if (
      screening?.returnClearance === 'cleared_with_restrictions'
      || screening?.returnClearance === 'not_yet'
      || screening?.returnClearance === 'unsure'
    ) {
      add(decision, 'REQUIRES_CLEARANCE', 'POST_SURGICAL_RESTRICTION');
    } else if (
      screening?.recoveryStatus === 'in_progress'
      && screening.returnClearance === 'cleared_no_restrictions'
    ) {
      add(decision, 'ADAPTED', 'POST_SURGICAL_IN_PROGRESS_ADAPTED', 'safety:post_surgical_conservative');
    }
  }

  if (has('dizziness_or_vertigo')) {
    const screening = answers.dizzinessScreening;
    if (
      screening?.symptomFrequency === 'frequent'
      || screening?.symptomFrequency === 'current_or_recent'
      || screening?.affectsBalance === 'yes'
      || screening?.affectsBalance === 'unknown'
    ) {
      add(decision, 'REQUIRES_CLEARANCE', 'DIZZINESS_RELEVANT');
    } else if (screening?.symptomFrequency === 'occasional' && screening.affectsBalance === 'no') {
      add(
        decision,
        'ADAPTED',
        'DIZZINESS_CONTROLLED',
        'safety:dizziness_controlled',
        ['stable_positioning'],
      );
    }
  }

  if (has('musculoskeletal_limitation')) {
    add(
      decision,
      'ADAPTED',
      'MUSCULOSKELETAL_ADAPTATION_REQUIRED',
      'safety:musculoskeletal_adaptation',
      answers.limits.filter((value) => value !== 'none').map((value) => `limitation:${value}`),
    );
  }

  if (has('lipedema')) {
    const screening = answers.lipedemaScreening;
    if (screening?.professionalGuidance === 'yes' || screening?.professionalGuidance === 'unsure') {
      add(decision, 'REQUIRES_CLEARANCE', 'LIPEDEMA_GUIDANCE_UNREPRESENTABLE');
    } else if (screening?.symptomImpact === 'interferes_with_exercises') {
      add(decision, 'ADAPTED', 'LIPEDEMA_INTERFERES', 'safety:lipedema_conservative');
    } else if (screening?.symptomImpact === 'mild_or_occasional') {
      add(decision, 'ADAPTED', 'LIPEDEMA_MILD', 'safety:lipedema_mild');
    }
  }

  return {
    status: decision.status,
    reasons: [...new Set(decision.reasons)],
    requiredModifierIds: [...new Set(decision.requiredModifierIds)],
    protectedConstraints: [...new Set(decision.protectedConstraints)],
  };
}
