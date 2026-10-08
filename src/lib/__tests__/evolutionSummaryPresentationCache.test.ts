import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseEvolutionSummaryPresentationCache,
  readEvolutionSummaryPresentationCache,
  removeEvolutionSummaryPresentationCache,
  writeEvolutionSummaryPresentationCache,
} from '../evolutionSummaryPresentationCache';
import type { ProgressingSummary } from '../../workoutEvolution/types';

const values = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  },
}));

const key = (uid: string) => `ajfit:evolution-summary-presentation:v1:${uid}`;
const summary: ProgressingSummary = {
  earnedLevel: 'ADVANCED',
  activeLevel: 'INTERMEDIATE',
  cycleNumber: 4,
  proximity: 'ON_TRACK',
  activeDays: 18,
  sessionsCompleted: 9,
  adherenceQuality: 'GOOD',
  isHistoryComplete: true,
  adherenceRatio: null,
  requiredActiveDays: 85,
  pausedAtLocalDate: null,
  intermediateCyclesEarned: null,
};

beforeEach(() => values.clear());

describe('Evolution summary presentation cache', () => {
  it('round-trips the valid minimal schema with no TTL', async () => {
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    const cached = await readEvolutionSummaryPresentationCache('A', 'program-A');
    expect(cached).toMatchObject({
      schemaVersion: 1,
      uid: 'A',
      programInstanceId: 'program-A',
      summary: { activeLevel: 'INTERMEDIATE', cycleNumber: 4, sessionsCompleted: 9 },
    });
    const raw = values.get(key('A'))!;
    expect(raw).not.toContain('earnedLevel');
    expect(raw).not.toContain('pending');
    expect(raw).not.toContain('action');
    expect(raw).not.toContain('isHistoryComplete');
  });

  it('rejects invalid JSON, unknown schema, malformed fields, and forbidden extra fields', async () => {
    values.set(key('A'), '{bad');
    expect(await readEvolutionSummaryPresentationCache('A', 'program-A')).toBe('invalid');
    expect(values.has(key('A'))).toBe(false);

    const valid = {
      schemaVersion: 1,
      uid: 'A',
      programInstanceId: 'program-A',
      updatedAt: Date.now(),
      summary: {
        activeLevel: 'BEGINNER', cycleNumber: 1, proximity: 'BUILDING',
        activeDays: 1, sessionsCompleted: 1, adherenceQuality: 'GOOD',
      },
    };
    expect(parseEvolutionSummaryPresentationCache(JSON.stringify({ ...valid, schemaVersion: 2 }), 'A', 'program-A')).toBeNull();
    expect(parseEvolutionSummaryPresentationCache(JSON.stringify({ ...valid, pending: {} }), 'A', 'program-A')).toBeNull();
    expect(parseEvolutionSummaryPresentationCache(JSON.stringify({ ...valid, summary: { ...valid.summary, cycleNumber: 0 } }), 'A', 'program-A')).toBeNull();
  });

  it('isolates UIDs and rejects a record whose embedded UID is wrong', async () => {
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    expect(await readEvolutionSummaryPresentationCache('B', 'program-A')).toBe('miss');
    const raw = values.get(key('A'))!;
    expect(parseEvolutionSummaryPresentationCache(raw, 'B', 'program-A')).toBeNull();
  });

  it('isolates ProgramInstance identity and removes the obsolete one-record-per-UID snapshot', async () => {
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    expect(await readEvolutionSummaryPresentationCache('A', 'program-B')).toBe('program-mismatch');
    expect(values.has(key('A'))).toBe(false);
  });

  it('treats first use as a harmless miss, then writes only after the caller supplies an authoritative summary', async () => {
    expect(await readEvolutionSummaryPresentationCache('A', 'program-A')).toBe('miss');
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    expect(await readEvolutionSummaryPresentationCache('A', 'program-A')).not.toBe('miss');
  });

  it('prevents an old queued write from resurrecting a cache after logout', async () => {
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    const oldWrite = writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    const remove = removeEvolutionSummaryPresentationCache('A');
    await Promise.all([oldWrite, remove]);
    expect(values.has(key('A'))).toBe(false);
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    expect(values.has(key('A'))).toBe(false);
  });

  it('allows the same UID to establish a fresh cache only after a new authenticated read', async () => {
    await removeEvolutionSummaryPresentationCache('A');
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    expect(values.has(key('A'))).toBe(false);
    expect(await readEvolutionSummaryPresentationCache('A', 'program-A')).toBe('miss');
    await writeEvolutionSummaryPresentationCache('A', 'program-A', summary);
    expect(await readEvolutionSummaryPresentationCache('A', 'program-A')).toMatchObject({ uid: 'A' });
  });
});
