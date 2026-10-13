import { httpsCallable } from 'firebase/functions';
import { Timestamp } from 'firebase/firestore';
import { functions } from '../../lib/firebaseFunctions';
import type { FoodLogEntry } from '../../types/nutrition';
import type { FoodSearchProvider, FoodSearchResult } from './searchProvider';
import { normalizeFoodLogRecord } from './normalize';
import { mapFatSecretFoodToFoodLogRecord, type RawFatSecretSearchFood } from './fatsecretMapper';

export const FATSECRET_LIVE_CATALOG_VERSION = 'fatsecret-live-v1';
const SEARCH_EXTERNAL_FOOD_CALLABLE = 'searchExternalFoodFatSecret';

interface SearchExternalFoodFatSecretResponse {
  provider: 'fatsecret';
  response: { foods?: { food?: RawFatSecretSearchFood | RawFatSecretSearchFood[] } };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultCallExternalSearch(query: string, pageSize: number): Promise<SearchExternalFoodFatSecretResponse> {
  const callable = httpsCallable<{ query: string; pageSize: number }, SearchExternalFoodFatSecretResponse>(
    functions, SEARCH_EXTERNAL_FOOD_CALLABLE,
  );
  return callable({ query, pageSize }).then((result) => result.data);
}

export interface FatSecretProviderOptions {
  /** Injectable for tests — production default calls the `searchExternalFoodFatSecret` callable. */
  callExternalSearch?: (query: string, pageSize: number) => Promise<SearchExternalFoodFatSecretResponse>;
}

/**
 * `FoodSearchProvider` wrapping the FatSecret callable — the external leg
 * `createFederatedFoodLogSearchProvider` falls back to. Never persists
 * anything itself: each result already carries the SAME deterministic id a
 * materialized record would get (`normalizeFoodLogRecord` -> `foodLogId`),
 * so the UI can render it immediately and
 * `materializeExternalFoodLogEntry` (`src/services/foodLogCatalog.ts`) only
 * has to upsert under that id later, never reconcile a different one.
 *
 * Never throws: a transport failure, missing backend credentials
 * (`EXTERNAL_FOOD_PROVIDER_UNAVAILABLE`), or rate limit all resolve to an
 * empty result — the federated provider's job is to degrade to local-only
 * on any of these, not to special-case them here.
 */
export function createFatSecretSearchProvider(options: FatSecretProviderOptions = {}): FoodSearchProvider<Timestamp> {
  const callExternalSearch = options.callExternalSearch ?? defaultCallExternalSearch;
  return {
    providerName: 'fatsecret',
    async search(text, searchOptions): Promise<FoodSearchResult<Timestamp>> {
      const pageSize = searchOptions?.pageSize ?? 20;
      let payload: SearchExternalFoodFatSecretResponse;
      try { payload = await callExternalSearch(text, pageSize); }
      catch { return { foods: [], nextCursor: null }; }
      const rawFoods = toArray(payload.response?.foods?.food);
      const now = Timestamp.now();
      const foods: FoodLogEntry<Timestamp>[] = [];
      for (const rawFood of rawFoods) {
        const record = mapFatSecretFoodToFoodLogRecord(rawFood, FATSECRET_LIVE_CATALOG_VERSION);
        if (!record) continue;
        try {
          const body = normalizeFoodLogRecord(record, FATSECRET_LIVE_CATALOG_VERSION);
          foods.push({ ...body, createdAt: now, updatedAt: now } as FoodLogEntry<Timestamp>);
        }
        catch { /* implausible/invalid upstream data for this one item — skip, never a hard error for the whole search */ }
      }
      return { foods, nextCursor: null };
    },
  };
}
