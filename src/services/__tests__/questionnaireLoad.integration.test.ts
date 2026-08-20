/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `functions/src/billing/__tests__/commercialGateResolution.integration.test.ts`.
 *
 * WHY this file exists: the cold-start "hasQuestionnaire" intermittency
 * investigation found that `getLatestQuestionnaire`/`getUserProfile`'s unit
 * tests (if any existed) would only ever exercise mocked Firestore calls —
 * never the REAL client SDK against REAL Firestore Security Rules. This
 * file imports the actual, unmodified loader functions from
 * `../userProfile.ts` (the exact same functions `AuthContext.loadUserState`
 * calls) and runs them against the Firestore Emulator with the project's
 * real `firestore.rules` enforced — proving `getLatestQuestionnaire`
 * genuinely resolves FOUND/NOT_FOUND correctly, not just that some mock was
 * called correctly.
 *
 * `src/lib/firebase.ts` (the singleton `../lib/firebase` module) is mocked
 * ONLY to swap its native-platform bootstrap (Expo App Check native module,
 * `expo-secure-store`/AsyncStorage-backed Auth persistence — none of which
 * can run under plain Node/Vitest) for a real, Emulator-connected Firestore
 * instance from `@firebase/rules-unit-testing`. This is the same technique
 * every other `src/services/__tests__/*.test.ts` file already uses to test
 * code that imports `../lib/firebase` (see e.g. `photoVault.test.ts`) — the
 * loader logic under test (`getLatestQuestionnaire`/`getUserProfile`
 * themselves) is never mocked or reimplemented.
 *
 * Skipped by default — only runs when `QUESTIONNAIRE_LOAD_INTEGRATION=1` is
 * set. Run via the root `test:integration:questionnaireLoad` npm script,
 * which wraps this in `firebase emulators:exec --only firestore --project
 * ajfit-rules-test` — the same disposable, non-production project every
 * other Firestore/Rules integration suite in this repo uses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';

const enabled = process.env.QUESTIONNAIRE_LOAD_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

// `vi.hoisted` + a getter-backed mock so `mocks.db` can be assigned AFTER
// `initializeTestEnvironment` resolves (in `beforeAll`), while `userProfile.ts`
// below — itself importing `db` from `../lib/firebase` — always reads
// whatever the getter currently returns.
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

// `vi.mock` calls above are hoisted above every import in this file by
// Vitest, so this ordinary import resolves `../lib/firebase` (inside
// `userProfile.ts`) to the mock, not the real (RN/Expo-dependent) module —
// same convention as every other `src/services/__tests__/*.test.ts` file
// that imports code depending on `../lib/firebase` (e.g. `photoVault.test.ts`).
import { getLatestQuestionnaire, getUserProfile } from '../userProfile';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { defaultQuiz } from '../../state/AppState';

describe.skipIf(!enabled)(
  'getLatestQuestionnaire / getUserProfile — real Firestore Emulator integration',
  () => {
    beforeAll(async () => {
      testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
      });
      // The loader functions run as `alice` — same as the app would for its
      // own signed-in uid. Rules are FULLY enforced (not disabled) for the
      // reads under test; only seeding below bypasses them.
      mocks.db = testEnv.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
    });

    afterAll(async () => {
      await testEnv.cleanup();
    });

    beforeEach(async () => {
      await testEnv.clearFirestore();
    });

    function validUserDoc() {
      return {
        profile: { name: 'Alice', email: 'alice@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: {
          role: 'user',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          commercialGateResolvedAt: null,
        },
      };
    }

    it('write users/{uid}/questionnaires/{id} → same loader AuthContext uses → FOUND', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'users', UID), validUserDoc());
        await setDoc(doc(collection(db, `users/${UID}/questionnaires`), 'q1'), {
          answers: toPersistedAnswers(defaultQuiz),
          version: 1,
          createdAt: Timestamp.now(),
        });
      });

      const questionnaire = await getLatestQuestionnaire(UID);

      expect(questionnaire).not.toBeNull();
      expect(questionnaire?.id).toBe('q1');
    });

    it('empty questionnaires collection → same loader → NOT_FOUND (null, no error)', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', UID), validUserDoc());
      });

      const questionnaire = await getLatestQuestionnaire(UID);

      expect(questionnaire).toBeNull();
    });

    it('getUserProfile resolves the real user document through the same loader path', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', UID), validUserDoc());
      });

      const profile = await getUserProfile(UID);

      expect(profile).not.toBeNull();
      expect(profile?.profile.name).toBe('Alice');
    });

    it('picks the most recent questionnaire when more than one exists (orderBy createdAt desc)', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'users', UID), validUserDoc());
        await setDoc(doc(collection(db, `users/${UID}/questionnaires`), 'older'), {
          answers: toPersistedAnswers(defaultQuiz),
          version: 1,
          createdAt: Timestamp.fromMillis(1_000),
        });
        await setDoc(doc(collection(db, `users/${UID}/questionnaires`), 'newer'), {
          answers: toPersistedAnswers(defaultQuiz),
          version: 2,
          createdAt: Timestamp.fromMillis(2_000),
        });
      });

      const questionnaire = await getLatestQuestionnaire(UID);

      expect(questionnaire?.id).toBe('newer');
    });
  },
);
