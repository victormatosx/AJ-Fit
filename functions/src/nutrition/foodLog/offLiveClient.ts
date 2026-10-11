import { OFF_DEFAULT_TIMEOUT_MS, OFF_PRODUCT_FIELDS, OFF_PRODUCT_URL, OFF_USER_AGENT } from './fatsecretConfig';
import type { RawOffProduct } from '../shared/nutrition/foodLog/offQualityFilter';

/**
 * Live, single-barcode counterpart to `scripts/nutrition/foodLog/fetchOff.ts`'s
 * bulk search-API fetch — same public Open Food Facts v2 contract, no
 * credentials, no scraping. One request per user-initiated barcode scan
 * (round brief §2/§7), never a background crawl.
 */
export type OffLiveErrorKind = 'unavailable' | 'invalid_response';

export class OffLiveApiError extends Error {
  constructor(public readonly kind: OffLiveErrorKind, public readonly statusCode?: number) {
    super(`Open Food Facts product lookup failed (${kind})`);
    this.name = 'OffLiveApiError';
  }
}

interface OffProductResponse { status?: number; product?: RawOffProduct }

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await run(controller.signal); }
  finally { clearTimeout(timer); }
}

/**
 * Resolves one barcode against OFF's public product endpoint. Returns
 * `null` for "OFF has no record of this barcode" (OFF's own `status: 0` or
 * an HTTP 404) — never thrown, since that's an expected, routine outcome
 * the caller falls through to the next provider for. Only transport
 * failures/unexpected payload shapes throw `OffLiveApiError`, mirroring
 * `FatSecretApiError`'s own not-found-vs-unavailable split.
 */
export async function fetchOffProductByBarcode(
  barcode: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = OFF_DEFAULT_TIMEOUT_MS,
): Promise<RawOffProduct | null> {
  const url = `${OFF_PRODUCT_URL}/${encodeURIComponent(barcode)}.json?fields=${OFF_PRODUCT_FIELDS}`;
  let response: Response;
  try {
    response = await withTimeout(timeoutMs, (signal) => fetchImpl(url, { headers: { 'User-Agent': OFF_USER_AGENT }, signal }));
  } catch { throw new OffLiveApiError('unavailable'); }
  if (response.status === 404) return null;
  if (!response.ok) throw new OffLiveApiError(response.status >= 500 ? 'unavailable' : 'invalid_response', response.status);
  const json = await response.json().catch(() => null) as OffProductResponse | null;
  if (json == null) throw new OffLiveApiError('invalid_response');
  if (json.status === 0 || !json.product) return null;
  return json.product;
}
