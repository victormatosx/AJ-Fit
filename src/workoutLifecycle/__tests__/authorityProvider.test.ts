import { afterEach, describe, expect, it } from 'vitest';

import type { FinalWorkoutPlan } from '../../workoutPrescription/types';
import {
  authorizeWorkoutLifecycleMutation,
  requireWorkoutLifecycleCanonical,
  resetWorkoutLifecycleAuthorityAuthorizerForTests,
  setWorkoutLifecycleAuthorityAuthorizerForTests,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../authorityProvider';

const plan = {
  planId: 'plan_candidate',
  templateId: 'T003',
  sessions: [{ name: 'Candidate A', exercises: [] }],
} as unknown as FinalWorkoutPlan;

describe('workout lifecycle canonical authority response', () => {
  afterEach(() => resetWorkoutLifecycleAuthorityAuthorizerForTests());

  it('detaches canonical B from a post-response mutation of candidate A', async () => {
    setWorkoutLifecycleAuthorityAuthorizerForTests(async () => ({
      grantId: WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
      expiresAtMs: Date.now() + 60_000,
      canonical: {
        targetPlan: plan,
        targetContentIdentity: 'wpg_backend',
        targetPrescriptionIdentity: 'plan_candidate',
        targetTemplateVersion: 1,
        targetTemplateSourceVersion: 'catalog-v1',
        targetTemplateContentHash: 'hash-v1',
      },
    }));

    const result = await authorizeWorkoutLifecycleMutation({ operation: 'ADAPT' });
    plan.planId = 'plan_mutated_after_response';
    plan.sessions[0].name = 'Mutated A';

    const canonical = requireWorkoutLifecycleCanonical(result, 'ADAPT');
    expect(canonical.targetPlan.planId).toBe('plan_candidate');
    expect(canonical.targetPlan.sessions[0].name).toBe('Candidate A');
  });

  it('fails closed when an operation that generates content omits canonical', async () => {
    setWorkoutLifecycleAuthorityAuthorizerForTests(async () => ({
      grantId: WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
      expiresAtMs: Date.now() + 60_000,
    }));

    const result = await authorizeWorkoutLifecycleMutation({ operation: 'PREPARE' });
    expect(() => requireWorkoutLifecycleCanonical(result, 'PREPARE'))
      .toThrow('WORKOUT_LIFECYCLE_CANONICAL_RESPONSE_MISSING:PREPARE');
  });
});
