/**
 * Firestore Rules — `exercises/{exerciseId}` (docs/27_biblioteca_de_exercicios.md).
 *
 * Executed against the Firestore emulator (`test:rules` npm script). Global
 * exercise library: readable by any signed-in user. Writable only by
 * `scripts/seedExercises.ts` (Admin SDK, bypasses rules) and, since the
 * ajfit-admin panel got exercise CRUD, by an authenticated admin
 * (`isAdmin()` — `users/{uid}.metadata.role == 'admin'`, same mechanism as
 * `supportTickets`). Hard delete stays denied even for admins (docs/27 §8
 * — exercises may be referenced by workout history; deactivate via
 * `status` instead).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'ajfit-rules-test';
const EXERCISE_ID = 'barbell-back-squat';
const ADMIN_UID = 'exercises-admin';

let testEnv: RulesTestEnvironment;

function signedInDb() {
  return testEnv.authenticatedContext('alice', {
    email_verified: true,
    firebase: { identities: { email: ['alice@example.com'] }, sign_in_provider: 'password' },
  }).firestore();
}

function passwordDb(verified: boolean) {
  return testEnv.authenticatedContext('alice', {
    email_verified: verified,
    firebase: { identities: { email: ['alice@example.com'] }, sign_in_provider: 'password' },
  }).firestore();
}

function socialDb(provider: 'google.com' | 'apple.com') {
  return testEnv.authenticatedContext('alice', {
    email_verified: false,
    firebase: { identities: { [provider]: ['provider-subject'] }, sign_in_provider: provider },
  }).firestore();
}

function adminDb() {
  return testEnv.authenticatedContext(ADMIN_UID).firestore();
}

async function seedAdminRole() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ADMIN_UID), {
      profile: { name: 'Exercises Admin', email: `${ADMIN_UID}@example.com` },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'admin', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

function validExerciseData(overrides: Record<string, unknown> = {}) {
  return {
    id: EXERCISE_ID,
    slug: EXERCISE_ID,
    name: { ptBR: 'Agachamento Livre', en: 'Barbell Back Squat', es: 'Sentadilla Libre con Barra' },
    status: 'active',
    difficulty: 'intermediate',
    target: { primaryMuscle: 'quads', secondaryMuscles: [] },
    movement: { pattern: 'squat', mechanic: 'compound', laterality: 'bilateral' },
    equipment: ['barbell'],
    execution: {},
    substitution: { similarExerciseIds: [] },
    availability: { workoutGeneration: true, manualSelection: true, substitution: true },
    metadata: { version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
    ...overrides,
  };
}

function validLimitationProfile(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    protocolVersion: 'musculoskeletal-v1',
    reviewStatus: 'approved',
    reviewBasis: 'product_policy',
    regions: {
      knee: { status: 'not_applicable' },
      hip: { status: 'compatible' },
      back: {
        status: 'avoid',
        substituteExerciseIds: [],
        candidateStatus: 'missing_exercise_candidate',
      },
      shoulder: {
        status: 'adapt',
        adaptation: { kind: 'exercise_variant', exerciseId: 'machine-shoulder-press' },
      },
      elbow: { status: 'compatible' },
      wrist: {
        status: 'avoid',
        substituteExerciseIds: ['wall-push-up'],
        candidateStatus: 'ready',
      },
      ankle_foot: { status: 'not_applicable' },
    },
    ...overrides,
  };
}

async function updateLimitationProfile(profile: Record<string, unknown>) {
  return updateDoc(doc(adminDb(), 'exercises', EXERCISE_ID), {
    limitationProfile: profile,
    'metadata.updatedAt': serverTimestamp(),
  });
}

async function seedExercise() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), {
      id: EXERCISE_ID,
      slug: EXERCISE_ID,
      name: { ptBR: 'Agachamento Livre', en: 'Barbell Back Squat', es: 'Sentadilla Libre con Barra' },
      status: 'active',
      difficulty: 'intermediate',
      metadata: { version: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedExercise();
  await seedAdminRole();
});

describe('exercises — read', () => {
  it('allows a signed-in user to read an exercise', async () => {
    await assertSucceeds(getDoc(doc(signedInDb(), 'exercises', EXERCISE_ID)));
  });

  it('blocks an unauthenticated user from reading an exercise', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'exercises', EXERCISE_ID)));
  });

  it('blocks an unverified Email/Password user', async () => {
    await assertFails(getDoc(doc(passwordDb(false), 'exercises', EXERCISE_ID)));
  });

  it.each(['google.com', 'apple.com'] as const)('preserves social-only %s access', async (provider) => {
    await assertSucceeds(getDoc(doc(socialDb(provider), 'exercises', EXERCISE_ID)));
  });

  it('blocks an unverified linked password + social identity', async () => {
    const db = testEnv.authenticatedContext('alice', {
      email_verified: false,
      firebase: {
        identities: { email: ['alice@example.com'], 'google.com': ['provider-subject'] },
        sign_in_provider: 'google.com',
      },
    }).firestore();
    await assertFails(getDoc(doc(db, 'exercises', EXERCISE_ID)));
  });
});

describe('exercises — write', () => {
  it('blocks a signed-in user from updating an exercise', async () => {
    await assertFails(
      updateDoc(doc(signedInDb(), 'exercises', EXERCISE_ID), { status: 'inactive' }),
    );
  });

  it('blocks a signed-in user from creating a new exercise', async () => {
    await assertFails(
      setDoc(doc(signedInDb(), 'exercises', 'made-up-exercise'), { status: 'active' }),
    );
  });

  it('blocks a signed-in user from deleting an exercise', async () => {
    await assertFails(deleteDoc(doc(signedInDb(), 'exercises', EXERCISE_ID)));
  });

  it('blocks an unauthenticated user from writing an exercise', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, 'exercises', EXERCISE_ID), { status: 'active' }));
  });
});

describe('exercises — admin write (ajfit-admin panel)', () => {
  it('lets an admin create a new, valid exercise', async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), 'exercises', 'made-up-exercise'), validExerciseData({ id: 'made-up-exercise', slug: 'made-up-exercise' })),
    );
  });

  it('lets an admin update an existing exercise, preserving createdAt/version', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), validExerciseData({
        metadata: { version: 1, createdAt: Timestamp.fromMillis(1000), updatedAt: Timestamp.fromMillis(1000) },
      }));
    });
    await assertSucceeds(
      updateDoc(doc(adminDb(), 'exercises', EXERCISE_ID), {
        status: 'inactive',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('lets an admin attach a video reference to a seeded exercise without a stored id field', async () => {
    // Production seed documents use the document id as identity and omit the
    // duplicated body.id (`seedExercises.ts` destructures it out before the
    // write). This fixture intentionally uses that exact persisted shape.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { id: _id, ...persistedSeedShape } = validExerciseData({
        metadata: { version: 1, createdAt: Timestamp.fromMillis(1000), updatedAt: Timestamp.fromMillis(1000) },
      });
      await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), persistedSeedShape);
    });

    const ref = doc(adminDb(), 'exercises', EXERCISE_ID);
    const before = await getDoc(ref);
    expect(before.data()).not.toHaveProperty('id');

    await assertSucceeds(
      updateDoc(ref, {
        'execution.videos.vertical': {
          url: 'https://firebasestorage.googleapis.com/example.webm',
          storagePath: `exercises/${EXERCISE_ID}/execution/vertical.webm`,
        },
        'metadata.updatedAt': serverTimestamp(),
      }),
    );

    const after = await getDoc(ref);
    expect(after.get('execution.videos.vertical.storagePath')).toBe(
      `exercises/${EXERCISE_ID}/execution/vertical.webm`,
    );
  });

  it('blocks an admin from creating an exercise whose id/slug do not match the document id', async () => {
    await assertFails(
      setDoc(doc(adminDb(), 'exercises', 'made-up-exercise'), validExerciseData({ id: 'other-id', slug: 'other-id' })),
    );
  });

  it('blocks an admin from adding a mismatched body id to a seeded exercise', async () => {
    await assertFails(
      updateDoc(doc(adminDb(), 'exercises', EXERCISE_ID), {
        id: 'different-exercise',
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('blocks an admin from rewriting metadata.createdAt on update', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), validExerciseData({
        metadata: { version: 1, createdAt: Timestamp.fromMillis(1000), updatedAt: Timestamp.fromMillis(1000) },
      }));
    });
    await assertFails(
      updateDoc(doc(adminDb(), 'exercises', EXERCISE_ID), {
        'metadata.createdAt': serverTimestamp(),
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('blocks an admin from incrementing metadata.version on update', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), validExerciseData({
        metadata: { version: 1, createdAt: Timestamp.fromMillis(1000), updatedAt: Timestamp.fromMillis(1000) },
      }));
    });
    await assertFails(
      updateDoc(doc(adminDb(), 'exercises', EXERCISE_ID), {
        'metadata.version': 2,
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });

  it('blocks an admin from deleting an exercise', async () => {
    await assertFails(deleteDoc(doc(adminDb(), 'exercises', EXERCISE_ID)));
  });
});

describe('exercises — limitationProfile validation', () => {
  it('accepts an approved product-policy profile with all rule variants', async () => {
    await assertSucceeds(updateLimitationProfile(validLimitationProfile()));
  });

  it('accepts a professional-review profile only with real audit fields', async () => {
    await assertSucceeds(updateLimitationProfile(validLimitationProfile({
      reviewBasis: 'professional_review',
      reviewedAt: Timestamp.now(),
      reviewedBy: 'professional-review-record-id',
    })));
  });

  it.each([
    ['unknown status', () => validLimitationProfile({
      regions: { ...validLimitationProfile().regions, hip: { status: 'unknown' } },
    })],
    ['missing region', () => {
      const { ankle_foot: _removed, ...regions } = validLimitationProfile().regions;
      return validLimitationProfile({ regions });
    }],
    ['extra region', () => validLimitationProfile({
      regions: { ...validLimitationProfile().regions, neck: { status: 'compatible' } },
    })],
    ['unexpected profile field', () => validLimitationProfile({ clinicalApproval: true })],
    ['unexpected rule field', () => validLimitationProfile({
      regions: { ...validLimitationProfile().regions, hip: { status: 'compatible', note: 'extra' } },
    })],
    ['adapt without adaptation', () => validLimitationProfile({
      regions: { ...validLimitationProfile().regions, shoulder: { status: 'adapt' } },
    })],
    ['adapt with self-reference', () => validLimitationProfile({
      regions: {
        ...validLimitationProfile().regions,
        shoulder: { status: 'adapt', adaptation: { kind: 'exercise_variant', exerciseId: EXERCISE_ID } },
      },
    })],
    ['avoid empty without missing marker', () => validLimitationProfile({
      regions: {
        ...validLimitationProfile().regions,
        back: { status: 'avoid', substituteExerciseIds: [], candidateStatus: 'ready' },
      },
    })],
    ['duplicate substitutes', () => validLimitationProfile({
      regions: {
        ...validLimitationProfile().regions,
        wrist: {
          status: 'avoid',
          substituteExerciseIds: ['wall-push-up', 'wall-push-up'],
          candidateStatus: 'ready',
        },
      },
    })],
    ['product policy with fake professional identity', () => validLimitationProfile({
      reviewedAt: Timestamp.now(),
      reviewedBy: 'fake-reviewer',
    })],
  ])('rejects %s', async (_label, buildProfile) => {
    await assertFails(updateLimitationProfile(buildProfile()));
  });

  it('rejects professional_review without reviewer/timestamp', async () => {
    await assertFails(updateLimitationProfile(validLimitationProfile({ reviewBasis: 'professional_review' })));
  });

  it('prevents removal of an existing approved profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'exercises', EXERCISE_ID), {
        id: EXERCISE_ID,
        slug: EXERCISE_ID,
        name: { ptBR: 'Agachamento Livre', en: 'Barbell Back Squat', es: 'Sentadilla Libre con Barra' },
        status: 'active',
        difficulty: 'intermediate',
        limitationProfile: validLimitationProfile(),
        metadata: { version: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      });
    });
    await assertFails(
      updateDoc(doc(adminDb(), 'exercises', EXERCISE_ID), {
        limitationProfile: deleteField(),
        'metadata.updatedAt': serverTimestamp(),
      }),
    );
  });
});
