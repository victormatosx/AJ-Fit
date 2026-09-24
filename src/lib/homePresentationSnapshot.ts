import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FrequencyWindowViewModel } from '../home/frequencyHeatmap';
import { buildFrequencyWindow, frequencyWindowBounds } from '../home/frequencyHeatmap';
import { localDateInTimezone } from '../scheduleEngine/localDate';

/** Historical visual facts only. No schedule, lifecycle, action or authority state. */
export type HomePresentationSnapshot = {
  schemaVersion: 1;
  uid: string;
  updatedAt: number;
  sections: {
    frequency: {
      timezone: string;
      throughLocalDate: string;
      completedLocalDates: string[];
    };
  };
};

const keyFor = (uid: string) => `ajfit:home-presentation:v1:${uid}`;
const blockedUids = new Set<string>();
const pendingByUid = new Map<string, Promise<void>>();

function enqueue(uid: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingByUid.get(uid) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  pendingByUid.set(uid, pending);
  void pending.finally(() => {
    if (pendingByUid.get(uid) === pending) pendingByUid.delete(uid);
  }).catch(() => undefined);
  return pending;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function localDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseHomePresentationSnapshot(raw: string, uid: string): HomePresentationSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !keys(value, ['schemaVersion', 'uid', 'updatedAt', 'sections']) ||
        value.schemaVersion !== 1 || value.uid !== uid ||
        typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) ||
        value.updatedAt < 0 || value.updatedAt > Date.now() + 60_000 ||
        !record(value.sections) || !keys(value.sections, ['frequency']) ||
        !record(value.sections.frequency) || !keys(value.sections.frequency, [
          'timezone', 'throughLocalDate', 'completedLocalDates',
        ])) return null;
    const frequency = value.sections.frequency;
    const through = frequency.throughLocalDate;
    const windowStart = localDate(through) ? frequencyWindowBounds(through, 0).startLocalDate : null;
    if (typeof frequency.timezone !== 'string' || frequency.timezone.length < 1 ||
        frequency.timezone.length > 100 || !localDate(frequency.throughLocalDate) ||
        !Array.isArray(frequency.completedLocalDates) || frequency.completedLocalDates.length > 30 ||
        !frequency.completedLocalDates.every((date) => localDate(date) && windowStart !== null &&
          date >= windowStart && date <= (frequency.throughLocalDate as string)) ||
        new Set(frequency.completedLocalDates).size !== frequency.completedLocalDates.length) return null;
    try {
      new Intl.DateTimeFormat('en', { timeZone: frequency.timezone });
    } catch { return null; }
    return value as HomePresentationSnapshot;
  } catch { return null; }
}

/** Rebase known historical completions; dates after the read remain unknown in the UI. */
export function projectCachedFrequency(snapshot: HomePresentationSnapshot, now: Date): FrequencyWindowViewModel | null {
  const today = localDateInTimezone(now, snapshot.sections.frequency.timezone);
  const through = snapshot.sections.frequency.throughLocalDate;
  const { startLocalDate } = frequencyWindowBounds(today, 0);
  if (through > today || through < startLocalDate) return null;
  return buildFrequencyWindow({
    todayLocalDate: today,
    offsetWindows: 0,
    completedDates: new Set(snapshot.sections.frequency.completedLocalDates),
  });
}

export async function readHomePresentationSnapshot(uid: string): Promise<HomePresentationSnapshot | null> {
  blockedUids.delete(uid);
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (raw === null) return null;
    const parsed = parseHomePresentationSnapshot(raw, uid);
    if (parsed) return parsed;
    await enqueue(uid, async () => {
      if (await AsyncStorage.getItem(keyFor(uid)) === raw) await AsyncStorage.removeItem(keyFor(uid));
    }).catch(() => undefined);
    return null;
  } catch { return null; }
}

/** Caller must provide a successful authoritative initial Home resolution. */
export async function writeHomePresentationSnapshot(input: {
  uid: string;
  timezone: string;
  frequency: FrequencyWindowViewModel;
}): Promise<void> {
  if (!input.uid || input.frequency.offsetWindows !== 0 || !input.frequency.isCurrentWindow ||
      input.frequency.days.length !== 30 ||
      input.frequency.days[0]?.localDate !== input.frequency.startLocalDate ||
      input.frequency.days[29]?.localDate !== input.frequency.endLocalDate ||
      input.frequency.completedCount !== input.frequency.days.filter((day) => day.completed).length) return;
  const value: HomePresentationSnapshot = {
    schemaVersion: 1,
    uid: input.uid,
    updatedAt: Date.now(),
    sections: { frequency: {
      timezone: input.timezone,
      throughLocalDate: input.frequency.endLocalDate,
      completedLocalDates: input.frequency.days.filter((day) => day.completed).map((day) => day.localDate),
    } },
  };
  if (!parseHomePresentationSnapshot(JSON.stringify(value), input.uid)) return;
  await enqueue(input.uid, async () => {
    if (!blockedUids.has(input.uid)) await AsyncStorage.setItem(keyFor(input.uid), JSON.stringify(value));
  });
}

export async function removeHomePresentationSnapshot(uid: string): Promise<void> {
  blockedUids.add(uid);
  await enqueue(uid, () => AsyncStorage.removeItem(keyFor(uid)));
}
