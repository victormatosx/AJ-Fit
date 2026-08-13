/**
 * Firestore Rules — behavioral tests for `preferences.language` and every
 * ambient invariant the Phase 0 rules changes must preserve.
 *
 * Executed against the Firestore emulator. See the `test:rules` npm script
 * (wraps this file with `firebase emulators:exec --only firestore`, which
 * sets `FIRESTORE_EMULATOR_HOST` for `initializeTestEnvironment` to pick up).
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  deleteField,
} from 'firebase/firestore';
import { SUPPORTED_LANGUAGES } from '../src/types/language';
import { UNITS_PREFERENCES } from '../src/types/units';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';

let testEnv: RulesTestEnvironment;

function ownerDb() {
  return testEnv
    .authenticatedContext(UID, { email: 'alice@example.com' })
    .firestore();
}
function otherDb() {
  return testEnv
    .authenticatedContext(OTHER_UID, { email: 'mallory@example.com' })
    .firestore();
}

/** Seeds a valid nested user document bypassing rules (baseline for updates). */
async function seedUser(
  overrides: Partial<{ language: string; units: string }> = {},
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', UID), {
      profile: { name: 'Alice', email: 'alice@example.com' },
      preferences: {
        language: overrides.language ?? 'pt-BR',
        units: overrides.units ?? 'system',
        theme: 'dark',
      },
      subscription: {},
      metadata: {
        role: 'user',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
    });
  });
}

/** Seeds the pre-migration flat document that `legacyMigrationValid` recognizes. */
async function seedLegacyUser() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', UID), {
      name: 'Alice',
      email: 'alice@example.com',
      role: 'user',
      createdAt: Timestamp.now(),
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ── Allowed ────────────────────────────────────────────────────────────────

describe('preferences.language — allowed', () => {
  beforeEach(seedUser);

  for (const to of SUPPORTED_LANGUAGES) {
    it(`allows owner to set language to '${to}'`, async () => {
      await assertSucceeds(
        updateDoc(doc(ownerDb(), 'users', UID), {
          'preferences.language': to,
          'metadata.updatedAt': serverTimestamp(),
        }),
      );
      const snap = await getDoc(doc(ownerDb(), 'users', UID));
      expect(snap.data()?.preferences.language).toBe(to);
    });
  }
});

describe('other allowed updates continue to work', () => {
  beforeEach(seedUser);

  it('allows updating profile.name', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'profile.name': 'Alice Renamed',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('allows updating profile.birthDate', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'profile.birthDate': Timestamp.fromDate(new Date('1990-01-01')),
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('allows updating metadata.updatedAt on its own', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});

describe('legacy migration branch remains valid', () => {
  it('accepts the flat→nested migration write', async () => {
    await seedLegacyUser();

    // This mirrors migratedUserDocument() in src/services/userProfile.ts and
    // must be accepted by legacyMigrationValid — the target of the rule is
    // exactly this shape, produced once per legacy account.
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'users', UID), {
        profile: { name: 'Alice', email: 'alice@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: {
          role: 'user',
          createdAt: (await getDoc(doc(ownerDb(), 'users', UID))).get('createdAt'),
          updatedAt: serverTimestamp(),
        },
      }),
    );
  });
});

// ── Rejected ───────────────────────────────────────────────────────────────

describe('preferences.language — rejected values', () => {
  beforeEach(seedUser);

  it('rejects an unknown language code', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': 'fr',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects an empty language string', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': '',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects a non-string language value (number)', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': 42,
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects a non-string language value (null)', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': null,
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects a casing variant not in the allowlist', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': 'PT-BR',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});

describe('preferences — protected sibling fields', () => {
  beforeEach(seedUser);

  it('rejects changing preferences.theme', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.theme': 'light',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects a simultaneous update to language and theme', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': 'en',
        'preferences.theme': 'light',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('allows a simultaneous valid update to language and units', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.language': 'en',
        'preferences.units': 'imperial',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});

describe('preferences.units', () => {
  beforeEach(seedUser);

  for (const units of UNITS_PREFERENCES) {
    it(`allows owner to set units to '${units}'`, async () => {
      await assertSucceeds(
        updateDoc(doc(ownerDb(), 'users', UID), {
          'preferences.units': units,
          'metadata.updatedAt': serverTimestamp(),
        }),
      );
    });
  }

  it.each(['uk', '', 'SI', null, 42])('rejects invalid units value: %s', async (units) => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.units': units,
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('updates units without erasing language or theme', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.units': 'imperial',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
    const preferences = (await getDoc(doc(ownerDb(), 'users', UID))).data()?.preferences;
    expect(preferences).toEqual({
      language: 'pt-BR',
      units: 'imperial',
      theme: 'dark',
    });
  });
});

describe('preferences — shape integrity', () => {
  beforeEach(seedUser);

  it('rejects removing preferences.theme', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.theme': deleteField(),
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects removing preferences.units', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.units': deleteField(),
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects an incomplete preferences map (only language)', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        preferences: { language: 'en' },
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects an extra field inside preferences', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        'preferences.experimental': true,
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('rejects a complete removal of preferences', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), 'users', UID), {
        preferences: deleteField(),
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});

describe('cross-user and unauthenticated access', () => {
  beforeEach(seedUser);

  it("blocks another authenticated user from changing this user's language", async () => {
    await assertFails(
      updateDoc(doc(otherDb(), 'users', UID), {
        'preferences.language': 'en',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('blocks unauthenticated writes entirely', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(anon, 'users', UID), {
        'preferences.language': 'en',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});
