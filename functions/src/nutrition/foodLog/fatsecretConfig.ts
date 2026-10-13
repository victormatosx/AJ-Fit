import { defineSecret } from 'firebase-functions/params';

/**
 * FatSecret Platform API credentials (OAuth2 client-credentials grant,
 * Premier tier, `region=BR`/`language=pt`) —
 * `docs/nutrition/catalog-expansion/14_c3_external_providers.md`. Not
 * configured in this repo/environment as of this round: no FatSecret
 * contract/credentials exist yet. The secrets are still declared (and the
 * client below fully implemented against the documented v5/v2 contract) so
 * activating the provider later is "set these two secret values", not
 * writing new code. Never hold these on the client — only the callables
 * in this directory (`searchExternalFood.ts`, `materializeExternalFood.ts`)
 * ever read `.value()`.
 */
export const FATSECRET_CLIENT_ID = defineSecret('FATSECRET_CLIENT_ID');
export const FATSECRET_CLIENT_SECRET = defineSecret('FATSECRET_CLIENT_SECRET');

export const FATSECRET_OAUTH_TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
export const FATSECRET_SEARCH_URL = 'https://platform.fatsecret.com/rest/foods/search/v5';
export const FATSECRET_BARCODE_URL = 'https://platform.fatsecret.com/rest/food/barcode/find-by-id/v2';
/** `food.get.v2` — the first version whose `servings.serving[]` entries include `metric_serving_amount`/`metric_serving_unit`, what `fatsecretFoodGetMapper.ts` needs to build a gram-confident unit. */
export const FATSECRET_FOOD_GET_URL = 'https://platform.fatsecret.com/rest/food/v2';
export const FATSECRET_SCOPE = 'premier';
export const FATSECRET_REGION = 'BR';
export const FATSECRET_LANGUAGE = 'pt';
export const FATSECRET_DEFAULT_TIMEOUT_MS = 5_000;
export const FATSECRET_MAX_PAGE_SIZE = 50;

/** Per-uid, sliding-window cap on external calls — protects the FatSecret rate limit/cost, not a security control. */
export const EXTERNAL_FOOD_SEARCH_HOURLY_LIMIT = 60;
export const EXTERNAL_FOOD_SEARCH_WINDOW_MS = 60 * 60 * 1000;
/**
 * Separate, stricter budget for `food.get` (structured servings) — this
 * only ever fires once per genuinely NEW external item at materialization
 * time (`ensureFoodLogEntryMaterialized` short-circuits on anything
 * already persisted), so it needs far less headroom than search.
 */
export const EXTERNAL_FOOD_DETAILS_HOURLY_LIMIT = 30;
export const EXTERNAL_FOOD_DETAILS_WINDOW_MS = 60 * 60 * 1000;

/**
 * Open Food Facts' public v2 product-by-barcode endpoint — no credentials,
 * no scraping, same public read access `scripts/nutrition/foodLog/fetchOff.ts`
 * already documents for the bulk importer. A live per-scan lookup (unlike
 * that script's own per-keystroke-search caveat) is the intended use of
 * this specific endpoint: one request per user-initiated barcode scan, not
 * a background crawl.
 */
export const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';
export const OFF_PRODUCT_FIELDS = 'code,product_name,brands,categories_tags,countries_tags,nutriments,lang,serving_size,serving_quantity';
export const OFF_USER_AGENT = 'AJFit-FoodLogCatalog/1.0 (+contact: victor.matos3112@gmail.com; barcode scan live lookup)';
export const OFF_DEFAULT_TIMEOUT_MS = 5_000;

/** Barcode-scan resolution budget — one call covers BOTH the OFF live lookup and (on an OFF miss) the FatSecret barcode+food.get round trip, so it stays its own, separate budget from search/details above. */
export const EXTERNAL_FOOD_BARCODE_HOURLY_LIMIT = 60;
export const EXTERNAL_FOOD_BARCODE_WINDOW_MS = 60 * 60 * 1000;
