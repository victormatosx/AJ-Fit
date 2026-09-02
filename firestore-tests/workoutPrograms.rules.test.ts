import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const LIMITATION_DATASET_VERSION = 'phase3-limitation-profiles-v2';
const LIMITATION_DATASET_HASH = 'a'.repeat(64);
let testEnv: RulesTestEnvironment;

function dbFor(uid: string, admin = false) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@example.com`,
    email_verified: true,
    ...(admin ? { admin: true } : {}),
  }).firestore();
}

function userDocument(uid: string, role: 'user' | 'admin' = 'user') {
  return {
    profile: { name: uid, email: `${uid}@example.com` },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: { role, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
  };
}

function templateDocument() {
  return {
    id: 'T003', version: 1, sourceVersion: '1.3.0', libraryId: 'canonical',
    contentHash: 'a'.repeat(64), status: 'active',
    profile: { sex: 'male', environment: 'gym', primaryGoal: 'hypertrophy_body_composition', daysPerWeek: 4 },
    split: 'upper/lower', rationale: 'fixture',
    sessions: [{ name: 'A', type: 'strength', exercises: [{ exerciseId: 'squat', sets: 3, reps: '8-12' }] }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  };
}

function programDocument(programId = 'wpg_12345678') {
  return {
    programId, planId: 'wp_12345678', prescriptionId: 'wp_12345678', templateId: 'T003', templateVersion: 1,
    templateSourceVersion: '1.3.0', templateContentHash: 'a'.repeat(64),
    questionnaireId: 'q1', questionnaireVersion: 1, status: 'active', source: 'onboarding',
    requestedDays: 4, prescribedStructuredDays: 4, population: 'conventional', environment: 'gym',
    goalFamily: 'hypertrophy_body_composition', split: 'upper/lower',
    limitationDatasetVersion: LIMITATION_DATASET_VERSION,
    limitationDatasetHash: LIMITATION_DATASET_HASH,
    sessions: [{ name: 'A', type: 'strength', exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 3, reps: '8-12' }] }],
    versions: { templateLibrary: '1.3.0', selectionEngine: '1.0.0', safetyRules: '1.0.0', modifierRules: '2.0.0', compositionEngine: '2.0.0', limitationResolver: '1.0.0' },
    trace: { selectionReasons: [], safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] }, appliedModifiers: [], unresolvedModifiers: [], conflicts: [], substitutions: [], limitationResolverVersion: 1, limitationDecisions: [] as Array<Record<string, unknown>>, compositionDecisions: [], validationCodes: [] },
    createdAt: serverTimestamp(), activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}

function v2TemplateDocument() {
  return { ...templateDocument(), version: 2, sourceVersion: '2.0.0', libraryId: 'reformed-v2' };
}

function v2ProgramDocument(programId = 'wpg_v2000000') {
  return {
    ...programDocument(programId),
    templateVersion: 2,
    templateSourceVersion: '2.0.0',
    versions: {
      ...programDocument(programId).versions,
      templateLibrary: '2.0.0',
      compositionEngine: '2.1.0',
    },
  };
}

function phase2ProgramDocument(programId = 'wpg_phase200') {
  return {
    ...v2ProgramDocument(programId),
    requestedDays: 7,
    prescribedStructuredDays: 4,
    prescribedTrainingFrequency: 4,
    availability: { days: 7, weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] },
    weeklySchedule: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((weekday, index) =>
      index < 4 ? { weekday, state: 'TRAINING', sessionIndex: 0 } : { weekday, state: 'REST' }),
    versions: { ...v2ProgramDocument(programId).versions, selectionEngine: '2.0.0' },
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => testEnv.cleanup());
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID), userDocument(UID));
    await setDoc(doc(context.firestore(), 'users', OTHER_UID), userDocument(OTHER_UID));
    await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), templateDocument());
    await setDoc(doc(context.firestore(), 'limitationDatasetState', 'active'), {
      datasetVersion: LIMITATION_DATASET_VERSION,
      limitationDatasetHash: LIMITATION_DATASET_HASH,
    });
    await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
      answers: { specialConditions: ['none'] }, version: 1, createdAt: Timestamp.now(),
    });
    await setDoc(doc(context.firestore(), 'users', OTHER_UID, 'questionnaires', 'q1'), {
      answers: { specialConditions: ['none'] }, version: 1, createdAt: Timestamp.now(),
    });
  });
});

async function createAndActivate(
  uid = UID,
  programId = 'wpg_12345678',
  program: Record<string, unknown> = programDocument(programId),
) {
  const db = dbFor(uid);
  await runTransaction(db, async (transaction) => {
    const targetRef = doc(db, 'users', uid, 'workoutPrograms', programId);
    const target = await transaction.get(targetRef);
    if (target.exists()) {
      transaction.update(targetRef, {
        status: 'active', activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    } else {
      transaction.set(targetRef, program);
    }
    transaction.set(doc(db, 'users', uid, 'workoutProgramState', 'active'), {
      programId,
      updatedAt: serverTimestamp(),
    });
  });
}

describe('workoutTemplates', () => {
  it('allows authenticated reads and denies normal-client writes/deletes', async () => {
    await assertSucceeds(getDoc(doc(dbFor(UID), 'workoutTemplates', 'T003')));
    await assertFails(setDoc(doc(dbFor(UID), 'workoutTemplates', 'T004'), templateDocument()));
    await assertFails(updateDoc(doc(dbFor(UID), 'workoutTemplates', 'T003'), { split: 'forged' }));
  });
});

describe('workoutPrograms', () => {
  it('atomically creates the snapshot and pointer, and repeated activation stays one document', async () => {
    await assertSucceeds(createAndActivate());
    await assertSucceeds(createAndActivate());
    const state = await getDoc(doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'active'));
    expect(state.data()?.programId).toBe('wpg_12345678');
  });

  it('accepts a v2 program against the active v2 template', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), v2TemplateDocument());
    });
    await assertSucceeds(createAndActivate(UID, 'wpg_v2000000', v2ProgramDocument()));
  });

  it('accepts a Phase 2 availability=7 program with prescribed frequency 4 and rejects frequency 7', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), v2TemplateDocument());
    });
    await assertSucceeds(createAndActivate(UID, 'wpg_phase200', phase2ProgramDocument()));
    await assertFails(createAndActivate(UID, 'wpg_phasebad', {
      ...phase2ProgramDocument('wpg_phasebad'),
      prescribedStructuredDays: 7,
      prescribedTrainingFrequency: 7,
    }));
  });

  it('can supersede an existing v1.3 snapshot after its template document is upgraded to v2', async () => {
    await assertSucceeds(createAndActivate());
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), v2TemplateDocument());
    });
    const db = dbFor(UID);
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(doc(db, 'users', UID, 'workoutPrograms', 'wpg_12345678'), {
        status: 'superseded',
        updatedAt: serverTimestamp(),
      });
      transaction.set(doc(db, 'users', UID, 'workoutPrograms', 'wpg_v2000000'), v2ProgramDocument());
      transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
        programId: 'wpg_v2000000',
        updatedAt: serverTimestamp(),
      });
    }));
  });

  it('denies a program without the matching parent-pointer transaction', async () => {
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'workoutPrograms', 'wpg_12345678'), programDocument()));
  });

  it('accepts a legacy program without identity, but rejects partial or non-active identity', async () => {
    const legacy = programDocument('wpg_legacy1') as Record<string, unknown>;
    delete legacy.limitationDatasetVersion;
    delete legacy.limitationDatasetHash;
    await assertSucceeds(createAndActivate(UID, 'wpg_legacy1', legacy as ReturnType<typeof programDocument>));

    const missing = programDocument() as Record<string, unknown>;
    delete missing.limitationDatasetHash;
    await assertFails(createAndActivate(UID, 'wpg_missing1', { ...missing, programId: 'wpg_missing1' } as ReturnType<typeof programDocument>));
    await assertFails(createAndActivate(UID, 'wpg_mismatch', {
      ...programDocument('wpg_mismatch'),
      limitationDatasetHash: 'b'.repeat(64),
    }));
  });

  it('isolates users and freezes prescription content', async () => {
    await assertSucceeds(createAndActivate());
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', 'wpg_12345678')));
    await assertFails(updateDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', 'wpg_12345678'), { status: 'superseded' }));
    await assertFails(updateDoc(doc(dbFor(UID), 'users', UID, 'workoutPrograms', 'wpg_12345678'), { split: 'changed' }));
  });

  it('rejects blocked/unresolved safety snapshots', async () => {
    const blocked = programDocument();
    blocked.trace.safety.status = 'BLOCKED';
    const db = dbFor(UID);
    await assertFails(runTransaction(db, async (transaction) => {
      transaction.set(doc(db, 'users', UID, 'workoutPrograms', blocked.programId), blocked);
      transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
        programId: blocked.programId,
        updatedAt: serverTimestamp(),
      });
    }));
  });

  it('accepts a resolved musculoskeletal snapshot with versioned decision evidence', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] },
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    const resolved = programDocument();
    resolved.trace.safety.status = 'ADAPTED';
    resolved.trace.limitationDecisions = [{
      sessionIndex: 0,
      originalExerciseId: 'squat',
      finalExerciseId: 'chair-squat',
      regionsEvaluated: ['knee'],
      resolution: 'adapted',
      reasonRegions: ['knee'],
      protocolVersion: 'musculoskeletal-v1',
      reviewBasis: 'product_policy',
    }];
    await assertSucceeds(createAndActivate(UID, resolved.programId, resolved));
  });

  it('fails closed when limitation resolution evidence is absent or unversioned', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] },
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    const unresolved = programDocument();
    unresolved.trace.limitationDecisions = [];
    await assertFails(createAndActivate(UID, unresolved.programId, unresolved));
  });

  it('rejects an unmapped musculoskeletal region even with forged trace evidence', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['musculoskeletal_limitation'], limits: ['other'] },
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    const forged = programDocument();
    forged.trace.limitationDecisions = [{}];
    await assertFails(createAndActivate(UID, forged.programId, forged));
  });

  it('fails closed for the legacy limits-only questionnaire shape', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { limits: ['knee'] }, version: 1, createdAt: Timestamp.now(),
      });
    });
    await assertFails(createAndActivate());
  });

  // Phase 10 (docs/workout-lifecycle/v2/decisions/
  // ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md) — the exact exploit that
  // motivated this phase: a V2 (lifecycle-managed) plan is otherwise
  // structurally valid (passes every check above, including an arbitrary
  // 1,000,000-set exercise the earlier checks never bounded) but was never
  // validated by `assertPlanSafe`/sealed by the backend. It must be denied
  // purely because no matching one-time grant exists — not because of any
  // content bound expressible in Rules.
  describe('V2 prescription authority (backend grant required)', () => {
    async function seedV2LifecycleState(programInstanceId: string) {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleState', 'current'), {
          activeProgramInstanceId: programInstanceId,
        });
      });
    }

    function arbitraryAttackerPlan(programId: string) {
      return {
        ...programDocument(programId),
        sessions: [{
          name: 'A', type: 'strength',
          exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 1_000_000, reps: '8-12' }],
        }],
      };
    }

    async function attemptV2Write(programId: string, programInstanceId: string, plan: Record<string, unknown>) {
      const db = dbFor(UID);
      return runTransaction(db, async (transaction) => {
        transaction.set(doc(db, 'users', UID, 'workoutPrograms', programId), plan);
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId, programInstanceId, updatedAt: serverTimestamp(),
        });
      });
    }

    it('denies an arbitrary V2 targetPlan sealed with no backend grant at all', async () => {
      const programId = 'wpg_v2attack1';
      const programInstanceId = 'wpi_attack1';
      await seedV2LifecycleState(programInstanceId);
      await assertFails(attemptV2Write(programId, programInstanceId, arbitraryAttackerPlan(programId)));
    });

    // Phase 10D closure of P0-2 (docs/workout-lifecycle/v2/architecture/
    // 22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md Finding
    // FS-RULES-BYPASS-01): the grant requirement above used to be gated on
    // whether `workoutProgramState/active` happened to carry a
    // `programInstanceId` field — a field the client chooses whether to
    // send on this exact write, not a backend-controlled fact. Omitting it
    // used to skip the grant check entirely for ANY V2 user, not just
    // genuine pre-V2 accounts. It is now gated on
    // `existsAfter(workoutLifecycleState/current)`, which can only ever be
    // created under a real grant and can never be deleted — omitting
    // `programInstanceId` on this write must no longer have any effect on
    // whether a grant is required.
    it('denies the exact programInstanceId-omission exploit: a V2 user cannot skip the grant by omitting the field', async () => {
      const programId = 'wpg_v2attack_omit';
      const programInstanceId = 'wpi_attack_omit';
      await seedV2LifecycleState(programInstanceId);
      const db = dbFor(UID);
      await assertFails(runTransaction(db, async (transaction) => {
        transaction.set(doc(db, 'users', UID, 'workoutPrograms', programId), arbitraryAttackerPlan(programId));
        // Deliberately omit `programInstanceId` here — this is the exact
        // exploit shape: same attacker plan, same lack of any grant, but
        // now via the field-omission path instead of the no-grant-at-all
        // path exercised above.
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId, updatedAt: serverTimestamp(),
        });
      }));
    });

    it('a genuinely legacy V1 account (no workoutLifecycleState/current ever) may still omit programInstanceId', async () => {
      // No seedV2LifecycleState call — this account has never had V2
      // lifecycle state, matching the real legacy-compatibility case this
      // escape hatch exists for.
      const programId = 'wpg_v1legacy';
      const db = dbFor(UID);
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.set(doc(db, 'users', UID, 'workoutPrograms', programId), programDocument(programId));
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId, updatedAt: serverTimestamp(),
        });
      }));
    });

    it('denies the same V2 write when a grant exists for a different contentIdentity or operation', async () => {
      const programId = 'wpg_v2attack2';
      const programInstanceId = 'wpi_attack2';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'ADAPT',
          targetContentIdentity: 'wpg_some_other_identity',
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      await assertFails(attemptV2Write(programId, programInstanceId, arbitraryAttackerPlan(programId)));

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'DEFER', // never installs prescription content
          targetContentIdentity: programId,
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      await assertFails(attemptV2Write(programId, programInstanceId, arbitraryAttackerPlan(programId)));
    });

    it('denies the grant from a different user (cross-user grant cannot authorize this write)', async () => {
      const programId = 'wpg_v2attack3';
      const programInstanceId = 'wpi_attack3';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: OTHER_UID, schemaVersion: 1, operation: 'ADAPT',
          targetContentIdentity: programId,
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      await assertFails(attemptV2Write(programId, programInstanceId, arbitraryAttackerPlan(programId)));
    });

    it('denies an expired grant even when every other field matches', async () => {
      const programId = 'wpg_v2attack4';
      const programInstanceId = 'wpi_attack4';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'ADAPT',
          targetContentIdentity: programId,
          expiresAt: Timestamp.fromMillis(Date.now() - 1_000),
        });
      });
      await assertFails(attemptV2Write(programId, programInstanceId, arbitraryAttackerPlan(programId)));
    });

    it('allows the write once a valid, matching, same-user grant for the correct identity is consumed', async () => {
      const programId = 'wpg_v2ok';
      const programInstanceId = 'wpi_ok';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'ADAPT',
          targetContentIdentity: programId,
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      const db = dbFor(UID);
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.set(doc(db, 'users', UID, 'workoutPrograms', programId), programDocument(programId));
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId, programInstanceId, updatedAt: serverTimestamp(),
        });
        transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
      }));
    });

    it('rejects a same-user, correct-identity grant that is not deleted in the same transaction (replay guard)', async () => {
      const programId = 'wpg_v2replay';
      const programInstanceId = 'wpi_replay';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'ADAPT',
          targetContentIdentity: programId,
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      const db = dbFor(UID);
      // Legitimate consume-and-delete, then attempt to reuse the same
      // (already-consumed, now-nonexistent) grant for a second write.
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.set(doc(db, 'users', UID, 'workoutPrograms', programId), programDocument(programId));
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId, programInstanceId, updatedAt: serverTimestamp(),
        });
        transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
      }));
      await assertFails(attemptV2Write('wpg_v2replay2', programInstanceId, programDocument('wpg_v2replay2')));
    });
  });
});
