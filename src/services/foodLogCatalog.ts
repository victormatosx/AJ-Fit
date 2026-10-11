import { collection, doc, documentId, getDoc, getDocs, limit, orderBy,
  query, startAfter, where, type Firestore, type QueryConstraint, type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FoodLogCatalogMeta, FoodLogEntry, FoodLogSourceType } from '../types/nutrition';
import { normalizeSearchText } from '../nutrition/foodLog/normalize';
import { dedupeFoodLogSearchResults, rankFoodLogResults } from '../nutrition/foodLog/rank';
import { buildFoodLogSearchPlan, matchesRefineWords } from '../nutrition/foodLog/search';
import type { FoodSearchProvider, FoodSearchResult } from '../nutrition/foodLog/searchProvider';
import { FoodLogSearchCache, searchCacheKey } from '../nutrition/foodLog/searchCache';
import { withFoodLogSearchTimeout } from '../nutrition/foodLog/searchTimeout';

export { rankFoodLogResults };

/**
 * The amplo catálogo de registro (Fase C2) — read-only here, same as
 * `nutritionFoods`'s global-catalog half in `./nutritionFoods.ts`. Never
 * imported by Nutrition Engine/generation code; see
 * `docs/nutrition/catalog-expansion/03_canonical_model.md`.
 */
export async function loadFoodLogEntry(foodId: string, firestore: Firestore = db): Promise<FoodLogEntry<Timestamp> | null> {
  const snap = await getDoc(doc(firestore, 'foodLogCatalog', foodId));
  return snap.exists() ? snap.data() as FoodLogEntry<Timestamp> : null;
}

export async function loadFoodLogCatalogMeta(): Promise<FoodLogCatalogMeta<Timestamp> | null> {
  const snap = await getDoc(doc(db, 'foodLogCatalogMeta', 'current'));
  return snap.exists() ? snap.data() as FoodLogCatalogMeta<Timestamp> : null;
}

// C4 real-corpus benchmark: 40 preserved 151/151 useful coverage while
// reducing average cold reads from ~45 to 32.5. Keep this evidence-backed
// bound in sync with docs/catalog-expansion/17_c4_performance_cost.md.
const CANDIDATE_POOL_SIZE = 40;
const SEARCH_CACHE_TTL_MS = 60_000;
const searchPageCache = new FoodLogSearchCache<{
  candidates: FoodLogEntry<Timestamp>[];
  nextCursor: string | null;
}>({ ttlMs: SEARCH_CACHE_TTL_MS, maxEntries: 50 });

interface SearchCursor { priority: number; id: string }

export function encodeFoodLogSearchCursor(cursor: SearchCursor): string {
  return `v1:${cursor.priority}:${encodeURIComponent(cursor.id)}`;
}

export function decodeFoodLogSearchCursor(value: string): SearchCursor | null {
  const match = /^v1:([01]):(.+)$/u.exec(value);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    return id.length > 0 ? { priority: Number(match[1]), id } : null;
  } catch {
    return null;
  }
}

/** Useful after an operator refresh in a long-lived process; normal app sessions rely on the short TTL. */
export function clearFoodLogSearchCache(): void { searchPageCache.clear(); }

export interface FoodLogSearchOptions {
  pageSize?: number; cursor?: string; firestore?: Firestore;
  /** Threaded straight into `rankFoodLogResults` (Fase C3 Part 6) — caller resolves these from `nutritionPreferences`/recent diary items, this function stays storage-agnostic. */
  favoriteIds?: ReadonlySet<string>;
  recentIds?: ReadonlySet<string>;
}

/**
 * Prefix-matches against Firestore (same mechanism as
 * `searchNutritionCatalog`), then re-ranks a bounded candidate pool
 * client-side (`rankFoodLogResults`) before slicing to `pageSize` — the
 * "melhor solução intermediária" the C2 brief asks for in place of a real
 * search engine, without precluding an Algolia/Typesense migration later
 * (`06_federated_search_architecture.md`).
 *
 * Multi-word queries ("peito de frango") are split by `buildFoodLogSearchPlan`:
 * Firestore is queried by the most selective word AND its known synonym
 * variants (`anchorTerms`, via `array-contains-any` — up to 10 terms,
 * Fase C3) — e.g. querying "mussarela" also matches foods indexed under
 * "muçarela". The candidate pool is then refined client-side by the
 * remaining words (`matchesRefineWords`, itself synonym-aware too) — a
 * stored name like "Frango, peito, sem pele, cru" doesn't start with
 * "peito", so the old literal-whole-phrase-prefix approach returned zero
 * results for this exact benchmark case
 * (`docs/nutrition/catalog-expansion/04_search_benchmark.md`). If refining
 * would leave zero results, falls back to the unrefined anchor pool
 * rather than showing nothing — e.g. "frango grelhado" still surfaces
 * "frango" matches even though none literally contain "grelhado".
 *
 * `nextCursor` paginates the underlying anchor-word Firestore query, not
 * the ranked/refined view — "load more" pages through further anchor
 * matches, which may re-rank/re-filter across pages; documented
 * limitation, acceptable at this catalog's current size.
 */
export async function searchFoodLogCatalog(
  text: string, options: FoodLogSearchOptions = {},
): Promise<{ foods: FoodLogEntry<Timestamp>[]; nextCursor: string | null }> {
  const firestore = options.firestore ?? db;
  const normalized = normalizeSearchText(text);
  if (normalized.length < 2 || normalized.length > 32) throw new Error('INVALID_CATALOG_SEARCH');
  const pageSize = options.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 30) throw new Error('INVALID_PAGE_SIZE');
  const poolSize = Math.max(pageSize, CANDIDATE_POOL_SIZE);
  const { anchorTerms, refineWords } = buildFoodLogSearchPlan(text);
  if (anchorTerms.length === 0 || anchorTerms.length > 10) throw new Error('INVALID_CATALOG_SEARCH');
  const cacheKey = searchCacheKey([normalized, options.cursor ?? '', String(poolSize)]);
  // Tests/emulators may inject another Firestore instance. Never let a page
  // from the production singleton leak across those instance boundaries.
  const cacheEnabled = firestore === db;
  let remotePage = cacheEnabled ? searchPageCache.get(cacheKey) : null;
  if (!remotePage) {
    const constraints: QueryConstraint[] = [where('status', '==', 'active'),
      where('searchPrefixes', 'array-contains-any', anchorTerms.map((term) => term.slice(0, 32))),
      orderBy('searchSourcePriority'), orderBy(documentId()), limit(poolSize)];
    if (options.cursor) {
      const decoded = decodeFoodLogSearchCursor(options.cursor);
      if (!decoded) throw new Error('INVALID_CATALOG_CURSOR');
      // A value cursor avoids the old extra `getDoc(cursorId)` read on every
      // page after the first. Both ordered values are carried in the opaque
      // token, so Firestore resumes the exact same composite ordering.
      constraints.push(startAfter(decoded.priority, decoded.id));
    }
    const snap = await withFoodLogSearchTimeout(getDocs(query(collection(firestore, 'foodLogCatalog'), ...constraints)));
    const candidates = snap.docs.map((item) => item.data() as FoodLogEntry<Timestamp>);
    const last = snap.docs[snap.docs.length - 1];
    remotePage = {
      candidates,
      nextCursor: snap.size === poolSize && last
        ? encodeFoodLogSearchCursor({ priority: Number(last.data().searchSourcePriority ?? 1), id: last.id }) : null,
    };
    if (cacheEnabled) searchPageCache.set(cacheKey, remotePage);
  }
  const { candidates } = remotePage;
  const refined = candidates.filter((food) => matchesRefineWords(food, refineWords));
  const pool = refined.length > 0 ? refined : candidates;
  const ranked = rankFoodLogResults(pool, text, { favoriteIds: options.favoriteIds, recentIds: options.recentIds });
  return { foods: dedupeFoodLogSearchResults(ranked).slice(0, pageSize), nextCursor: remotePage.nextCursor };
}

/**
 * `FoodSearchProvider` wrapping the catalog above (Fase C3 Part 10) —
 * `searchFoodLogCatalog` is still exported and usable directly (the
 * benchmark CLI and existing call sites keep working unchanged); this is
 * the composable form for callers that want to stay provider-agnostic,
 * e.g. a future federated provider that tries this one first and an
 * external one second.
 */
export function createLocalFoodLogSearchProvider(): FoodSearchProvider<Timestamp> {
  return {
    providerName: 'local',
    search: (text, options) => searchFoodLogCatalog(text, options) as Promise<FoodSearchResult<Timestamp>>,
  };
}

export async function loadFoodLogEntryByBarcode(barcode: string, firestore: Firestore = db): Promise<FoodLogEntry<Timestamp> | null> {
  const digits = barcode.trim().replace(/[^0-9]/gu, '');
  if (digits.length < 8 || digits.length > 14) return null;
  const snap = await getDocs(query(collection(firestore, 'foodLogCatalog'),
    where('barcode', '==', digits), where('status', '==', 'active'), limit(1)));
  return snap.empty ? null : snap.docs[0].data() as FoodLogEntry<Timestamp>;
}

/** Source types materialized on demand from an external provider (Fase C5) — `createLocalFoodLogSearchProvider` results are already persisted and never need this. */
const EXTERNAL_FOOD_LOG_SOURCE_TYPES = new Set<FoodLogSourceType>(['fatsecret']);

/**
 * Pre-write dedup lookup for an external record about to be materialized,
 * in the exact priority order the C5 round brief specifies:
 * 1. exact barcode — works ACROSS providers (an OFF item and a FatSecret
 *    item for the same physical product share a barcode even though their
 *    deterministic doc ids differ, since the id scheme is per-provider).
 * 2. provider + sourceId — structurally guaranteed by `foodLogId`, already
 *    checked by `ensureFoodLogEntryMaterialized`'s direct `getDoc` before
 *    this function is ever called; not re-checked here.
 * 3. brand + normalized name — reuses `searchFoodLogCatalog`'s own
 *    bounded, tested candidate pool rather than a second ad-hoc query.
 * 4. textual similarity: deliberately not a separate fuzzy scorer here —
 *    step 3's `normalizeSearchText` comparison already tolerates
 *    accent/case/punctuation differences; a true similarity fallback is
 *    future work, not guessed at in this round.
 */
async function findExistingFoodLogEntryForExternal(
  entry: FoodLogEntry<Timestamp>, firestore: Firestore,
): Promise<FoodLogEntry<Timestamp> | null> {
  if (entry.barcode) {
    const byBarcode = await loadFoodLogEntryByBarcode(entry.barcode, firestore);
    if (byBarcode) return byBarcode;
  }
  const { foods: candidates } = await searchFoodLogCatalog(entry.name, { pageSize: 25, firestore });
  const targetName = normalizeSearchText(entry.name);
  const targetBrand = entry.brand?.name ? normalizeSearchText(entry.brand.name) : null;
  return candidates.find((food) => normalizeSearchText(food.name) === targetName
    && (food.brand?.name ? normalizeSearchText(food.brand.name) : null) === targetBrand) ?? null;
}

export type MaterializeExternalFood = (sourceId: string) => Promise<FoodLogEntry<Timestamp>>;
/**
 * Security fix (Fase C8): `foodLogCatalog`'s own Firestore rules already
 * deny ALL client writes (`allow write: if false`) — a client `setDoc`
 * here was dead on arrival in production, and had rules ever been
 * loosened, would have let a client dictate arbitrary nutrition values
 * for a shared, global catalog document (broken access control / data
 * integrity). Materialization is now a backend callable
 * (`materializeExternalFoodFatSecret`): the client only ever sends a
 * `sourceId` (a FatSecret `food_id`), never a nutrition value; the
 * server re-fetches the food from FatSecret with ITS OWN secret, maps +
 * normalizes it, dedups, and writes with the Admin SDK.
 *
 * Dynamically imported, not a top-level `import` — `firebase/functions`
 * + `lib/firebaseFunctions` initialize a `Functions` client at MODULE
 * LOAD time. `foodLogCatalog.ts` is imported by far more call sites
 * (diary/favorites/recipes services) than just the fatsecret path; a
 * top-level import here would force every one of those to also provide
 * a working `app` export from their `lib/firebase` mock, even when they
 * never touch an external provider at all. Deferred until a `fatsecret`
 * entry is actually materialized.
 */
const defaultMaterializeExternalFood: MaterializeExternalFood = async (sourceId) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([import('firebase/functions'), import('../lib/firebaseFunctions')]);
  const callable = httpsCallable<{ sourceId: string }, FoodLogEntry<Timestamp>>(functions, 'materializeExternalFoodFatSecret');
  return (await callable({ sourceId })).data;
};

async function materializeFoodLogEntry(
  entry: FoodLogEntry<Timestamp>, firestore: Firestore, materializeExternalFood: MaterializeExternalFood,
): Promise<FoodLogEntry<Timestamp>> {
  // Read-only pre-check (Firestore rules allow reads) — saves an RPC round
  // trip when a duplicate is already visible locally; purely an
  // optimization now, never the security boundary (the callable dedups
  // authoritatively server-side regardless of what this finds).
  const existing = await findExistingFoodLogEntryForExternal(entry, firestore);
  if (existing) return existing;
  return materializeExternalFood(entry.source.sourceId);
}

/**
 * The ONLY entry point screens call on selecting a search result (Fase C5
 * — "ao selecionar um item externo, materializar/cachear no
 * foodLogCatalog com provenance"). Local-sourced entries are already
 * persisted and returned as-is, with no extra read. External-sourced
 * entries are checked by their deterministic id first (cheap `getDoc`,
 * covers "already materialized by an earlier search this session or a
 * previous one") and only fall through to the dedup-check + backend
 * `materializeExternalFood` call when truly new.
 *
 * Idempotent either way: `entry.id` is already deterministic
 * (`foodLogId(entry.source.type, entry.source.sourceId)`), so re-selecting
 * the same external item twice — even concurrently from two devices —
 * just resolves to the same document, never creates a duplicate.
 */
export async function ensureFoodLogEntryMaterialized(
  entry: FoodLogEntry<Timestamp>, firestore: Firestore = db, materializeExternalFood: MaterializeExternalFood = defaultMaterializeExternalFood,
): Promise<FoodLogEntry<Timestamp>> {
  if (!EXTERNAL_FOOD_LOG_SOURCE_TYPES.has(entry.source.type)) return entry;
  const existing = await loadFoodLogEntry(entry.id, firestore);
  if (existing) return existing;
  return materializeFoodLogEntry(entry, firestore, materializeExternalFood);
}

export type ResolveFoodByBarcodeStatus = 'local' | 'materialized' | 'not_found' | 'error';
export interface ResolveFoodByBarcodeResult { status: ResolveFoodByBarcodeStatus; entry?: FoodLogEntry<Timestamp> }
export type ResolveFoodByBarcodeCallable = (
  barcode: string,
) => Promise<{ status: 'local' | 'materialized' | 'not_found'; entry?: FoodLogEntry<Timestamp> }>;

/**
 * Same deferred-import reasoning as `defaultMaterializeExternalFood` above
 * — `foodLogCatalog.ts` has far more call sites than the barcode-scan path
 * alone, so a top-level `firebase/functions` import here would force every
 * one of them to provide a working `app` export too.
 */
const defaultResolveFoodByBarcodeCallable: ResolveFoodByBarcodeCallable = async (barcode) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([import('firebase/functions'), import('../lib/firebaseFunctions')]);
  const callable = httpsCallable<{ barcode: string }, { status: 'local' | 'materialized' | 'not_found'; entry?: FoodLogEntry<Timestamp> }>(
    functions, 'resolveFoodByBarcode',
  );
  return (await callable({ barcode })).data;
};

/**
 * Entry point the barcode scanner calls for EVERY decoded barcode (round
 * brief §2 "resolução local-first"). Checks `foodLogCatalog` by barcode
 * client-side first — a cheap read that skips the backend call (and its
 * rate-limit charge) entirely when the product is already cataloged, the
 * same optimization `ensureFoodLogEntryMaterialized` already applies for
 * search-result materialization. Anything not found locally goes to the
 * `resolveFoodByBarcode` callable, which owns the OFF-then-FatSecret
 * federated lookup AND the server-side materialization (Firestore rules
 * deny client writes to `foodLogCatalog`, same security boundary as
 * `materializeExternalFoodFatSecret`). Never throws: a transport failure
 * resolves to `{ status: 'error' }` so the scanner can show a retry state
 * instead of crashing mid-scan.
 */
export async function resolveFoodLogEntryByBarcode(
  barcode: string, firestore: Firestore = db, resolveCallable: ResolveFoodByBarcodeCallable = defaultResolveFoodByBarcodeCallable,
): Promise<ResolveFoodByBarcodeResult> {
  const local = await loadFoodLogEntryByBarcode(barcode, firestore);
  if (local) return { status: 'local', entry: local };
  try { return await resolveCallable(barcode); }
  catch { return { status: 'error' }; }
}
