import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFrequencyWindow } from '../../home/frequencyHeatmap';
import {
  parseHomePresentationSnapshot,
  projectCachedFrequency,
  readHomePresentationSnapshot,
  removeHomePresentationSnapshot,
  writeHomePresentationSnapshot,
} from '../homePresentationSnapshot';

const values = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  },
}));
const key = (uid: string) => `ajfit:home-presentation:v1:${uid}`;

beforeEach(() => values.clear());

async function save(uid = 'A', today = '2026-09-22') {
  await writeHomePresentationSnapshot({
    uid,
    timezone: 'America/Sao_Paulo',
    frequency: buildFrequencyWindow({
      todayLocalDate: today,
      offsetWindows: 0,
      completedDates: new Set(['2026-09-20', '2026-09-22']),
    }),
  });
}

describe('Home presentation snapshot', () => {
  it('misses on first launch, then stores historical dates only', async () => {
    expect(await readHomePresentationSnapshot('A')).toBeNull();
    await save();
    const snapshot = await readHomePresentationSnapshot('A');
    expect(snapshot?.sections.frequency.completedLocalDates).toEqual(['2026-09-20', '2026-09-22']);
    const raw = values.get(key('A'))!;
    for (const forbidden of ['pending', 'earned', 'lifecycle', 'entitlement', 'onStart', 'prescription', 'scheduleResolution']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('rebases history over midnight without presenting a new-day completion as known', async () => {
    await save();
    const snapshot = (await readHomePresentationSnapshot('A'))!;
    const nextDay = projectCachedFrequency(snapshot, new Date('2026-09-23T12:00:00Z'))!;
    expect(nextDay.endLocalDate).toBe('2026-09-23');
    expect(nextDay.days.at(-1)).toMatchObject({ localDate: '2026-09-23', completed: false });
    expect(snapshot.sections.frequency.throughLocalDate).toBe('2026-09-22');
  });

  it('isolates UIDs and never serializes a program-specific claim', async () => {
    await save('A');
    expect(await readHomePresentationSnapshot('B')).toBeNull();
    expect(parseHomePresentationSnapshot(values.get(key('A'))!, 'B')).toBeNull();
    expect(values.get(key('A'))).not.toContain('programInstanceId');
  });

  it('rejects corrupt JSON, extra fields, invalid dates and a future window', async () => {
    values.set(key('A'), '{broken');
    expect(await readHomePresentationSnapshot('A')).toBeNull();
    expect(values.has(key('A'))).toBe(false);
    await save();
    const valid = JSON.parse(values.get(key('A'))!);
    expect(parseHomePresentationSnapshot(JSON.stringify({ ...valid, schemaVersion: 2 }), 'A')).toBeNull();
    expect(parseHomePresentationSnapshot(JSON.stringify({ ...valid, pending: true }), 'A')).toBeNull();
    expect(parseHomePresentationSnapshot(JSON.stringify({ ...valid, sections: { frequency: { ...valid.sections.frequency, completedLocalDates: ['2026-02-30'] } } }), 'A')).toBeNull();
    expect(parseHomePresentationSnapshot(JSON.stringify({ ...valid, sections: { frequency: { ...valid.sections.frequency, completedLocalDates: ['2026-01-01'] } } }), 'A')).toBeNull();
    expect(projectCachedFrequency(valid, new Date('2026-09-21T12:00:00Z'))).toBeNull();
  });

  it('rejects a non-current frequency window as a write source', async () => {
    await writeHomePresentationSnapshot({
      uid: 'A', timezone: 'UTC',
      frequency: buildFrequencyWindow({ todayLocalDate: '2026-09-22', offsetWindows: 1, completedDates: new Set() }),
    });
    expect(values.has(key('A'))).toBe(false);
  });

  it('prevents a queued write from resurrecting data after logout', async () => {
    await save();
    const oldWrite = save();
    const removal = removeHomePresentationSnapshot('A');
    await Promise.all([oldWrite, removal]);
    expect(values.has(key('A'))).toBe(false);
    await save();
    expect(values.has(key('A'))).toBe(false);
    await readHomePresentationSnapshot('A');
    await save();
    expect(values.has(key('A'))).toBe(true);
  });
});
