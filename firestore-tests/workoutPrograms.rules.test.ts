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

function flexibleProgramDocument(programId = 'wpg_flexible') {
  return {
    ...phase2ProgramDocument(programId),
    requestedDays: 4,
    prescribedStructuredDays: 4,
    prescribedTrainingFrequency: 4,
    scheduleMode: 'flexible',
    availability: { days: 4, weekdays: [] },
    weeklySchedule: [],
  };
}

/**
 * `phase2ProgramDocument` predates `scheduleMode` and is deliberately kept as
 * the legacy fixture. This is the shape the CURRENT backend actually seals
 * (`generateCanonicalPlan` → `sealTargetProgram`, functions/src/workoutLifecycle/
 * authorizeMutation.ts): same calendar as phase 2, plus the explicit mode.
 */
function fixedProgramDocument(programId = 'wpg_fixedmode') {
  return { ...phase2ProgramDocument(programId), scheduleMode: 'fixed' };
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
  it.each(['T001', 'T090', 'T091', 'T102'])('accepts template ID %s for an admin', async (id) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID), userDocument(UID, 'admin'));
    });
    await assertSucceeds(setDoc(doc(dbFor(UID, true), 'workoutTemplates', id), {
      ...templateDocument(), id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it.each(['T000', 'T103', 'T999', 'T10', 'T0102', 'arbitrary'])('rejects template ID %s', async (id) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID), userDocument(UID, 'admin'));
    });
    await assertFails(setDoc(doc(dbFor(UID, true), 'workoutTemplates', id), {
      ...templateDocument(), id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('allows authenticated reads and denies normal-client writes/deletes', async () => {
    await assertSucceeds(getDoc(doc(dbFor(UID), 'workoutTemplates', 'T003')));
    await assertFails(setDoc(doc(dbFor(UID), 'workoutTemplates', 'T004'), templateDocument()));
    await assertFails(updateDoc(doc(dbFor(UID), 'workoutTemplates', 'T003'), { split: 'forged' }));
  });
});

describe('workoutPrograms', () => {
  it.each(['T090', 'T091', 'T102'])('accepts future template ID %s and schema 1.27.0', async (id) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', id), {
        ...v2TemplateDocument(), id, sourceVersion: '1.27.0',
      });
    });
    const programId = `wpg_future_${id}`;
    const program = fixedProgramDocument(programId);
    await assertSucceeds(createAndActivate(UID, programId, {
      ...program,
      templateId: id,
      templateSourceVersion: '1.27.0',
      versions: { ...program.versions, templateLibrary: '1.27.0' },
    }));
  });

  it('rejects T103 in a program even if a template document exists', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T103'), {
        ...v2TemplateDocument(), id: 'T103', sourceVersion: '1.27.0',
      });
    });
    const program = fixedProgramDocument('wpg_future_bad');
    await assertFails(createAndActivate(UID, 'wpg_future_bad', {
      ...program, templateId: 'T103', templateSourceVersion: '1.27.0',
      versions: { ...program.versions, templateLibrary: '1.27.0' },
    }));
  });

  it('accepts a valid flexible snapshot and rejects invalid mode-specific calendar shapes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), v2TemplateDocument());
    });
    await assertSucceeds(createAndActivate(UID, 'wpg_flexible', flexibleProgramDocument()));
    await assertFails(createAndActivate(UID, 'wpg_flexbad1', {
      ...flexibleProgramDocument('wpg_flexbad1'),
      availability: { days: 4, weekdays: ['MON', 'TUE', 'WED', 'FRI'] },
    }));
    await assertFails(createAndActivate(UID, 'wpg_fixedbad1', {
      ...phase2ProgramDocument('wpg_fixedbad1'),
      scheduleMode: 'fixed',
      availability: { days: 7, weekdays: [] },
      weeklySchedule: [],
    }));
  });

  // P0 regression lock (2026-09-18 incident). The ruleset that was live in
  // production did not list `scheduleMode` in `workoutProgramCommonValid`'s
  // `hasOnly`, while the deployed backend already sealed every new program
  // WITH that field via the Admin SDK (which bypasses Rules). Result: the
  // document appeared, and then the client's activation transaction — the
  // one that writes `workoutProgramState/active`, `programInstances`,
  // `trainingCycles` and `workoutLifecycleState/current` — was denied, so
  // every brand-new account was stuck on "Não foi possível preparar seu
  // treino" forever. Only the flexible variant was covered before; the
  // create+update paths for BOTH modes are locked here.
  it('accepts an explicit fixed snapshot', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), v2TemplateDocument());
    });
    await assertSucceeds(createAndActivate(UID, 'wpg_fixedmode', fixedProgramDocument()));
  });

  it('rejects an unknown scheduleMode value', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), v2TemplateDocument());
    });
    await assertFails(createAndActivate(UID, 'wpg_badmode', {
      ...fixedProgramDocument('wpg_badmode'), scheduleMode: 'sometimes',
    }));
  });

  // One program per test on purpose: the `workoutPrograms` update rule sits
  // close to the Rules engine's 1000-expression evaluation cap, and chaining
  // two activations (which repoints `active` while the previous document is
  // still `status: 'active'`, forcing both the active AND superseded branches
  // plus their `getAfter` lookups to evaluate) exceeds it. A real account
  // only ever activates one program per transaction, which is what these
  // reproduce — see the report note about the remaining headroom.
  async function sealAndActivate(programId: string, program: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'workoutTemplates', 'T003'), v2TemplateDocument());
      // Exactly what `sealTargetProgram` does: Admin SDK write, Rules bypassed.
      await setDoc(doc(database, 'users', UID, 'workoutPrograms', programId), {
        ...program, createdAt: Timestamp.now(), activatedAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    // `createAndActivate` takes its update branch because the document exists.
    return createAndActivate(UID, programId);
  }

  it('lets the client activate a backend-sealed FIXED scheduleMode document through the update path', async () => {
    await assertSucceeds(sealAndActivate('wpg_sealedfix', fixedProgramDocument('wpg_sealedfix')));
  });

  it('lets the client activate a backend-sealed FLEXIBLE scheduleMode document through the update path', async () => {
    await assertSucceeds(sealAndActivate('wpg_sealedflex', flexibleProgramDocument('wpg_sealedflex')));
  });

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

    // Phase 10E (docs/workout-lifecycle/v2/architecture/
    // 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §48): `workoutPrograms`
    // `create` required a grant (Phase 10D), but `update` — the path a
    // reactivation of a previously-sealed, content-addressed doc takes
    // (`transaction.update` in `saveAndActivateWorkoutProgram` when
    // `targetSnapshot.exists()`) — did not. A V2 owner could flip a stale,
    // superseded doc's `status` back to `active` and repoint
    // `workoutProgramState/active` at it with zero authorization. Historical
    // exploit shape; expected current behavior: DENY.
    it('denies reactivating a stale/superseded workoutPrograms doc via update with no grant (workoutPrograms update authority gap)', async () => {
      const programInstanceId = 'wpi_reactivate';
      const staleProgramId = 'wpg_stale_a';
      const activeProgramId = 'wpg_active_b';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', staleProgramId), {
          ...programDocument(staleProgramId), status: 'superseded',
        });
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', activeProgramId), {
          ...programDocument(activeProgramId), status: 'active',
        });
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutProgramState', 'active'), {
          programId: activeProgramId, programInstanceId, updatedAt: Timestamp.now(),
        });
      });
      const db = dbFor(UID);
      await assertFails(runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'users', UID, 'workoutPrograms', staleProgramId), {
          status: 'active', activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId: staleProgramId, programInstanceId, updatedAt: serverTimestamp(),
        });
      }));
      // Authoritative state must remain unchanged after the denied attack.
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const stale = await getDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', staleProgramId));
        expect(stale.data()?.status).toBe('superseded');
        const active = await getDoc(doc(context.firestore(), 'users', UID, 'workoutProgramState', 'active'));
        expect(active.data()?.programId).toBe(activeProgramId);
      });
    });

    it('allows a grant-backed reactivation of a previously-sealed content identity (legitimate idempotent convergence)', async () => {
      const programInstanceId = 'wpi_reactivate_ok';
      const targetProgramId = 'wpg_reactivate_ok';
      await seedV2LifecycleState(programInstanceId);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', targetProgramId), {
          ...programDocument(targetProgramId), status: 'superseded',
        });
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'RECOVER',
          targetContentIdentity: targetProgramId,
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      const db = dbFor(UID);
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'users', UID, 'workoutPrograms', targetProgramId), {
          status: 'active', activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId: targetProgramId, programInstanceId, updatedAt: serverTimestamp(),
        });
        transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
      }));
    });

    it('a genuinely legacy V1 account can still transition workoutPrograms status without a grant', async () => {
      // No seedV2LifecycleState call, and — matching every other legacy V1
      // fixture in this file — no `programInstanceId` on the state pointer
      // either, since `workoutLifecycleState/current` never exists to
      // resolve it against.
      const programId = 'wpg_v1status';
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId), {
          ...programDocument(programId), status: 'superseded',
        });
      });
      const db = dbFor(UID);
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'users', UID, 'workoutPrograms', programId), {
          status: 'active', activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
          programId, updatedAt: serverTimestamp(),
        });
      }));
    });
  });

  // Phase 10E (docs/workout-lifecycle/v2/architecture/
  // 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §49): the same
  // optional-field-omission shape as FS-RULES-BYPASS-01, found unfixed in
  // `scheduleState`/`scheduleEvents`. Traced NON_EXPLOITABLE for
  // progression/adherence (backend never reads SKIPPED/MISS_RESOLVED events,
  // and COMPLETED events are filtered by exact programInstanceId equality —
  // see 27_PHASE_10E_FINAL_STAGED_ROLLOUT_CLOSURE.md §6-9), but fixed
  // structurally regardless per this phase's explicit instruction.
  describe('scheduleState / scheduleEvents authority (Phase 10E)', () => {
    const programId = 'wpg_sched_fixture';
    const programInstanceId = 'wpi_sched_fixture';

    async function seedV2WithInstance() {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId), programDocument(programId));
        await setDoc(doc(context.firestore(), 'users', UID, 'programInstances', programInstanceId), {
          contentIdentity: programId,
        });
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleState', 'current'), {
          activeProgramInstanceId: programInstanceId,
        });
      });
    }

    it('denies a forged scheduleState advance via the programInstanceId-omission exploit (writes to the dead-for-V2 "current" doc-id)', async () => {
      await seedV2WithInstance();
      const db = dbFor(UID);
      await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleState', 'current'), {
        programId, nextSessionIndex: 3, cursorDate: '2026-09-10',
        lastCompletedAt: null, pendingMissDecision: null, updatedAt: serverTimestamp(),
      }));
    });

    it('denies a forged scheduleState update on the real programInstanceId doc-id with no grant (field cannot be omitted for V2)', async () => {
      await seedV2WithInstance();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId, 'scheduleState', programInstanceId), {
          programId, programInstanceId, nextSessionIndex: 0, cursorDate: '2026-09-01',
          lastCompletedAt: null, pendingMissDecision: null, updatedAt: Timestamp.now(),
        });
      });
      const db = dbFor(UID);
      // Real doc-id, but the field is present and correct here — this must
      // still be denied because there is no grant and the index actually
      // changes (not a same-position bookkeeping write).
      await assertFails(updateDoc(doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleState', programInstanceId), {
        programId, programInstanceId, nextSessionIndex: 5, cursorDate: '2026-09-10',
        lastCompletedAt: null, pendingMissDecision: null, updatedAt: serverTimestamp(),
      }));
    });

    it('allows a grant-backed scheduleState advance for a V2 account', async () => {
      await seedV2WithInstance();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId, 'scheduleState', programInstanceId), {
          programId, programInstanceId, nextSessionIndex: 0, cursorDate: '2026-09-01',
          lastCompletedAt: null, pendingMissDecision: null, updatedAt: Timestamp.now(),
        });
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'COMPLETE_SCHEDULE',
          sourceProgramInstanceId: programInstanceId, targetNextSessionIndex: 1, targetCursorDate: '2026-09-01',
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      const db = dbFor(UID);
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleState', programInstanceId), {
          programId, programInstanceId, nextSessionIndex: 1, cursorDate: '2026-09-01',
          lastCompletedAt: serverTimestamp(), pendingMissDecision: null, updatedAt: serverTimestamp(),
        });
        transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
      }));
    });

    it('a genuinely legacy V1 account can still advance scheduleState/current without a grant', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId), programDocument(programId));
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId, 'scheduleState', 'current'), {
          programId, nextSessionIndex: 0, cursorDate: '2026-09-01',
          lastCompletedAt: null, pendingMissDecision: null, updatedAt: Timestamp.now(),
        });
      });
      const db = dbFor(UID);
      await assertSucceeds(updateDoc(doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleState', 'current'), {
        programId, nextSessionIndex: 1, cursorDate: '2026-09-02',
        lastCompletedAt: serverTimestamp(), pendingMissDecision: null, updatedAt: serverTimestamp(),
      }));
    });

    it('denies forged COMPLETED/SKIPPED/MISS_RESOLVED scheduleEvents via the programInstanceId-omission exploit', async () => {
      await seedV2WithInstance();
      const db = dbFor(UID);
      for (const type of ['COMPLETED', 'SKIPPED', 'MISS_RESOLVED'] as const) {
        await assertFails(setDoc(
          doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleEvents', `forged_${type}`),
          { type, sessionIndex: 0, scheduledDate: '2026-09-05', occurredAt: serverTimestamp() },
        ));
      }
    });

    it('denies forged scheduleEvents even when programInstanceId is included but no grant exists', async () => {
      await seedV2WithInstance();
      const db = dbFor(UID);
      await assertFails(setDoc(
        doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleEvents', 'forged_with_id'),
        { type: 'COMPLETED', sessionIndex: 0, scheduledDate: '2026-09-05', occurredAt: serverTimestamp(), programInstanceId },
      ));
    });

    it('allows a grant-backed COMPLETED scheduleEvents write for a V2 account', async () => {
      await seedV2WithInstance();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
          uid: UID, schemaVersion: 1, operation: 'COMPLETE_SCHEDULE',
          sourceProgramInstanceId: programInstanceId, sessionIndex: 0, scheduledLocalDate: '2026-09-05',
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      });
      const db = dbFor(UID);
      // The grant must be consumed (deleted) in the same atomic write as the
      // event create — a bare `setDoc` never deletes it, so this has to be a
      // batch/transaction, matching every other grant-consuming test in this
      // file.
      await assertSucceeds(runTransaction(db, async (transaction) => {
        transaction.set(
          doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleEvents', 'legit_completed'),
          { type: 'COMPLETED', sessionIndex: 0, scheduledDate: '2026-09-05', occurredAt: serverTimestamp(), programInstanceId },
        );
        transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
      }));
    });

    it('a genuinely legacy V1 account can still write scheduleEvents without a grant', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', programId), programDocument(programId));
      });
      const db = dbFor(UID);
      await assertSucceeds(setDoc(
        doc(db, 'users', UID, 'workoutPrograms', programId, 'scheduleEvents', 'v1_completed'),
        { type: 'COMPLETED', sessionIndex: 0, scheduledDate: '2026-09-05', occurredAt: serverTimestamp() },
      ));
    });
  });
});
