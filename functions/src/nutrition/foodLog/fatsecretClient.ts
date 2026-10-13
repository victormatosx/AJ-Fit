import {
  FATSECRET_BARCODE_URL, FATSECRET_DEFAULT_TIMEOUT_MS, FATSECRET_FOOD_GET_URL, FATSECRET_LANGUAGE,
  FATSECRET_MAX_PAGE_SIZE, FATSECRET_OAUTH_TOKEN_URL, FATSECRET_REGION, FATSECRET_SCOPE, FATSECRET_SEARCH_URL,
} from './fatsecretConfig';

/**
 * Thin, fully-implemented FatSecret Platform API client (OAuth2
 * client-credentials + `foods/search/v5` + `food/barcode/find-by-id/v2`),
 * built against the publicly documented contract
 * (`docs/nutrition/catalog-expansion/14_c3_external_providers.md`). Never
 * instantiated with real credentials in this repo today — see
 * `fatsecretConfig.ts`. `fetchImpl` is injectable so tests exercise the
 * real request/response/error-mapping logic against a mocked `fetch`,
 * never a real network call.
 */
export type FatSecretErrorKind = 'not_configured' | 'rate_limited' | 'unavailable' | 'invalid_response';

export class FatSecretApiError extends Error {
  constructor(public readonly kind: FatSecretErrorKind, public readonly statusCode?: number) {
    super(`FatSecret API request failed (${kind})`);
    this.name = 'FatSecretApiError';
  }
}

interface CachedToken { accessToken: string; expiresAtMs: number }

export interface FatSecretClientOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Raw shape of one `foods.food[]` entry from `foods/search/v5` — field names verbatim from FatSecret's docs. */
export interface RawFatSecretSearchFood {
  food_id: string;
  food_name: string;
  food_type?: 'Brand' | 'Generic';
  brand_name?: string;
  food_description?: string;
  food_url?: string;
}

export interface RawFatSecretSearchResponse {
  foods?: { food?: RawFatSecretSearchFood | RawFatSecretSearchFood[]; max_results?: string; total_results?: string; page_number?: string };
}

/**
 * Raw shape of one `servings.serving[]` entry from `food.get.v2` — the
 * structured serving LIST (named units like "1 lata"/"1 fatia", each with
 * its own `metric_serving_amount`/`metric_serving_unit`), as opposed to
 * `foods/search/v5`'s compact single `food_description` text. This is
 * what lets a branded/restaurant item surface a real natural unit instead
 * of only the generic reference serving `fatsecretMapper.ts` parses from
 * search results.
 */
export interface RawFatSecretServing {
  serving_id?: string;
  serving_description?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  /** `'1'`/`'0'` string booleans, per FatSecret's own convention — never actual booleans. */
  is_default?: string;
  calories?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
  fiber?: string;
}

export interface RawFatSecretFoodGetResponse {
  food?: { food_id?: string; food_name?: string; servings?: { serving?: RawFatSecretServing | RawFatSecretServing[] } };
}

export interface RawFatSecretBarcodeResponse {
  food_id?: { value?: string } | string;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function fatSecretSearchFoods(response: RawFatSecretSearchResponse): RawFatSecretSearchFood[] {
  return toArray(response.foods?.food);
}

/**
 * Client-credentials grant with in-process token caching (module-level, one
 * cache shared by every invocation on the same warm instance — same
 * tradeoff Cloud Functions already accepts for other provider clients).
 * Refreshes 60s before actual expiry to avoid a request racing an
 * already-stale token.
 */
const TOKEN_REFRESH_SKEW_MS = 60_000;
let cachedToken: CachedToken | null = null;

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await run(controller.signal); }
  finally { clearTimeout(timer); }
}

function classifyHttpFailure(statusCode: number): FatSecretErrorKind {
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500) return 'unavailable';
  return 'invalid_response';
}

export class FatSecretClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: FatSecretClientOptions) {
    if (!options.clientId.trim() || !options.clientSecret.trim()) throw new FatSecretApiError('not_configured');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? FATSECRET_DEFAULT_TIMEOUT_MS;
  }

  /** Exposed for tests only — production callers never need to bypass the cache explicitly. */
  static resetTokenCacheForTests(): void { cachedToken = null; }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS > now) return cachedToken.accessToken;
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: FATSECRET_SCOPE });
    let response: Response;
    try {
      response = await withTimeout(this.timeoutMs, (signal) => this.fetchImpl(FATSECRET_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal,
      }));
    } catch { throw new FatSecretApiError('unavailable'); }
    if (!response.ok) throw new FatSecretApiError(classifyHttpFailure(response.status), response.status);
    const json = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
    if (!json || typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
      throw new FatSecretApiError('invalid_response');
    }
    cachedToken = { accessToken: json.access_token, expiresAtMs: now + json.expires_in * 1000 };
    return cachedToken.accessToken;
  }

  private async authorizedGet<T>(url: string): Promise<T> {
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await withTimeout(this.timeoutMs, (signal) => this.fetchImpl(url, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal,
      }));
    } catch { throw new FatSecretApiError('unavailable'); }
    if (response.status === 401 && cachedToken) {
      // Token revoked/expired server-side ahead of our local cache — drop it and let the caller retry once.
      cachedToken = null;
    }
    if (!response.ok) throw new FatSecretApiError(classifyHttpFailure(response.status), response.status);
    const json = await response.json().catch(() => null) as T | null;
    if (json == null) throw new FatSecretApiError('invalid_response');
    return json;
  }

  /** `foods/search/v5`, BR/pt localization, generic + branded results. */
  async searchFoods(query: string, pageSize = 20, pageNumber = 0): Promise<RawFatSecretSearchResponse> {
    const boundedPageSize = Math.min(Math.max(1, pageSize), FATSECRET_MAX_PAGE_SIZE);
    const params = new URLSearchParams({
      method: 'foods.search.v5', format: 'json', search_expression: query,
      max_results: String(boundedPageSize), page_number: String(Math.max(0, pageNumber)),
      region: FATSECRET_REGION, language: FATSECRET_LANGUAGE,
    });
    return this.authorizedGet<RawFatSecretSearchResponse>(`${FATSECRET_SEARCH_URL}?${params.toString()}`);
  }

  /** `food/barcode/find-by-id/v2` — resolves a GTIN/EAN to a FatSecret `food_id`; the caller then looks up full nutrition via `searchFoods`/`food.get` separately. */
  async findByBarcode(barcode: string): Promise<RawFatSecretBarcodeResponse> {
    const params = new URLSearchParams({ method: 'food.find_id_for_barcode', format: 'json', barcode, region: FATSECRET_REGION });
    return this.authorizedGet<RawFatSecretBarcodeResponse>(`${FATSECRET_BARCODE_URL}?${params.toString()}`);
  }

  /** `food.get.v2` — the structured serving LIST for one `food_id` (named units + metric amount/unit), consumed on-demand by `materializeExternalFood.ts` only. */
  async getFood(foodId: string): Promise<RawFatSecretFoodGetResponse> {
    const params = new URLSearchParams({ method: 'food.get.v2', format: 'json', food_id: foodId });
    return this.authorizedGet<RawFatSecretFoodGetResponse>(`${FATSECRET_FOOD_GET_URL}?${params.toString()}`);
  }
}
