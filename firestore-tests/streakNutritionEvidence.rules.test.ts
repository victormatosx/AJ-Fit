import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

/**
 * Chama 2.0 — the two collections the nutrition evidence aggregate adds.
 *
 * The whole security argument is that `activeItemCount` is a SERVER fact: a
 * client able to write it could declare a streak day without eating anything.
 * The canonical timezone is the second: once pinned it must be immutable, or
 * travelling could re-date evidence that was already counted.
 */

let env: RulesTestEnvironment;
const db = (uid: string) => env.authenticatedContext(uid).firestore();
const days = (uid: string, localDate: string) => `users/${uid}/streakNutritionDays/${localDate}`;
const settings = (uid: string) => `users/${uid}/streakSettings/current`;
const validSettings = (overrides: Record<string, unknown> = {}) => ({
  timezone: 'America/Sao_Paulo', schemaVersion: 1, createdAt: serverTimestamp(), ...overrides,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'ajfit-rules-test',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    for (const uid of ['alice', 'mallory']) {
      await setDoc(doc(context.firestore(), `users/${uid}`), { accountStatus: 'active' });
    }
  });
});

describe('streakNutritionDays — server-owned, owner-readable', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), days('alice', '2026-10-19')), {
        localDate: '2026-10-19', activeItemCount: 3, timezone: 'America/Sao_Paulo',
        schemaVersion: 1, updatedAt: Timestamp.now(),
      });
    });
  });

  it('lets the owner read the aggregate — this is what keeps the streak at one query', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), days('alice', '2026-10-19'))));
  });

  it('never lets anyone else read it', async () => {
    await assertFails(getDoc(doc(db('mallory'), days('alice', '2026-10-19'))));
  });

  it('refuses every client write, including the owner declaring a count', async () => {
    const own = doc(db('alice'), days('alice', '2026-10-20'));
    await assertFails(setDoc(own, {
      localDate: '2026-10-20', activeItemCount: 1, timezone: 'America/Sao_Paulo',
      schemaVersion: 1, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db('alice'), days('alice', '2026-10-19')), { activeItemCount: 99 }));
    await assertFails(deleteDoc(doc(db('alice'), days('alice', '2026-10-19'))));
    await assertFails(setDoc(doc(db('mallory'), days('alice', '2026-10-21')), { activeItemCount: 1 }));
  });

  it('keeps the stored count untouched after a rejected write', async () => {
    await assertFails(updateDoc(doc(db('alice'), days('alice', '2026-10-19')), { activeItemCount: 0 }));
    let stored: unknown;
    await env.withSecurityRulesDisabled(async (context) => {
      stored = (await getDoc(doc(context.firestore(), days('alice', '2026-10-19')))).get('activeItemCount');
    });
    expect(stored).toBe(3);
  });
});

describe('streakSettings — create-once canonical timezone', () => {
  it('lets the owner pin the zone exactly once', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), settings('alice')), validSettings()));
    // Immutable afterwards: no update, no delete, no re-create with another zone.
    await assertFails(setDoc(doc(db('alice'), settings('alice')), validSettings({ timezone: 'UTC' })));
    await assertFails(updateDoc(doc(db('alice'), settings('alice')), { timezone: 'UTC' }));
    await assertFails(deleteDoc(doc(db('alice'), settings('alice'))));
  });

  it('refuses the backend-only bookkeeping fields on create', async () => {
    await assertFails(setDoc(doc(db('alice'), settings('alice')),
      validSettings({ nutritionEvidenceFrom: '2020-01-01' })));
    await assertFails(setDoc(doc(db('alice'), settings('alice')),
      validSettings({ nutritionRevocations: 0 })));
  });

  it('refuses a forged createdAt, a fixed-offset zone and a junk schema version', async () => {
    await assertFails(setDoc(doc(db('alice'), settings('alice')),
      validSettings({ createdAt: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(doc(db('alice'), settings('alice')), validSettings({ timezone: '-03:00' })));
    await assertFails(setDoc(doc(db('alice'), settings('alice')), validSettings({ timezone: '' })));
    await assertFails(setDoc(doc(db('alice'), settings('alice')), validSettings({ schemaVersion: 0 })));
    await assertFails(setDoc(doc(db('alice'), settings('alice')), validSettings({ schemaVersion: '1' })));
  });

  it('only accepts the `current` document id', async () => {
    await assertFails(setDoc(doc(db('alice'), `users/alice/streakSettings/other`), validSettings()));
  });

  it('isolates accounts in both directions', async () => {
    await assertFails(setDoc(doc(db('mallory'), settings('alice')), validSettings()));
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), settings('alice')), {
        timezone: 'America/Sao_Paulo', schemaVersion: 1, createdAt: Timestamp.now(),
        nutritionEvidenceFrom: '2026-10-19', nutritionRevocations: 2,
      });
    });
    await assertSucceeds(getDoc(doc(db('alice'), settings('alice'))));
    await assertFails(getDoc(doc(db('mallory'), settings('alice'))));
  });

  it('cannot be written or read while the account is under a deletion lock', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'accountDeletionLocks/alice'), { lockedAt: Timestamp.now() });
    });
    await assertFails(setDoc(doc(db('alice'), settings('alice')), validSettings()));
    await assertFails(getDoc(doc(db('alice'), days('alice', '2026-10-19'))));
  });
});
