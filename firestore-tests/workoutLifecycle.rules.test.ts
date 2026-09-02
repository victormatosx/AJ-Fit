import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
let testEnv: RulesTestEnvironment;

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
}

function userDocument(uid: string) {
  return {
    profile: { name: uid, email: `${uid}@example.com` },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
  };
}

function prescriptionInputSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: 'pis_test', schemaVersion: 1, source: 'QUESTIONNAIRE_BASELINE',
    inputs: {
      sex: 'm', goal: 'gain_muscle', level: 'beginner', limits: [], duration: '45', days: 4,
      trainingDays: ['MON', 'TUE', 'THU', 'FRI'], place: 'gym', primaryPlace: null,
      equipment: [], style: [], muscleFocus: [], specialConditions: ['none'],
      pregnancyScreening: null, postpartumScreening: null, functionalScreening: null,
      lipedemaScreening: null, dizzinessScreening: null, postSurgicalScreening: null,
      medicalRestrictionScreening: null,
    },
    ...overrides,
  };
}

async function createLifecycle(uid = UID) {
  const db = dbFor(uid);
  await seedAuthorityGrant(uid, {
    operation: 'MIGRATE',
    targetProgramInstanceId: 'wpi_initial', targetCycleId: 'cyc_initial',
    targetContentIdentity: 'wpg_content', targetPrescriptionIdentity: 'wp_content',
    targetPrescriptionInputSnapshot: prescriptionInputSnapshot(),
  });
  await runTransaction(db, async (transaction) => {
    const now = serverTimestamp();
    transaction.set(doc(db, 'users', uid, 'programInstances', 'wpi_initial'), {
      programInstanceId: 'wpi_initial', cycleId: 'cyc_initial', contentIdentity: 'wpg_content',
      prescriptionIdentity: 'wp_content', questionnaireId: 'q1',
      prescriptionInputSnapshot: prescriptionInputSnapshot(), activatedAt: now,
      supersededAt: null, previousProgramInstanceId: null, activationReason: 'V1_MIGRATION_BASELINE',
      schemaVersion: 2, createdAt: now, updatedAt: now,
    });
    transaction.set(doc(db, 'users', uid, 'trainingCycles', 'cyc_initial'), {
      cycleId: 'cyc_initial', level: 'BEGINNER', cycleNumber: 1, status: 'ACTIVE',
      origin: 'V1_MIGRATION_BASELINE', programInstanceId: 'wpi_initial',
      previousProgramInstanceId: null, startedAt: now, eligibleAt: null, completedAt: null,
      completionReason: null,
      progressionReason: 'V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED', schemaVersion: 2,
      createdAt: now, updatedAt: now,
    });
    transaction.set(doc(db, 'users', uid, 'workoutLifecycleState', 'current'), {
      startingLevel: 'BEGINNER', currentTrainingLevel: 'BEGINNER', currentCycleId: 'cyc_initial',
      currentCycleNumber: 1, activeProgramInstanceId: 'wpi_initial',
      activeContentIdentity: 'wpg_content', activePrescriptionIdentity: 'wp_content',
      initializationOrigin: 'V1_MIGRATION_BASELINE', historyCompleteFrom: now,
      schemaVersion: 2, createdAt: now, updatedAt: now,
    });
    transaction.delete(doc(db, 'users', uid, 'workoutLifecycleAuthorityGrants', 'current'));
  });
}

async function seedAuthorityGrant(uid: string, fields: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid, 'workoutLifecycleAuthorityGrants', 'current'), {
      uid, schemaVersion: 1, issuedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      targetTrainingLevel: 'BEGINNER', targetCycleNumber: 1,
      ...fields,
    });
  });
}

async function createLifecycleEvent(
  eventId: string,
  idempotencyKey: string,
  type = 'PROGRAM_STARTED',
) {
  await seedAuthorityGrant(UID, { operation: 'RECOVER', eventId, eventType: type, idempotencyKey });
  const db = dbFor(UID);
  await runTransaction(db, async (transaction) => {
    transaction.set(doc(db, 'users', UID, 'workoutLifecycleEvents', eventId), {
      eventId, type, occurredAt: serverTimestamp(), cycleId: 'cyc_initial',
      programInstanceId: 'wpi_initial', idempotencyKey,
      payload: { activationReason: 'INITIAL_PROGRAM' }, schemaVersion: 2,
    });
    transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
  });
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
    for (const uid of [UID, OTHER_UID]) {
      await setDoc(doc(context.firestore(), 'users', uid), userDocument(uid));
      await setDoc(doc(context.firestore(), 'users', uid, 'questionnaires', 'q1'), {
        answers: { level: 'beginner' }, version: 1, createdAt: Timestamp.now(),
      });
      await setDoc(doc(context.firestore(), 'users', uid, 'workoutPrograms', 'wpg_content'), {
        programId: 'wpg_content', prescriptionId: 'wp_content', status: 'active',
      });
    }
  });
});

describe('Workout Lifecycle V2 rules', () => {
  it('allows an owner to create the structurally linked baseline atomically and read it', async () => {
    await assertSucceeds(createLifecycle());
    const snapshot = await getDoc(doc(dbFor(UID), 'users', UID, 'workoutLifecycleState', 'current'));
    expect(snapshot.data()?.startingLevel).toBe('BEGINNER');
  });

  it('allows state-pointer recovery to preserve a historical boundary but rejects a future one', async () => {
    await createLifecycle();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleState', 'current'));
    });
    const recoveryDb = dbFor(UID);
    const ref = doc(recoveryDb, 'users', UID, 'workoutLifecycleState', 'current');
    const recoveredState = {
      startingLevel: 'BEGINNER', currentTrainingLevel: 'BEGINNER', currentCycleId: 'cyc_initial',
      currentCycleNumber: 1, activeProgramInstanceId: 'wpi_initial',
      activeContentIdentity: 'wpg_content', activePrescriptionIdentity: 'wp_content',
      initializationOrigin: 'V1_MIGRATION_BASELINE', historyCompleteFrom: Timestamp.fromMillis(1_000),
      schemaVersion: 2, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    await seedAuthorityGrant(UID, {
      operation: 'RECOVER', targetProgramInstanceId: 'wpi_initial', targetCycleId: 'cyc_initial',
    });
    await assertSucceeds(runTransaction(recoveryDb, async (transaction) => {
      transaction.set(ref, recoveredState);
      transaction.delete(doc(recoveryDb, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
    }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleState', 'current'));
    });
    await assertFails(setDoc(ref, {
      ...recoveredState,
      historyCompleteFrom: Timestamp.fromMillis(Date.now() + 86_400_000),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('denies other users and preserves immutable startingLevel', async () => {
    await createLifecycle();
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutLifecycleState', 'current')));
    await assertFails(updateDoc(doc(dbFor(UID), 'users', UID, 'workoutLifecycleState', 'current'), {
      startingLevel: 'ADVANCED', updatedAt: serverTimestamp(),
    }));
  });

  it('rejects extra fields and invalid finite-cycle assumptions', async () => {
    await createLifecycle();
    await assertFails(updateDoc(doc(dbFor(UID), 'users', UID, 'workoutLifecycleState', 'current'), {
      extra: true, updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'trainingCycles', 'bad'), {
      cycleId: 'bad', level: 'ADVANCED', cycleNumber: 0, status: 'ACTIVE', origin: 'V2_NATIVE',
      programInstanceId: 'wpi_initial', previousProgramInstanceId: null, startedAt: serverTimestamp(),
      eligibleAt: null, completedAt: null, progressionReason: 'BAD', schemaVersion: 2,
      completionReason: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('accepts only typed immutable event ledger entries', async () => {
    await createLifecycle();
    const ref = doc(dbFor(UID), 'users', UID, 'workoutLifecycleEvents', 'event-1');
    await assertSucceeds(createLifecycleEvent('event-1', 'operation-1'));
    await assertFails(updateDoc(ref, { payload: { xp: 100 } }));
  });

  // Fase 6 §56/AS — pendingEvolutions was previously untested at the Rules
  // layer (only exercised via emulator integration tests that use a trusted
  // client path). Audit invalid status/type/deferralCount, unknown fields,
  // and cross-user access directly against the Rules themselves.
  function validPendingEvolution(overrides: Record<string, unknown> = {}) {
    return {
      pendingEvolutionId: 'current', type: 'CYCLE_EVOLUTION', status: 'READY',
      sourceCycleId: 'cyc_initial', sourceProgramInstanceId: 'wpi_initial',
      sourcePrescriptionInputSnapshotId: 'pis_test',
      fromLevel: 'BEGINNER', toLevel: 'BEGINNER', quality: 'GOOD',
      sessionsCompletedAtEarn: 12, adherenceAtEarnBp: 8000,
      plan: {
        planId: 'wp_content', templateId: 'T003', requestedDays: 4,
        prescribedStructuredDays: 4, population: 'general', environment: 'gym',
        goalFamily: 'hypertrophy', split: 'upper_lower', limitationDatasetVersion: '1.0.0',
        limitationDatasetHash: 'b'.repeat(64), sessions: [{ name: 'A', exercises: [] }],
        versions: {}, trace: {},
      },
      targetContentIdentity: 'wpg_content', targetPrescriptionIdentity: 'wp_content',
      targetProgramInstanceId: 'wpi_next', targetQuestionnaireId: 'q1', targetQuestionnaireVersion: 1,
      targetPrescriptionInputSnapshot: prescriptionInputSnapshot({ source: 'CYCLE_EVOLUTION' }),
      targetTemplateId: 'T003', targetTemplateVersion: 1, targetTemplateSourceVersion: '1.0.0',
      targetTemplateContentHash: 'a'.repeat(64), earnedAt: serverTimestamp(), deferralCount: 0,
      nextPromptAt: null, autoActivateAt: null, idempotencyKey: 'op-1',
      schemaVersion: 2, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      ...overrides,
    };
  }

  async function createPendingEvolution(overrides: Record<string, unknown> = {}) {
    const pending = validPendingEvolution(overrides);
    await seedAuthorityGrant(UID, {
      operation: 'PREPARE', pendingEvolutionId: pending.pendingEvolutionId,
      targetProgramInstanceId: pending.targetProgramInstanceId,
      targetContentIdentity: pending.targetContentIdentity,
      targetPrescriptionIdentity: pending.targetPrescriptionIdentity,
      targetPlan: pending.plan,
      targetPrescriptionInputSnapshot: pending.targetPrescriptionInputSnapshot,
    });
    const db = dbFor(UID);
    await runTransaction(db, async (transaction) => {
      transaction.set(doc(db, 'users', UID, 'pendingEvolutions', 'current'), pending);
      transaction.delete(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
    });
  }

  it('rejects an unknown field on pendingEvolutions create', async () => {
    await createLifecycle();
    await assertFails(setDoc(
      doc(dbFor(UID), 'users', UID, 'pendingEvolutions', 'current'),
      validPendingEvolution({ rewardPreview: 100 }),
    ));
  });

  it('rejects an invalid status/type/deferralCount on pendingEvolutions create', async () => {
    await createLifecycle();
    await assertFails(setDoc(
      doc(dbFor(UID), 'users', UID, 'pendingEvolutions', 'current'),
      validPendingEvolution({ status: 'DEFERRED' }),
    ));
    await assertFails(setDoc(
      doc(dbFor(UID), 'users', UID, 'pendingEvolutions', 'current'),
      validPendingEvolution({ type: 'XP_AWARD' }),
    ));
    await assertFails(setDoc(
      doc(dbFor(UID), 'users', UID, 'pendingEvolutions', 'current'),
      validPendingEvolution({ deferralCount: 1 }),
    ));
  });

  it('rejects cross-user read/write on pendingEvolutions', async () => {
    await createLifecycle();
    await assertSucceeds(createPendingEvolution());
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'pendingEvolutions', 'current')));
    await assertFails(updateDoc(
      doc(dbFor(OTHER_UID), 'users', UID, 'pendingEvolutions', 'current'),
      { status: 'DEFERRED', deferralCount: 1, nextPromptAt: null, autoActivateAt: null, updatedAt: serverTimestamp() },
    ));
  });

  it('rejects a deferral update that skips straight to deferralCount 2 or mutates immutable identity', async () => {
    await createLifecycle();
    const deferDb = dbFor(UID);
    const ref = doc(deferDb, 'users', UID, 'pendingEvolutions', 'current');
    await assertSucceeds(createPendingEvolution());
    await assertFails(updateDoc(ref, {
      status: 'DEFERRED', deferralCount: 2, nextPromptAt: null, autoActivateAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ref, {
      status: 'DEFERRED', deferralCount: 1, toLevel: 'ADVANCED', nextPromptAt: serverTimestamp(), autoActivateAt: null, updatedAt: serverTimestamp(),
    }));
    await seedAuthorityGrant(UID, { operation: 'DEFER', pendingEvolutionId: 'current' });
    await assertSucceeds(runTransaction(deferDb, async (transaction) => {
      transaction.update(ref, {
        status: 'DEFERRED', deferralCount: 1,
        nextPromptAt: Timestamp.fromMillis(Date.now() + 14 * 86_400_000),
        autoActivateAt: null, updatedAt: serverTimestamp(),
      });
      transaction.delete(doc(deferDb, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'));
    }));
  });

  it('rejects semantic lifecycle, cycle, instance, event, and pending attacks by the owner', async () => {
    await createLifecycle();
    const db = dbFor(UID);
    await assertFails(updateDoc(doc(db, 'users', UID, 'workoutLifecycleState', 'current'), {
      currentTrainingLevel: 'ADVANCED', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db, 'users', UID, 'trainingCycles', 'cyc_initial'), {
      status: 'COMPLETED', completedAt: serverTimestamp(), completionReason: 'EARNED_EVOLUTION',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db, 'users', UID, 'trainingCycles', 'cyc_initial'), {
      status: 'ACTIVE', completedAt: null, completionReason: null, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db, 'users', UID, 'programInstances', 'wpi_initial'), {
      programInstanceId: 'wpi_forged', supersededAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutLifecycleEvents', 'fake-promotion'), {
      eventId: 'fake-promotion', type: 'LEVEL_PROMOTED', occurredAt: serverTimestamp(),
      cycleId: 'cyc_initial', programInstanceId: 'wpi_initial', idempotencyKey: 'fake',
      payload: { source: 'evolution_activation', evolutionType: 'CYCLE_EVOLUTION', quality: 'HIGH', trigger: 'MANUAL' },
      schemaVersion: 2,
    }));
    await assertFails(setDoc(doc(db, 'users', UID, 'pendingEvolutions', 'current'),
      validPendingEvolution({
        type: 'LEVEL_PROMOTION', toLevel: 'ADVANCED',
        targetPrescriptionInputSnapshot: prescriptionInputSnapshot({
          source: 'LEVEL_PROMOTION', inputs: { ...prescriptionInputSnapshot().inputs, level: 'advanced' },
        }),
      })));
    await assertFails(setDoc(doc(db, 'users', UID, 'pendingEvolutions', 'current'),
      validPendingEvolution({ plan: { ...validPendingEvolution().plan as object, arbitrary: true } })));
  });

  it('denies the complete malicious-owner transition matrix without a backend grant', async () => {
    await createLifecycle();
    const db = dbFor(UID);
    const stateRef = doc(db, 'users', UID, 'workoutLifecycleState', 'current');

    // Attack 1: adjacent promotion with the Beginner cycle left in place.
    await assertFails(updateDoc(stateRef, { currentTrainingLevel: 'INTERMEDIATE', updatedAt: serverTimestamp() }));

    // Put the fixture in a coherent Intermediate state through the trusted
    // setup channel, then prove both promotion and regression are denied.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users', UID, 'trainingCycles', 'cyc_initial'), { level: 'INTERMEDIATE' });
      await updateDoc(doc(context.firestore(), 'users', UID, 'workoutLifecycleState', 'current'), {
        currentTrainingLevel: 'INTERMEDIATE',
      });
    });
    await assertFails(updateDoc(stateRef, { currentTrainingLevel: 'ADVANCED', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(stateRef, { currentTrainingLevel: 'BEGINNER', updatedAt: serverTimestamp() }));

    // Attacks 2–7: earned cycle, privileged events, arbitrary pending,
    // arbitrary active instance, and a forged grant are all owner-denied.
    await assertFails(updateDoc(doc(db, 'users', UID, 'trainingCycles', 'cyc_initial'), {
      status: 'COMPLETED', completedAt: serverTimestamp(), completionReason: 'EARNED_EVOLUTION',
      updatedAt: serverTimestamp(),
    }));
    for (const type of ['LEVEL_PROMOTED', 'EVOLUTION_ACTIVATED']) {
      await assertFails(setDoc(doc(db, 'users', UID, 'workoutLifecycleEvents', `fake-${type}`), {
        eventId: `fake-${type}`, type, occurredAt: serverTimestamp(), cycleId: 'cyc_initial',
        programInstanceId: 'wpi_initial', idempotencyKey: `fake-${type}`,
        payload: { source: 'evolution_activation', evolutionType: 'LEVEL_PROMOTION', quality: 'HIGH', trigger: 'MANUAL' },
        schemaVersion: 2,
      }));
    }
    await assertFails(setDoc(doc(db, 'users', UID, 'pendingEvolutions', 'current'), validPendingEvolution()));
    await assertFails(setDoc(doc(db, 'users', UID, 'programInstances', 'wpi_forged'), {
      programInstanceId: 'wpi_forged', cycleId: 'cyc_initial', contentIdentity: 'wpg_content',
      prescriptionIdentity: 'wp_content', questionnaireId: 'q1', prescriptionInputSnapshot: prescriptionInputSnapshot(),
      activatedAt: serverTimestamp(), supersededAt: null, previousProgramInstanceId: 'wpi_initial',
      activationReason: 'EVOLUTION_ACTIVATION', schemaVersion: 2,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutLifecycleAuthorityGrants', 'current'), {
      uid: UID, operation: 'ACTIVATE', schemaVersion: 1, expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    }));
  });

  it('denies cross-user CRUD across every critical lifecycle collection', async () => {
    await createLifecycle();
    await assertSucceeds(createLifecycleEvent('event-cross', 'cross'));
    await assertSucceeds(createPendingEvolution());
    const attacker = dbFor(OTHER_UID);
    for (const [collection, id] of [
      ['workoutLifecycleState', 'current'], ['trainingCycles', 'cyc_initial'],
      ['programInstances', 'wpi_initial'], ['workoutLifecycleEvents', 'event-cross'],
      ['pendingEvolutions', 'current'],
    ]) {
      const ref = doc(attacker, 'users', UID, collection, id);
      await assertFails(getDoc(ref));
      await assertFails(updateDoc(ref, { updatedAt: serverTimestamp() }));
      await assertFails(deleteDoc(ref));
      await assertFails(setDoc(doc(attacker, 'users', UID, collection, `evil-${id}`), { forged: true }));
    }
  });

  it('accepts the closed input snapshot, rejects unknown snapshot fields, cross-user reads, and historical mutation', async () => {
    await createLifecycle();
    const instanceRef = doc(dbFor(UID), 'users', UID, 'programInstances', 'wpi_initial');
    expect((await getDoc(instanceRef)).data()?.prescriptionInputSnapshot.inputs.level).toBe('beginner');
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'programInstances', 'wpi_initial')));
    await assertFails(updateDoc(instanceRef, {
      'prescriptionInputSnapshot.inputs.level': 'advanced', updatedAt: serverTimestamp(),
    }));

    const invalidPending = validPendingEvolution({
      targetPrescriptionInputSnapshot: prescriptionInputSnapshot({ unexpected: true }),
    });
    await assertFails(setDoc(
      doc(dbFor(UID), 'users', UID, 'pendingEvolutions', 'current'),
      invalidPending,
    ));
  });

  // Fase 6 — rollout config is ops-controlled (Admin SDK only); client can
  // read the active doc but never write its own eligibility.
  it('allows reading workoutLifecycleRolloutConfig/active but never writing it from the client', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
        schemaVersion: 1, enabled: true, percentage: 50,
      });
    });
    await assertSucceeds(getDoc(doc(dbFor(UID), 'workoutLifecycleRolloutConfig', 'active')));
    await assertFails(setDoc(doc(dbFor(UID), 'workoutLifecycleRolloutConfig', 'active'), {
      schemaVersion: 1, enabled: true, percentage: 100,
    }));
  });

  it('allows the owner to persist and read a schedule cursor scoped to ProgramInstance', async () => {
    await createLifecycle();
    const ref = doc(
      dbFor(UID),
      'users', UID, 'workoutPrograms', 'wpg_content', 'scheduleState', 'wpi_initial',
    );
    await assertSucceeds(setDoc(ref, {
      programId: 'wpg_content',
      programInstanceId: 'wpi_initial',
      nextSessionIndex: 0,
      cursorDate: '2026-08-28',
      lastCompletedAt: null,
      pendingMissDecision: null,
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(ref));
    await assertFails(getDoc(doc(
      dbFor(OTHER_UID),
      'users', UID, 'workoutPrograms', 'wpg_content', 'scheduleState', 'wpi_initial',
    )));
  });
});
