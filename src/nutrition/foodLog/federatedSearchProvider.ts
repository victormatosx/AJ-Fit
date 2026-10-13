import type { Timestamp } from 'firebase/firestore';
import type { FoodLogEntry } from '../../types/nutrition';
import type { FoodSearchProvider, FoodSearchResult } from './searchProvider';
import { normalizeSearchText } from './normalize';
import { dedupeFoodLogSearchResults, rankFoodLogResults } from './rank';

function tokensOf(name: string, aliases: readonly string[]): string[] {
  const nameTokens = normalizeSearchText(name).split(' ');
  const aliasTokens = aliases.flatMap((alias) => normalizeSearchText(alias).split(' '));
  return [...nameTokens, ...aliasTokens].filter(Boolean);
}

const TOP_N_CHECKED = 3;

/**
 * "Boa o suficiente" gate (Fase C5 round brief) — the LOCAL leg is
 * considered sufficient when at least one of its top few ranked results
 * textually covers every meaningful query token. E.g. "frango grelhado" is
 * satisfied once TACO's "Frango, peito, grelhado" is among the top 3; "yopro
 * morango" is NOT satisfied by an unrelated whey entry that only loosely
 * matches "proteina". Checking the top few (not just rank #1) tolerates
 * `rankFoodLogResults`' own tie-breaking without changing it. Exported for
 * direct unit testing of the fallback decision in isolation.
 */
export function isLocalResultSufficient<TTimestamp>(foods: readonly FoodLogEntry<TTimestamp>[], query: string): boolean {
  if (foods.length === 0) return false;
  const queryTokens = normalizeSearchText(query).split(' ').filter((token) => token.length >= 2);
  if (queryTokens.length === 0) return true;
  return foods.slice(0, TOP_N_CHECKED).some((food) => {
    const tokens = tokensOf(food.name, food.aliases);
    return queryTokens.every((token) => tokens.some((candidate) => candidate.includes(token)));
  });
}

export interface FederatedSearchProviderOptions {
  localProvider: FoodSearchProvider<Timestamp>;
  externalProvider: FoodSearchProvider<Timestamp>;
  /** Overridable only for tests — production always uses `isLocalResultSufficient`. */
  isLocalSufficient?: (foods: readonly FoodLogEntry<Timestamp>[], query: string) => boolean;
}

/**
 * Local-first federated `FoodSearchProvider` (Fase C5) — composes the
 * existing local provider with an external leg (FatSecret today) behind
 * the EXACT SAME `FoodSearchProvider` interface both search screens already
 * consume (`src/nutrition/foodLog/searchProvider.ts`'s own doc comment
 * anticipated this composition; neither screen changes its search-calling
 * code, only which provider instance it holds).
 *
 * Contract:
 * 1. Always searches local first — never skipped.
 * 2. Only calls the external leg when local is NOT sufficient
 *    (`isLocalResultSufficient`); this is the whole fallback decision, no
 *    separate relevance/quality model.
 * 3. External failures (network, rate limit, missing credentials) never
 *    surface here — `createFatSecretSearchProvider` itself already
 *    swallows them and returns an empty result, so this function doesn't
 *    need its own try/catch to stay local-only on failure.
 * 4. The merged set is deduped with the SAME `dedupeFoodLogSearchResults`
 *    every local-only caller already uses (barcode > provider/sourceId >
 *    exact name+brand priority — see its own doc comment), local entries
 *    first so a cross-provider duplicate always keeps the local row, then
 *    re-ranked with the SAME `rankFoodLogResults` local search already
 *    uses — a strong external match (e.g. "Big Mac") must still be able to
 *    outrank a weak local one, not just get appended after it.
 * 5. `nextCursor` only ever walks the LOCAL leg — the external leg is a
 *    one-shot top-up on the first page, not a federated cursor. Documented
 *    scope limit (same spirit as `searchFoodLogCatalog`'s own cursor
 *    limitation): "load more" never re-queries the external provider.
 */
export function createFederatedFoodLogSearchProvider(options: FederatedSearchProviderOptions): FoodSearchProvider<Timestamp> {
  const { localProvider, externalProvider, isLocalSufficient = isLocalResultSufficient } = options;
  return {
    providerName: 'federated',
    async search(text, searchOptions): Promise<FoodSearchResult<Timestamp>> {
      const local = await localProvider.search(text, searchOptions);
      // Pagination ("load more") never re-triggers the external leg — only
      // the first page (no cursor) ever considers it insufficient enough to fan out.
      if (searchOptions?.cursor || isLocalSufficient(local.foods, text)) return local;
      const external = await externalProvider.search(text, { pageSize: searchOptions?.pageSize });
      if (external.foods.length === 0) return local;
      const deduped = dedupeFoodLogSearchResults([...local.foods, ...external.foods]);
      const ranked = rankFoodLogResults(deduped, text, { favoriteIds: searchOptions?.favoriteIds, recentIds: searchOptions?.recentIds });
      return { foods: ranked, nextCursor: local.nextCursor };
    },
  };
}
