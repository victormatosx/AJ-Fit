import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseProfilePresentationCache,
  readProfilePresentationCache,
  removeProfilePresentationCache,
  updateProfilePresentationCache,
  writeProfilePresentationCache,
} from '../profilePresentationCache';
import type { UserProfile, QuestionnaireDoc } from '../../services/userProfile';

const values = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  },
}));

const profile = { profile: { name: 'Ana' } } as UserProfile;
const questionnaire = { answers: { goal: 'strength', days: 3 } } as QuestionnaireDoc;
const key = (uid: string) => `ajfit:profile-presentation:v1:${uid}`;

beforeEach(() => values.clear());

describe('profile presentation cache', () => {
  it('misses on first install and hydrates an offline cold start after a server result', async () => {
    expect(await readProfilePresentationCache('A')).toBe('miss');
    await writeProfilePresentationCache('A', profile, questionnaire);
    const cached = await readProfilePresentationCache('A');
    expect(cached).toMatchObject({ uid: 'A', profile: { name: 'Ana' }, questionnaire: { goal: 'strength', days: 3 } });
  });

  it('rejects corrupt, incompatible, wrong UID and malformed records', async () => {
    values.set(key('A'), '{bad');
    expect(await readProfilePresentationCache('A')).toBe('invalid');
    expect(values.has(key('A'))).toBe(false);
    const valid = { schemaVersion: 1, uid: 'A', cachedAt: Date.now(), profile: { name: 'Ana' }, questionnaire: { goal: 'strength', days: 3 } };
    expect(parseProfilePresentationCache(JSON.stringify({ ...valid, schemaVersion: 2 }), 'A')).toBeNull();
    expect(parseProfilePresentationCache(JSON.stringify(valid), 'B')).toBeNull();
    expect(parseProfilePresentationCache(JSON.stringify({ ...valid, questionnaire: { goal: 'strength', days: 22 } }), 'A')).toBeNull();
  });

  it('allows stale display until a newer remote result replaces it', async () => {
    await writeProfilePresentationCache('A', profile, questionnaire);
    expect((await readProfilePresentationCache('A'))).toMatchObject({ profile: { name: 'Ana' } });
    await writeProfilePresentationCache('A', { profile: { name: 'Ana Nova' } } as UserProfile,
      { answers: { goal: 'conditioning', days: 4 } } as QuestionnaireDoc);
    expect(await readProfilePresentationCache('A')).toMatchObject({ profile: { name: 'Ana Nova' }, questionnaire: { days: 4 } });
  });

  it('accepts the current health goal and deprecated goals for offline presentation', () => {
    const base = { schemaVersion: 1, uid: 'A', cachedAt: Date.now(), profile: { name: 'Ana' } };
    for (const goal of ['health', 'body_composition', 'return_to_training']) {
      expect(parseProfilePresentationCache(JSON.stringify({
        ...base,
        questionnaire: { goal, days: 3 },
      }), 'A')).toMatchObject({ questionnaire: { goal } });
    }
  });

  it('writes through acknowledged profile and questionnaire changes', async () => {
    await writeProfilePresentationCache('A', profile, questionnaire);
    await updateProfilePresentationCache('A', { name: 'Ana Editada', questionnaire: { goal: 'strength', days: 5 } });
    expect(await readProfilePresentationCache('A')).toMatchObject({ profile: { name: 'Ana Editada' }, questionnaire: { days: 5 } });
  });

  it('isolates A from B and removes A on logout or account deletion', async () => {
    await writeProfilePresentationCache('A', profile, questionnaire);
    expect(await readProfilePresentationCache('B')).toBe('miss');
    await removeProfilePresentationCache('A');
    expect(await readProfilePresentationCache('A')).toBe('miss');
    expect(values.has(key('B'))).toBe(false);
  });

  it('prevents a queued old write from resurrecting a removed cache', async () => {
    await writeProfilePresentationCache('A', profile, questionnaire);
    const oldWrite = writeProfilePresentationCache('A', profile, questionnaire);
    const remove = removeProfilePresentationCache('A');
    await Promise.all([oldWrite, remove]);
    expect(values.has(key('A'))).toBe(false);
  });

  // This is a primitive-level guarantee, not the cross-UID network race
  // guard. A late Firestore response for a logged-out UID is discarded in
  // AuthContext (the `generation !== generationRef.current` check in
  // `loadUserState`) before it ever calls writeProfilePresentationCache — see
  // authContextConcurrencyStructure.test.ts for that guard. What this
  // primitive owns is disk-level: once removed, a UID stays blocked from new
  // writes until it is read again (which is what every real load does before
  // it writes), so a write issued after remove() can't resurrect stale data,
  // but reading the UID again does legitimately unblock it.
  it('ignores a write for a removed UID until that UID is read again, and unblocks on read', async () => {
    await writeProfilePresentationCache('A', profile, questionnaire);
    await removeProfilePresentationCache('A');
    await writeProfilePresentationCache('B', { profile: { name: 'Bia' } } as UserProfile,
      { answers: { goal: 'conditioning', days: 4 } } as QuestionnaireDoc);
    await writeProfilePresentationCache('A', profile, questionnaire);
    expect(values.has(key('A'))).toBe(false);
    expect(await readProfilePresentationCache('B')).toMatchObject({
      uid: 'B', profile: { name: 'Bia' }, questionnaire: { days: 4 },
    });
    expect(await readProfilePresentationCache('A')).toBe('miss');
    await writeProfilePresentationCache('A', profile, questionnaire);
    expect(await readProfilePresentationCache('A')).toMatchObject({ uid: 'A', profile: { name: 'Ana' } });
  });
});
