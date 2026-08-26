/**
 * Data-integrity guard for the free-exercise-db fallback mapping
 * (`exerciseFallbackVideoMap.ts`) — this table is hand-curated, not
 * derived, so nothing else catches a typo'd key/id or a stale entry left
 * behind after a catalog rename.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXERCISES_SEED } from '../exercisesSeedData';
import { EXERCISE_FALLBACK_VIDEO_ID } from '../exerciseFallbackVideoMap';

describe('EXERCISE_FALLBACK_VIDEO_ID', () => {
  const catalogIds = new Set(EXERCISES_SEED.map((exercise) => exercise.id));

  it('every key is a real, current exercise catalog id', () => {
    const staleKeys = Object.keys(EXERCISE_FALLBACK_VIDEO_ID).filter((id) => !catalogIds.has(id));
    expect(staleKeys).toEqual([]);
  });

  it('every value looks like a free-exercise-db id (non-empty, no our-style lowercase-hyphen slug)', () => {
    for (const [ourId, dbId] of Object.entries(EXERCISE_FALLBACK_VIDEO_ID)) {
      expect(dbId.length, `${ourId} -> ${dbId}`).toBeGreaterThan(0);
      // free-exercise-db ids are Title_Case_With_Underscores — never
      // identical to our own lowercase-hyphen slug (that would mean the
      // entry is a copy-paste of the key, not a real mapping).
      expect(dbId, `${ourId} -> ${dbId} looks unmapped (copied the key)`).not.toBe(ourId);
    }
  });

  it('has no duplicate our-id keys (object literal would silently keep only the last one)', () => {
    // TS object literals can't have runtime-duplicate keys after parsing —
    // this guards the SOURCE file text instead, where a duplicate key is a
    // real authoring mistake even though `Object.keys` would never reveal it.
    const source = readFileSync(new URL('../exerciseFallbackVideoMap.ts', import.meta.url), 'utf8');
    const keys = [...source.matchAll(/^\s*'([a-z0-9-]+)':\s*'/gm)].map((m) => m[1]);
    const seen = new Set<string>();
    const duplicates = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
    expect(duplicates).toEqual([]);
  });
});
