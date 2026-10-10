/**
 * Regression test for the real-device `permission-denied` bug on
 * `preferences.notificationPreferences.{subscription,support}`.
 *
 * Root cause: the project's PRODUCTION Firestore ruleset
 * (`ajfit-2f321`, released 2026-07-04, confirmed via the Firebase Rules API
 * `projects/ajfit-2f321/releases/cloud.firestore`) still had
 * `notificationPreferencesValid` accepting only the original 3 keys
 * (`workoutsAndReminders`, `evolutionAndAchievements`, `progress`) — the
 * `subscription`/`support` keys this feature adds were never deployed.
 * `firestore-tests/preferences.rules.test.ts` only ever exercises the local
 * `firestore.rules` FILE (what the emulator loads), so it can't detect that
 * the deployed ruleset lags behind it — it was always green.
 *
 * This file reproduces the exact byte-for-byte stale rule (reconstructed by
 * stripping just the 2 new keys from the current function, the same way the
 * live diff against the Rules API showed) side by side with the current
 * rule, against the same write, so the "before" case provably fails with
 * `permission-denied` and the "after" case provably succeeds. It exists to
 * catch any future revert of `notificationPreferencesValid` back to 3 keys —
 * `preferences.rules.test.ts` alone would not catch that regression's real
 * symptom, only a shape mismatch.
 *
 * Fix applied: none to `firestore.rules` (already correct) — `firebase
 * deploy --only firestore:rules` to `ajfit-2f321` is required for the six
 * categories to work on a real device. See the task report for the deploy
 * command.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const UID = 'alice';

const CURRENT_RULES = readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8');

const CURRENT_FUNCTION = `    function notificationPreferencesValid(data) {
      return data is map
        && data.keys().hasOnly([
             'workoutsAndReminders',
             'evolutionAndAchievements',
             'progress',
             'nutrition',
             'subscription',
             'support'
           ])
        && (!('workoutsAndReminders' in data) || data.workoutsAndReminders is bool)
        && (!('evolutionAndAchievements' in data) || data.evolutionAndAchievements is bool)
        && (!('progress' in data) || data.progress is bool)
        && (!('nutrition' in data) || data.nutrition is bool)
        && (!('subscription' in data) || data.subscription is bool)
        && (!('support' in data) || data.support is bool);
    }`;

// Byte-for-byte what `ajfit-2f321`'s deployed ruleset had at the time this
// bug was reported — fetched via the Rules API and diffed against
// `firestore.rules`; this was the ONLY difference in the entire file.
const STALE_DEPLOYED_FUNCTION = `    function notificationPreferencesValid(data) {
      return data is map
        && data.keys().hasOnly([
             'workoutsAndReminders',
             'evolutionAndAchievements',
             'progress'
           ])
        && (!('workoutsAndReminders' in data) || data.workoutsAndReminders is bool)
        && (!('evolutionAndAchievements' in data) || data.evolutionAndAchievements is bool)
        && (!('progress' in data) || data.progress is bool);
    }`;

if (!CURRENT_RULES.includes(CURRENT_FUNCTION)) {
  throw new Error(
    'notificationPreferencesDeployDrift fixture is stale: notificationPreferencesValid in ' +
    'firestore.rules no longer matches the expected current text. Update CURRENT_FUNCTION/' +
    'STALE_DEPLOYED_FUNCTION in this test to re-derive the drift scenario.',
  );
}

const STALE_RULES = CURRENT_RULES.replace(CURRENT_FUNCTION, STALE_DEPLOYED_FUNCTION);

async function seedUser(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', UID), {
      profile: { name: 'Alice', email: 'alice@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

function writeAllSix(env: RulesTestEnvironment) {
  const ownerDb = env.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
  return updateDoc(doc(ownerDb, 'users', UID), {
    'preferences.notificationPreferences.workoutsAndReminders': false,
    'preferences.notificationPreferences.evolutionAndAchievements': false,
    'preferences.notificationPreferences.progress': false,
    'preferences.notificationPreferences.nutrition': false,
    'preferences.notificationPreferences.subscription': false,
    'preferences.notificationPreferences.support': false,
    'metadata.updatedAt': serverTimestamp(),
  });
}

describe('deploy drift: notificationPreferencesValid 3-key vs 6-key', () => {
  let staleEnv: RulesTestEnvironment;
  let currentEnv: RulesTestEnvironment;

  beforeAll(async () => {
    staleEnv = await initializeTestEnvironment({
      projectId: 'ajfit-rules-test-stale-notifprefs',
      firestore: { rules: STALE_RULES },
    });
    currentEnv = await initializeTestEnvironment({
      projectId: 'ajfit-rules-test-current-notifprefs',
      firestore: { rules: CURRENT_RULES },
    });
  });

  afterAll(async () => {
    await Promise.all([staleEnv?.cleanup(), currentEnv?.cleanup()]);
  });

  it('reproduces the real permission-denied: the stale 3-key ruleset rejects all 5 categories', async () => {
    await seedUser(staleEnv);
    await assertFails(writeAllSix(staleEnv));
  });

  it('the current 6-key ruleset (this repo\'s firestore.rules) accepts all 6 categories', async () => {
    await seedUser(currentEnv);
    await assertSucceeds(writeAllSix(currentEnv));
  });

  it('the stale ruleset still accepts the 3 original categories alone (why partial toggles looked fine)', async () => {
    await seedUser(staleEnv);
    const ownerDb = staleEnv.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
    await assertSucceeds(updateDoc(doc(ownerDb, 'users', UID), {
      'preferences.notificationPreferences.workoutsAndReminders': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('the stale ruleset rejects `subscription` or `support` even added individually', async () => {
    await seedUser(staleEnv);
    const ownerDb = staleEnv.authenticatedContext(UID, { email: 'alice@example.com' }).firestore();
    await assertFails(updateDoc(doc(ownerDb, 'users', UID), {
      'preferences.notificationPreferences.subscription': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ownerDb, 'users', UID), {
      'preferences.notificationPreferences.support': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });
});
