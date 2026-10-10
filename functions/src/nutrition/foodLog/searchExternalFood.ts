import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { requireAuth } from '../../lib/auth';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { FatSecretApiError, FatSecretClient, type RawFatSecretSearchResponse } from './fatsecretClient';
import {
  EXTERNAL_FOOD_SEARCH_HOURLY_LIMIT, EXTERNAL_FOOD_SEARCH_WINDOW_MS, FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET,
} from './fatsecretConfig';
import { enforceExternalFoodRateLimit } from './rateLimit';

interface SearchExternalFoodData { query: string; pageSize?: number }
export interface SearchExternalFoodResult { provider: 'fatsecret'; response: RawFatSecretSearchResponse }

function parseData(data: unknown): SearchExternalFoodData {
  const invalid = (): never => { throw new HttpsError('invalid-argument', 'INVALID_REQUEST'); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['query', 'pageSize'].includes(key))) return invalid();
  if (typeof value.query !== 'string' || value.query.trim().length < 2 || value.query.trim().length > 80) return invalid();
  if (value.pageSize !== undefined && (!Number.isInteger(value.pageSize) || (value.pageSize as number) < 1 || (value.pageSize as number) > 50)) return invalid();
  return { query: value.query.trim(), pageSize: value.pageSize as number | undefined };
}

/**
 * Thin authenticated proxy in front of FatSecret — holds the OAuth secret
 * server-side (round brief: "credenciais devem permanecer no backend"),
 * applies a per-uid rate limit, and returns FatSecret's raw search payload
 * as-is. Mapping that payload into AJ Fit's canonical `RawFoodLogRecord`
 * shape happens client-side (`src/nutrition/foodLog/fatsecretMapper.ts`),
 * the same split every other food-log source already uses (OFF's mapper
 * also lives alongside the other foodLog modules, not duplicated here).
 *
 * `FATSECRET_CLIENT_ID`/`FATSECRET_CLIENT_SECRET` are not configured in any
 * environment today — see `fatsecretConfig.ts`. Calling this with empty
 * secret values fails closed with `EXTERNAL_FOOD_PROVIDER_UNAVAILABLE`,
 * which the client-side federated provider treats as "fall back to local
 * results only", never as a hard error surfaced to the user.
 */
export async function searchExternalFoodHandler(
  request: CallableRequest,
  db: Firestore = defaultDb,
  clientFactory: (clientId: string, clientSecret: string) => FatSecretClient = (clientId, clientSecret) => new FatSecretClient({ clientId, clientSecret }),
): Promise<SearchExternalFoodResult> {
  const uid = requireAuth(request);
  const { query, pageSize } = parseData(request.data);
  try { await requireActiveAccount(uid, db); }
  catch { throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE'); }

  const clientId = FATSECRET_CLIENT_ID.value();
  const clientSecret = FATSECRET_CLIENT_SECRET.value();
  if (!clientId.trim() || !clientSecret.trim()) throw new HttpsError('failed-precondition', 'EXTERNAL_FOOD_PROVIDER_UNAVAILABLE');

  await enforceExternalFoodRateLimit(db, uid, 'externalFoodSearch', EXTERNAL_FOOD_SEARCH_HOURLY_LIMIT, EXTERNAL_FOOD_SEARCH_WINDOW_MS, 'EXTERNAL_FOOD_SEARCH_RATE_LIMIT');

  try {
    const client = clientFactory(clientId, clientSecret);
    const response = await client.searchFoods(query, pageSize ?? 20);
    return { provider: 'fatsecret', response };
  } catch (error) {
    if (error instanceof FatSecretApiError) {
      if (error.kind === 'rate_limited') throw new HttpsError('resource-exhausted', 'EXTERNAL_FOOD_SEARCH_RATE_LIMIT');
      throw new HttpsError('unavailable', 'EXTERNAL_FOOD_PROVIDER_UNAVAILABLE');
    }
    throw new HttpsError('internal', 'EXTERNAL_FOOD_SEARCH_FAILED');
  }
}

export const searchExternalFoodFatSecret = onCall(
  { enforceAppCheck: true, timeoutSeconds: 30, secrets: [FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET] },
  (request) => searchExternalFoodHandler(request),
);
