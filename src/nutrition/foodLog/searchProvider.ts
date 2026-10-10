import type { FoodLogEntry } from '../../types/nutrition';

/**
 * Fase C3 Part 10 — the seam a future external provider (FatSecret BR,
 * once contracted — `docs/nutrition/catalog-expansion/14_c3_external_providers.md`)
 * plugs into without `FoodSearchScreen`/`RegisterMealScreen` changing at
 * all: both already call something shaped exactly like
 * `FoodSearchProvider.search()` (text + `{ pageSize, cursor }` ->
 * `{ foods, nextCursor }`). Deliberately NOT a federated
 * local-then-external orchestrator yet — there is no second provider to
 * federate with today (round brief: "não faça overengineering"). Adding
 * one later is composing two `FoodSearchProvider`s behind a third
 * implementation of this same interface, not a rewrite of either screen.
 */
export interface FoodSearchResult<TTimestamp = unknown> {
  foods: FoodLogEntry<TTimestamp>[];
  nextCursor: string | null;
}

export interface FoodSearchProviderOptions {
  pageSize?: number;
  cursor?: string;
  favoriteIds?: ReadonlySet<string>;
  recentIds?: ReadonlySet<string>;
}

export interface FoodSearchProvider<TTimestamp = unknown> {
  /** Stable id for logging/analytics (`source_selected`, round brief Part 19) — e.g. `'local'`, `'fatsecret'`. */
  readonly providerName: string;
  search(text: string, options?: FoodSearchProviderOptions): Promise<FoodSearchResult<TTimestamp>>;
}
