import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { requireAuth } from '../../lib/auth';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { FatSecretApiError, FatSecretClient, type RawFatSecretFoodGetResponse } from './fatsecretClient';
import { EXTERNAL_FOOD_DETAILS_HOURLY_LIMIT, EXTERNAL_FOOD_DETAILS_WINDOW_MS, FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET } from './fatsecretConfig';
import { enforceExternalFoodRateLimit } from './rateLimit';
import { mapFatSecretFoodGetToFoodLogRecord } from '../shared/nutrition/foodLog/fatsecretFoodGetMapper';
import { foodLogId, normalizeFoodLogRecord, normalizeSearchText } from '../shared/nutrition/foodLog/normalize';
import type { FoodLogEntry } from '../shared/types/nutrition';

const FATSECRET_LIVE_CATALOG_VERSION = 'fatsecret-live-v1';

interface MaterializeExternalFoodData { sourceId: string }
export type MaterializeExternalFoodResult = FoodLogEntry;

function parseData(data: unknown): MaterializeExternalFoodData {
  const invalid = (): never => { throw new HttpsError('invalid-argument', 'INVALID_REQUEST'); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'sourceId')) return invalid();
  if (typeof value.sourceId !== 'string' || !/^[0-9]{1,20}$/.test(value.sourceId)) return invalid();
  return { sourceId: value.sourceId };
}

/**
 * Pre-write dedup lookup, same priority order
 * `src/services/foodLogCatalog.ts`'s client-side `findExistingFoodLogEntryForExternal`
 * documents (barcode > provider/sourceId > brand+name > textual similarity
 * deferred) — reimplemented here against the Admin SDK directly rather
 * than reusing the client's `searchFoodLogCatalog` (that function is
 * firebase/firestore-client-SDK-only and pulls in the full ranking/
 * synonym search stack this dedup check doesn't need).
 */
async function findExistingFoodLogEntry(
  db: Firestore, barcode: string | null | undefined, name: string, brandName: string | null | undefined,
): Promise<FoodLogEntry | null> {
  if (barcode) {
    const byBarcode = await db.collection('foodLogCatalog')
      .where('barcode', '==', barcode).where('status', '==', 'active').limit(1).get();
    if (!byBarcode.empty) return byBarcode.docs[0].data() as FoodLogEntry;
  }
  const normalizedName = normalizeSearchText(name);
  const anchor = normalizedName.split(' ')[0]?.slice(0, 32);
  if (!anchor || anchor.length < 2) return null;
  const candidates = await db.collection('foodLogCatalog')
    .where('searchPrefixes', 'array-contains', anchor).where('status', '==', 'active').limit(25).get();
  const targetBrand = brandName ? normalizeSearchText(brandName) : null;
  for (const document of candidates.docs) {
    const food = document.data() as FoodLogEntry;
    if (normalizeSearchText(food.name) === normalizedName
      && (food.brand?.name ? normalizeSearchText(food.brand.name) : null) === targetBrand) return food;
  }
  return null;
}

/**
 * Materializes ONE FatSecret item into `foodLogCatalog` with the Admin
 * SDK — the ONLY path that may ever write that collection (Firestore
 * rules: `allow write: if false` for clients). Security fix: the client
 * used to build its own `FoodLogEntry` from the search result and
 * `setDoc` it directly; that write was already dead on arrival given the
 * existing rules, and — had rules ever been loosened — would have let a
 * client dictate arbitrary nutrition values for a document every other
 * user's search/diary also reads. The client now only ever supplies a
 * `food_id`; this handler re-fetches the food from FatSecret with the
 * SERVER's own secret, maps + normalizes it
 * (`fatsecretFoodGetMapper.ts`/`normalizeFoodLogRecord`, the exact same
 * code every other food-log source is validated through), dedups, and
 * writes — or returns the existing/deduped doc untouched.
 *
 * Idempotent: `foodLogId('fatsecret', sourceId)` is deterministic, so a
 * repeated call for the same item — even racing from two devices — just
 * re-derives and overwrites the same document with equivalent data.
 */
export async function materializeExternalFoodHandler(
  request: CallableRequest,
  db: Firestore = defaultDb,
  clientFactory: (clientId: string, clientSecret: string) => FatSecretClient = (clientId, clientSecret) => new FatSecretClient({ clientId, clientSecret }),
): Promise<MaterializeExternalFoodResult> {
  const uid = requireAuth(request);
  const { sourceId } = parseData(request.data);
  try { await requireActiveAccount(uid, db); }
  catch { throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE'); }

  const id = foodLogId('fatsecret', sourceId);
  const existingById = await db.collection('foodLogCatalog').doc(id).get();
  if (existingById.exists) return existingById.data() as FoodLogEntry;

  const clientId = FATSECRET_CLIENT_ID.value();
  const clientSecret = FATSECRET_CLIENT_SECRET.value();
  if (!clientId.trim() || !clientSecret.trim()) throw new HttpsError('failed-precondition', 'EXTERNAL_FOOD_PROVIDER_UNAVAILABLE');

  await enforceExternalFoodRateLimit(db, uid, 'externalFoodMaterialize', EXTERNAL_FOOD_DETAILS_HOURLY_LIMIT, EXTERNAL_FOOD_DETAILS_WINDOW_MS, 'EXTERNAL_FOOD_MATERIALIZE_RATE_LIMIT');

  let response: RawFatSecretFoodGetResponse;
  try {
    const client = clientFactory(clientId, clientSecret);
    response = await client.getFood(sourceId);
  } catch (error) {
    if (error instanceof FatSecretApiError) {
      if (error.kind === 'rate_limited') throw new HttpsError('resource-exhausted', 'EXTERNAL_FOOD_MATERIALIZE_RATE_LIMIT');
      throw new HttpsError('unavailable', 'EXTERNAL_FOOD_PROVIDER_UNAVAILABLE');
    }
    throw new HttpsError('internal', 'EXTERNAL_FOOD_MATERIALIZE_FAILED');
  }
  if (!response.food?.food_name || !response.food.food_id) throw new HttpsError('not-found', 'EXTERNAL_FOOD_NOT_FOUND');

  const raw = mapFatSecretFoodGetToFoodLogRecord(response.food, FATSECRET_LIVE_CATALOG_VERSION);
  if (!raw) throw new HttpsError('failed-precondition', 'EXTERNAL_FOOD_UNMAPPABLE');
  let body: ReturnType<typeof normalizeFoodLogRecord>;
  try { body = normalizeFoodLogRecord(raw, FATSECRET_LIVE_CATALOG_VERSION); }
  catch { throw new HttpsError('failed-precondition', 'EXTERNAL_FOOD_INVALID'); }

  const existing = await findExistingFoodLogEntry(db, body.barcode, body.name, body.brand?.name);
  if (existing) return existing;

  const now = Timestamp.now();
  const finalBody: FoodLogEntry = { ...body, createdAt: now, updatedAt: now, lastSyncedAt: now } as unknown as FoodLogEntry;
  await db.collection('foodLogCatalog').doc(id).set(finalBody);
  return finalBody;
}

export const materializeExternalFoodFatSecret = onCall(
  { enforceAppCheck: true, timeoutSeconds: 30, secrets: [FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET] },
  (request) => materializeExternalFoodHandler(request),
);
