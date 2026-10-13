import type { FoodLogEntry } from '../../types/nutrition';
import type { FoodLogEntryBody } from './normalize';

export type OffDeprecationReason = 'missing_from_source' | 'source_record_rejected';
export interface OffDeprecation { id: string; reason: OffDeprecationReason }

export interface FoodLogRefreshDiff {
  newEntries: FoodLogEntryBody[];
  changedEntries: FoodLogEntryBody[];
  unchangedIds: string[];
  deprecations: OffDeprecation[];
  alreadyInactiveIds: string[];
}

/**
 * Compares user-visible/searchable content, deliberately excluding import
 * timestamps and source/catalog version labels. A new nightly version alone
 * must not rewrite tens of thousands of unchanged documents.
 */
function contentSignature(entry: FoodLogEntryBody | FoodLogEntry): string {
  return JSON.stringify({
    id: entry.id,
    source: { type: entry.source.type, sourceId: entry.source.sourceId, sourceName: entry.source.sourceName },
    name: entry.name, aliases: entry.aliases, brand: entry.brand ?? null, barcode: entry.barcode ?? null,
    locale: entry.locale, category: entry.category, subCategory: entry.subCategory ?? null,
    nutritionPer100g: entry.nutritionPer100g, status: entry.status, provenance: entry.provenance,
    searchPrefixes: entry.searchPrefixes, searchSourcePriority: entry.searchSourcePriority,
  });
}

/** Pure staging diff used by the refresh CLI and unit tests. Nothing is mutated. */
export function diffFoodLogRefresh(
  currentEntries: readonly FoodLogEntry[], incomingEntries: readonly FoodLogEntryBody[],
  rejectedIncomingIds: ReadonlySet<string>, fullSnapshot: boolean,
): FoodLogRefreshDiff {
  const current = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const incoming = new Map(incomingEntries.map((entry) => [entry.id, entry]));
  const newEntries: FoodLogEntryBody[] = [];
  const changedEntries: FoodLogEntryBody[] = [];
  const unchangedIds: string[] = [];

  for (const entry of incomingEntries) {
    const existing = current.get(entry.id);
    if (!existing) newEntries.push(entry);
    else if (contentSignature(existing) !== contentSignature(entry)) changedEntries.push(entry);
    else unchangedIds.push(entry.id);
  }

  const deprecations: OffDeprecation[] = [];
  const alreadyInactiveIds: string[] = [];
  if (fullSnapshot) {
    for (const entry of currentEntries) {
      if (incoming.has(entry.id)) continue;
      if (entry.status !== 'active') { alreadyInactiveIds.push(entry.id); continue; }
      deprecations.push({ id: entry.id,
        reason: rejectedIncomingIds.has(entry.id) ? 'source_record_rejected' : 'missing_from_source' });
    }
  }
  return { newEntries, changedEntries, unchangedIds, deprecations, alreadyInactiveIds };
}
