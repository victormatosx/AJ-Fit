/**
 * OPT-IN integration proof against the REAL Firestore Emulator (2026-09-24
 * orphaned-Google-account audit — Camada A/B fix). Drives the EXACT
 * admission/provisioning decisions `AuthContext.tsx`'s `signInWithProvider`
 * makes, using the real service functions (not mocks), for the specific
 * "incompletely provisioned identity" recovery scenarios the audit called
 * out: a Firebase Auth user that exists with no corresponding `users/{uid}`
 * document (or with a document but no active workout program yet).
 *
 * Skipped by default — only runs when
 * `SOCIAL_REGISTRATION_RECOVERY_INTEGRATION=1` is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
} from '../../workoutPrescription/limitationDataset';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'orphaned-google-user';

const enabled = process.env.SOCIAL_REGISTRATION_RECOVERY_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { getLatestQuestionnaire, getUserProfile, provisionNewUser } from '../userProfile';
import { resolveSocialAccountAdmission } from '../../lib/registrationEligibility';
import {
  generateAndPersistWorkoutProgramDeduped,
  loadActiveWorkoutProgram,
  prepareWorkoutProgramLocally,
  persistPreparedWorkoutProgram,
} from '../workoutPrograms';
import { ensureScheduleConfigFromQuestionnaire } from '../workoutSchedule';
import { normalizeWeekdays, trainingDaysValid } from '../../lib/questionnaireSchema';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

const T004_SEED = buildSeedDocuments().find((t) => t.id === 'T004');
if (!T004_SEED) throw new Error('T004 fixture missing — cannot run this integration test');

const ANSWERS = completeAnswers({
  level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle',
  birthDate: new Date('1990-01-01T12:00:00.000Z'),
  trainingDays: ['MON', 'TUE', 'THU', 'FRI'],
});

const orphanedAuthUser = { uid: UID, email: 'orphan@example.com', displayName: 'Orphan' } as unknown as User;

describe.skipIf(!enabled)('Social registration recovery (incomplete identity self-healing) — real Firestore Emulator', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'orphan@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });

  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workoutTemplates', 'T004'), T004_SEED);
      await setDoc(doc(ctx.firestore(), 'limitationDatasetState', 'active'), {
        datasetVersion: CANONICAL_LIMITATION_DATASET_VERSION,
        limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH,
      });
    });
  });

  // (D) — cold restart: a Firebase Auth user exists (simulated directly —
  // this suite never touches real Auth) but `users/{uid}` was never
  // written (exactly the reported incident: signInWithCredential's response
  // was lost after the server already created the account). Redoing the
  // minimal registration (quiz + legal acceptance) — the SAME admission
  // decision `signInWithProvider` makes on a subsequent attempt — completes
  // provisioning under the EXACT SAME uid, never a second identity.
  it('(D) an authenticated identity with no users/{uid} document completes provisioning on the next admission check, under the same uid', async () => {
    expect(await getUserProfile(UID)).toBeNull();

    const admission = resolveSocialAccountAdmission({
      isNewUser: false, // Firebase reports the account already existed (created by the earlier, lost-response attempt)
      hasProfile: false,
      answers: ANSWERS,
      legalAccepted: true,
    });
    expect(admission).toBe('requires-provisioning');

    const questionnaireId = await provisionNewUser(orphanedAuthUser, {
      name: 'Orphan', answers: ANSWERS, legalAccepted: true,
    });
    expect(questionnaireId).not.toBeNull();

    const profile = await getUserProfile(UID);
    expect(profile).not.toBeNull();
    expect(profile?.profile.email).toBe('orphan@example.com');
    const questionnaire = await getLatestQuestionnaire(UID);
    expect(questionnaire?.id).toBe(questionnaireId);

    // Never a different identity: the profile is keyed by the exact same
    // Auth uid the orphaned session already had.
    const profileDoc = await getDoc(doc(mocks.db as never, 'users', UID));
    expect(profileDoc.exists()).toBe(true);
  });

  // (E) — recovery run twice for the same, now-provisioned identity must
  // never duplicate the questionnaire. The real guarantee this codebase
  // provides is at the ADMISSION layer: a fresh `getUserProfile` read before
  // deciding whether to provision — once it succeeds, later admission
  // checks resolve to `'existing'` and `provisionNewUser` is never called
  // again for this uid.
  it('(E) running the recovery admission check again after it already completed is a no-op — no duplicate questionnaire', async () => {
    await provisionNewUser(orphanedAuthUser, { name: 'Orphan', answers: ANSWERS, legalAccepted: true });
    const questionnairesAfterFirst = await getDocs(collection(mocks.db as never, 'users', UID, 'questionnaires'));
    expect(questionnairesAfterFirst.size).toBe(1);

    const existingProfile = await getUserProfile(UID);
    const secondAdmission = resolveSocialAccountAdmission({
      isNewUser: false,
      hasProfile: existingProfile !== null,
      answers: ANSWERS,
      legalAccepted: true,
    });
    expect(secondAdmission).toBe('existing');
    // `signInWithProvider` never calls `provisionNewUser` when admission is
    // `'existing'` — asserting the admission outcome IS the assertion that
    // no second write is even attempted.

    const questionnairesAfterSecond = await getDocs(collection(mocks.db as never, 'users', UID, 'questionnaires'));
    expect(questionnairesAfterSecond.size).toBe(1);
  });

  // (F) — an established account (profile already complete) must never be
  // reprovisioned, regardless of what `answers`/`legalAccepted` a later
  // social sign-in call happens to carry (or omit).
  it('(F) an existing account with a complete profile is never reprovisioned on a later social sign-in', async () => {
    await provisionNewUser(orphanedAuthUser, { name: 'Orphan', answers: ANSWERS, legalAccepted: true });
    const before = await getUserProfile(UID);

    const admission = resolveSocialAccountAdmission({
      isNewUser: false,
      hasProfile: true,
      answers: null, // a plain later login carries neither
      legalAccepted: undefined,
    });
    expect(admission).toBe('existing');

    const after = await getUserProfile(UID);
    expect(after).toEqual(before);
  });

  // (G) — a partially-complete identity (profile + questionnaire already
  // provisioned, e.g. by a PRIOR successful recovery, but no workout
  // program yet — the one partial state reachable in this codebase, since
  // `provisionNewUser` always writes profile+questionnaire atomically)
  // completes ONLY the missing piece via the EXISTING Phase 3 automatic
  // reconciliation policy (`useWorkoutPrescription.ts`'s
  // `resolveWorkoutPrescription`: authenticated + questionnaire loaded + no
  // active program → generate via the same deduped path exercised here) —
  // never rewriting the already-valid profile/questionnaire.
  it('(G) profile+questionnaire already provisioned, program missing — reconciliation installs only the missing program', async () => {
    const questionnaireId = await provisionNewUser(orphanedAuthUser, {
      name: 'Orphan', answers: ANSWERS, legalAccepted: true,
    });
    if (!questionnaireId) throw new Error('questionnaireId missing');
    const profileBefore = await getUserProfile(UID);
    const questionnaire = await getLatestQuestionnaire(UID);
    expect(questionnaire).not.toBeNull();
    if (!questionnaire) throw new Error('questionnaire missing');

    expect(await loadActiveWorkoutProgram(UID)).toBeNull();

    const resolved = await generateAndPersistWorkoutProgramDeduped({
      uid: UID,
      questionnaireId: questionnaire.id,
      questionnaireVersion: questionnaire.version,
      answers: questionnaire.answers,
      source: 'automatic_reconciliation',
    });
    expect(resolved.status).toBe('SUCCESS');

    const profileAfter = await getUserProfile(UID);
    expect(profileAfter).toEqual(profileBefore); // untouched — never rewritten
    const questionnairesAfter = await getDocs(collection(mocks.db as never, 'users', UID, 'questionnaires'));
    expect(questionnairesAfter.size).toBe(1); // still exactly one — never duplicated
    expect(await loadActiveWorkoutProgram(UID)).not.toBeNull();
  });

  // (H) — the auth-state listener's own bootstrap read (`loadUserState`,
  // simulated here via `getUserProfile`/`getLatestQuestionnaire`, its exact
  // Firestore calls) runs CONCURRENTLY with an explicit recovery/provisioning
  // attempt for the same uid. Camada B's listener-side reconciliation is
  // read-only (recognition/logging only — see `AuthContext.tsx`'s
  // `loadUserState`), so there is only ever ONE writer for this identity;
  // the concurrent read must never observe (or cause) a partial/corrupted
  // write, and the final state is exactly what the single writer produced.
  it('(H) a concurrent bootstrap read alongside the one real provisioning write converges on a single consistent identity', async () => {
    const [_, questionnaireId] = await Promise.all([
      // The listener's own read — read-only, races the write below.
      Promise.all([getUserProfile(UID), getLatestQuestionnaire(UID)]),
      provisionNewUser(orphanedAuthUser, { name: 'Orphan', answers: ANSWERS, legalAccepted: true }),
    ]);
    expect(questionnaireId).not.toBeNull();

    const profile = await getUserProfile(UID);
    const questionnaire = await getLatestQuestionnaire(UID);
    expect(profile).not.toBeNull();
    expect(questionnaire?.id).toBe(questionnaireId);
    const questionnaires = await getDocs(collection(mocks.db as never, 'users', UID, 'questionnaires'));
    expect(questionnaires.size).toBe(1);
  });

  // Preserves the Analysis screen's pre-auth `preparedWorkoutProgram` when
  // the recovery happens WITHIN the same session (Camada A reconciling a
  // lost network response) — `signInWithProvider` now threads `prepared`
  // through to `persistPreparedWorkoutProgram` exactly like `signUp` always
  // has, instead of discarding it and forcing a full regeneration.
  it('reuses the already-computed prepared plan when recovering within the same session', async () => {
    const prepared = await prepareWorkoutProgramLocally(ANSWERS);
    expect(prepared.status).toBe('SUCCESS');

    const questionnaireId = await provisionNewUser(orphanedAuthUser, {
      name: 'Orphan', answers: ANSWERS, legalAccepted: true,
    });
    if (!questionnaireId) throw new Error('questionnaireId missing');

    const persisted = await persistPreparedWorkoutProgram({
      uid: UID, questionnaireId, questionnaireVersion: 1,
      answers: ANSWERS, prepared, source: 'onboarding',
    });
    expect(persisted.status).toBe('SUCCESS');
    if (persisted.status !== 'SUCCESS') return;
    expect(persisted.plan.planId).toBe(prepared.status === 'SUCCESS' ? prepared.plan.planId : undefined);

    if (trainingDaysValid(ANSWERS)) {
      await ensureScheduleConfigFromQuestionnaire(UID, normalizeWeekdays(ANSWERS.trainingDays ?? []), 'America/Sao_Paulo');
    }
    expect(await loadActiveWorkoutProgram(UID)).not.toBeNull();

    // Automatic reconciliation would have produced an equally valid plan —
    // asserting `generateAndPersistWorkoutProgramDeduped` finds the program
    // ALREADY there (no second generation) proves the prepared plan, not a
    // regenerated one, is what actually got installed.
    const secondAttempt = await generateAndPersistWorkoutProgramDeduped({
      uid: UID, questionnaireId, questionnaireVersion: 1, answers: ANSWERS, source: 'automatic_reconciliation',
    });
    expect(secondAttempt.status).toBe('SUCCESS');
    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
  });
});
