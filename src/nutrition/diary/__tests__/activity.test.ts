import { describe, expect, it } from 'vitest';

import {
  activityLocalDateForItem,
  canonicalStreakTimezone,
  isStreakLocalDate,
  nutritionActivityDeltas,
  nutritionActivityLocalDate,
  nutritionDayIsActive,
  resolveActivityDayWrite,
} from '../activity';
import { localDateInTimezone } from '../../../scheduleEngine/localDate';

const SP = 'America/Sao_Paulo';
const instant = (iso: string) => new Date(iso);
const stamp = (iso: string) => ({ toDate: () => new Date(iso) });

describe('nutritionActivityLocalDate — the server instant decides the day', () => {
  it('resolves the day in the canonical zone, not UTC', () => {
    // 2026-10-19T02:00Z is still the 18th in São Paulo (UTC-3).
    expect(nutritionActivityLocalDate(instant('2026-10-19T02:00:00Z'), SP)).toBe('2026-10-18');
    expect(nutritionActivityLocalDate(instant('2026-10-19T02:00:00Z'), 'UTC')).toBe('2026-10-19');
  });

  it('crosses local midnight exactly once', () => {
    expect(nutritionActivityLocalDate(instant('2026-10-19T02:59:59Z'), SP)).toBe('2026-10-18');
    expect(nutritionActivityLocalDate(instant('2026-10-19T03:00:00Z'), SP)).toBe('2026-10-19');
  });

  it('agrees with the workout engine’s resolver across zones and DST', () => {
    // Pins the deliberate duplication in `activity.ts` (see its doc comment).
    const instants = [
      '2026-01-01T00:00:00Z', '2026-03-29T01:30:00Z', '2026-06-15T12:00:00Z',
      '2026-10-25T00:30:00Z', '2026-10-19T02:00:00Z', '2026-12-31T23:59:59Z',
    ];
    const zones = [SP, 'UTC', 'Europe/Lisbon', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati'];
    for (const iso of instants) {
      for (const zone of zones) {
        expect(nutritionActivityLocalDate(instant(iso), zone)).toBe(localDateInTimezone(instant(iso), zone));
      }
    }
  });
});

describe('canonicalStreakTimezone', () => {
  it('accepts named IANA zones and UTC', () => {
    expect(canonicalStreakTimezone(SP)).toBe(SP);
    expect(canonicalStreakTimezone('UTC')).toBe('UTC');
  });

  it('rejects fixed offsets, empty values and junk', () => {
    for (const value of ['-03:00', '+0200', '', 'Not/AZone', null, undefined, 42, 'x'.repeat(65)]) {
      expect(canonicalStreakTimezone(value)).toBeNull();
    }
  });
});

describe('activityLocalDateForItem — frozen date wins, loggedAt is the fallback', () => {
  it('prefers the persisted activityLocalDate', () => {
    expect(activityLocalDateForItem(
      { activityLocalDate: '2026-10-18', loggedAt: stamp('2026-10-25T12:00:00Z') }, SP,
    )).toBe('2026-10-18');
  });

  it('falls back to loggedAt for items written before the field existed', () => {
    expect(activityLocalDateForItem({ loggedAt: stamp('2026-10-19T02:00:00Z') }, SP)).toBe('2026-10-18');
  });

  it('ignores a malformed activityLocalDate instead of trusting it', () => {
    expect(activityLocalDateForItem(
      { activityLocalDate: '19/10/2026', loggedAt: stamp('2026-10-19T12:00:00Z') }, SP,
    )).toBe('2026-10-19');
  });

  it('returns null when neither fact is readable — never fabricates a day', () => {
    expect(activityLocalDateForItem({}, SP)).toBeNull();
    expect(activityLocalDateForItem({ loggedAt: 'nope' }, SP)).toBeNull();
  });
});

describe('nutritionActivityDeltas — only real creations and deletions move a day', () => {
  const monday = { activityLocalDate: '2026-10-19' };
  const sunday = { activityLocalDate: '2026-10-18' };

  it('credits one per created item on the day it was confirmed', () => {
    const deltas = nutritionActivityDeltas({ created: [monday, monday, monday], removed: [], timezone: SP });
    expect([...deltas]).toEqual([['2026-10-19', 3]]);
  });

  it('debits the day the deleted item originally earned, not today', () => {
    const deltas = nutritionActivityDeltas({ created: [], removed: [sunday], timezone: SP });
    expect([...deltas]).toEqual([['2026-10-18', -1]]);
  });

  it('writes nothing for an edit or a move (no created, no removed)', () => {
    expect([...nutritionActivityDeltas({ created: [], removed: [], timezone: SP })]).toEqual([]);
  });

  it('cancels a create and a delete landing on the same day', () => {
    expect([...nutritionActivityDeltas({ created: [monday], removed: [monday], timezone: SP })]).toEqual([]);
  });

  it('keeps two different days separate in one operation', () => {
    const deltas = nutritionActivityDeltas({ created: [monday], removed: [sunday], timezone: SP });
    expect(deltas.get('2026-10-19')).toBe(1);
    expect(deltas.get('2026-10-18')).toBe(-1);
  });

  it('skips items whose activity day cannot be proven', () => {
    expect([...nutritionActivityDeltas({ created: [{}], removed: [{}], timezone: SP })]).toEqual([]);
  });
});

describe('resolveActivityDayWrite — every abnormal case is named, never clamped', () => {
  const FLOOR = '2026-10-01';
  const above = (overrides: Partial<Parameters<typeof resolveActivityDayWrite>[0]> = {}) =>
    resolveActivityDayWrite({
      exists: true, storedCount: 3, delta: 1, localDate: '2026-10-19', evidenceFrom: FLOOR, ...overrides,
    });

  it('increments and decrements normally', () => {
    expect(above({ delta: 1 })).toEqual({ status: 'WRITE', activeItemCount: 4 });
    expect(above({ delta: -2 })).toEqual({ status: 'WRITE', activeItemCount: 1 });
  });

  it('persists the LEGITIMATE zero — the last evidence of the day was deleted', () => {
    expect(above({ storedCount: 1, delta: -1 })).toEqual({ status: 'WRITE', activeItemCount: 0 });
  });

  it('opens a day’s counter at its own size when the aggregate is absent', () => {
    expect(above({ exists: false, storedCount: undefined, delta: 7 }))
      .toEqual({ status: 'WRITE', activeItemCount: 7 });
  });

  describe('a DUPLICATED decrement above the floor is a defect, not a zero', () => {
    it('refuses to go below zero', () => {
      expect(above({ storedCount: 0, delta: -1 }))
        .toEqual({ status: 'INCONSISTENT', reason: 'DECREMENT_BELOW_ZERO' });
      expect(above({ storedCount: 1, delta: -3 }))
        .toEqual({ status: 'INCONSISTENT', reason: 'DECREMENT_BELOW_ZERO' });
    });

    it('refuses a decrement whose aggregate vanished', () => {
      expect(above({ exists: false, storedCount: undefined, delta: -1 }))
        .toEqual({ status: 'INCONSISTENT', reason: 'MISSING_AGGREGATE' });
    });
  });

  describe('a LEGACY item below the floor is provably a no-op, not a defect', () => {
    it('skips a decrement for a day the counter never tracked', () => {
      expect(above({ exists: false, storedCount: undefined, delta: -1, localDate: '2026-09-15' }))
        .toEqual({ status: 'SKIP', reason: 'BELOW_EVIDENCE_FLOOR' });
      expect(above({ storedCount: 0, delta: -1, localDate: '2026-09-15' }))
        .toEqual({ status: 'SKIP', reason: 'BELOW_EVIDENCE_FLOOR' });
    });

    it('skips when the counter never ran for the account at all', () => {
      expect(above({ exists: false, storedCount: undefined, delta: -1, evidenceFrom: null }))
        .toEqual({ status: 'SKIP', reason: 'BELOW_EVIDENCE_FLOOR' });
    });

    it('still honours a real stored count below the floor instead of skipping blindly', () => {
      expect(above({ storedCount: 2, delta: -1, localDate: '2026-09-15' }))
        .toEqual({ status: 'WRITE', activeItemCount: 1 });
    });

    it('treats the floor date itself as covered', () => {
      expect(above({ exists: false, storedCount: undefined, delta: -1, localDate: FLOOR }))
        .toEqual({ status: 'INCONSISTENT', reason: 'MISSING_AGGREGATE' });
    });
  });

  describe('a CORRUPTED stored count never becomes a rebuild base', () => {
    it('refuses both directions rather than erasing other items’ credit', () => {
      for (const corrupt of [-5, 1.5, 'three', null, {}, Number.NaN]) {
        expect(above({ storedCount: corrupt, delta: 1 }))
          .toEqual({ status: 'INCONSISTENT', reason: 'CORRUPT_STORED_COUNT' });
        expect(above({ storedCount: corrupt, delta: -1 }))
          .toEqual({ status: 'INCONSISTENT', reason: 'CORRUPT_STORED_COUNT' });
      }
    });

    it('reports corruption even below the floor — a present document must be valid', () => {
      expect(above({ storedCount: -2, delta: -1, localDate: '2026-09-15' }))
        .toEqual({ status: 'INCONSISTENT', reason: 'CORRUPT_STORED_COUNT' });
    });
  });
});

describe('nutritionDayIsActive — the day counts only while an item survives', () => {
  it('is active above zero', () => {
    expect(nutritionDayIsActive({ activeItemCount: 1 })).toBe(true);
    expect(nutritionDayIsActive({ activeItemCount: 7 })).toBe(true);
  });

  it('is inactive at zero, missing or corrupted', () => {
    expect(nutritionDayIsActive({ activeItemCount: 0 })).toBe(false);
    expect(nutritionDayIsActive({})).toBe(false);
    expect(nutritionDayIsActive(null)).toBe(false);
    expect(nutritionDayIsActive({ activeItemCount: -1 })).toBe(false);
    expect(nutritionDayIsActive({ activeItemCount: 'many' })).toBe(false);
  });
});

describe('isStreakLocalDate', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isStreakLocalDate('2026-10-19')).toBe(true);
    for (const value of ['2026-1-9', '19-10-2026', '2026/10/19', '', null, 20261019]) {
      expect(isStreakLocalDate(value)).toBe(false);
    }
  });
});
