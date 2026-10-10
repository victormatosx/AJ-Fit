import { describe, expect, it } from 'vitest';
import { diffFoodLogRefresh } from '../refresh';
import type { FoodLogEntry } from '../../../types/nutrition';
import type { FoodLogEntryBody } from '../normalize';

function food(id: string, name = 'Produto', status: 'active' | 'hidden' | 'deprecated' = 'active'): FoodLogEntryBody {
  return { id, name, aliases: [], source: { type: 'off', sourceId: id, sourceName: 'Open Food Facts', sourceVersion: 'v2' },
    locale: 'pt-BR', category: 'other', nutritionPer100g: { kcal: 100, proteinG: 1, carbsG: 20, fatG: 1, fiberG: null },
    status, provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: 'OFF' },
    catalogVersion: 'v2', searchPrefixes: ['pr'], searchSourcePriority: 1 };
}

function stored(body: FoodLogEntryBody): FoodLogEntry {
  return { ...body, source: { ...body.source, sourceVersion: 'v1' }, catalogVersion: 'v1', createdAt: null, updatedAt: null };
}

describe('diffFoodLogRefresh', () => {
  it('classifies new, content-changed and version-only unchanged entries', () => {
    const diff = diffFoodLogRefresh([stored(food('same')), stored(food('changed', 'Old'))],
      [food('same'), food('changed', 'New'), food('new')], new Set(), true);
    expect(diff.newEntries.map((item) => item.id)).toEqual(['new']);
    expect(diff.changedEntries.map((item) => item.id)).toEqual(['changed']);
    expect(diff.unchangedIds).toEqual(['same']);
  });

  it('deprecates missing/rejected active rows but never overwrites an existing hidden decision', () => {
    const diff = diffFoodLogRefresh([stored(food('missing')), stored(food('rejected')), stored(food('hidden', 'Bad', 'hidden'))],
      [], new Set(['rejected']), true);
    expect(diff.deprecations).toEqual([
      { id: 'missing', reason: 'missing_from_source' },
      { id: 'rejected', reason: 'source_record_rejected' },
    ]);
    expect(diff.alreadyInactiveIds).toEqual(['hidden']);
  });

  it('does not infer removals from a partial snapshot', () => {
    expect(diffFoodLogRefresh([stored(food('missing'))], [], new Set(), false).deprecations).toEqual([]);
  });

  it('is idempotent on rerun after applying the same snapshot', () => {
    const incoming = [food('same')];
    const diff = diffFoodLogRefresh([stored(incoming[0])], incoming, new Set(), true);
    expect(diff.newEntries).toEqual([]);
    expect(diff.changedEntries).toEqual([]);
    expect(diff.deprecations).toEqual([]);
    expect(diff.unchangedIds).toEqual(['same']);
  });
});
