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
  setDoc,
  Timestamp,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'notification-owner';
const OTHER_UID = 'notification-other';
const RULES_PATH = process.env.FIRESTORE_RULES_PATH
  ? resolve(process.env.FIRESTORE_RULES_PATH)
  : resolve(__dirname, '../firestore.rules');
let environment: RulesTestEnvironment;

function db(uid: string) {
  return environment.authenticatedContext(uid, {
    email: `${uid}@example.com`,
    email_verified: true,
  }).firestore();
}

function unauthenticatedDb() {
  return environment.unauthenticatedContext().firestore();
}

async function seedUsers() {
  await environment.withSecurityRulesDisabled(async (context) => {
    for (const uid of [UID, OTHER_UID]) {
      await setDoc(doc(context.firestore(), 'users', uid), {
        profile: { name: uid, email: `${uid}@example.com` },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: {
          role: 'user',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      });
    }
    await setDoc(doc(context.firestore(), 'pushInstallations', 'installation'), {
      ownerUid: UID,
    });
    await setDoc(doc(context.firestore(), 'pushTokenOwners', 'hash'), {
      ownerUid: UID,
      expoPushToken: 'secret',
    });
    await setDoc(doc(context.firestore(), 'users', UID, 'devices', 'installation'), {
      pushEnabled: true,
    });
    await setDoc(doc(context.firestore(), 'notificationDispatches', 'dispatch'), {
      uid: UID,
    });
    await setDoc(doc(context.firestore(), 'notificationDailyUsers', UID), {
      timezone: 'UTC',
    });
    await setDoc(doc(context.firestore(), 'notificationProductWindows', 'window'), {
      uid: UID,
    });
    await setDoc(doc(
      context.firestore(),
      'notificationDispatches',
      'dispatch',
      'deliveries',
      'installation',
    ), { uid: UID });
  });
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

afterAll(async () => environment.cleanup());

beforeEach(async () => {
  await environment.clearFirestore();
  await seedUsers();
});

describe('notification preferences rules', () => {
  it.each([
    'workoutsAndReminders',
    'evolutionAndAchievements',
    'progress',
  ])('allows owner boolean update for %s', async (key) => {
    await assertSucceeds(updateDoc(doc(db(UID), 'users', UID), {
      [`preferences.notificationPreferences.${key}`]: false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('allows independent fields without replacing siblings', async () => {
    await assertSucceeds(updateDoc(doc(db(UID), 'users', UID), {
      'preferences.notificationPreferences.progress': false,
      'preferences.notificationPreferences.workoutsAndReminders': true,
      'metadata.updatedAt': serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(db(UID), 'users', UID)));
  });

  it('rejects operational, unknown and non-boolean fields', async () => {
    await assertFails(updateDoc(doc(db(UID), 'users', UID), {
      'preferences.notificationPreferences.operational': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db(UID), 'users', UID), {
      'preferences.notificationPreferences.progress': 'off',
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('rejects cross-user updates', async () => {
    await assertFails(updateDoc(doc(db(OTHER_UID), 'users', UID), {
      'preferences.notificationPreferences.progress': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('rejects unauthenticated updates', async () => {
    await assertFails(updateDoc(doc(unauthenticatedDb(), 'users', UID), {
      'preferences.notificationPreferences.progress': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('rejects updates while the account deletion lock exists', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountDeletionLocks', UID), {
        createdAt: Timestamp.now(),
      });
    });

    await assertFails(updateDoc(doc(db(UID), 'users', UID), {
      'preferences.notificationPreferences.progress': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('rejects an unexpected notification preference field', async () => {
    await assertFails(updateDoc(doc(db(UID), 'users', UID), {
      'preferences.notificationPreferences.unexpected': false,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('rejects privileged fields in the same update', async () => {
    await assertFails(updateDoc(doc(db(UID), 'users', UID), {
      'preferences.notificationPreferences.progress': false,
      'subscription.entitlementActive': true,
      'metadata.updatedAt': serverTimestamp(),
    }));
  });
});

describe('private push registries', () => {
  it.each([
    ['pushInstallations', 'installation'],
    ['pushTokenOwners', 'hash'],
    ['users/notification-owner/devices', 'installation'],
    ['notificationDispatches', 'dispatch'],
    ['notificationDispatches/dispatch/deliveries', 'installation'],
    ['notificationDailyUsers', UID],
    ['notificationProductWindows', 'window'],
  ])('denies client read and write at %s/%s', async (collectionPath, id) => {
    const reference = doc(db(UID), collectionPath, id);
    await assertFails(getDoc(reference));
    await assertFails(setDoc(reference, { ownerUid: UID }));
  });

  it('denies raw Expo Push Token writes from the client', async () => {
    await assertFails(setDoc(doc(db(UID), 'pushTokenOwners', 'raw-token-hash'), {
      ownerUid: UID,
      expoPushToken: 'ExponentPushToken[client-must-not-write-this]',
    }));
  });
});
