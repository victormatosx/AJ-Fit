import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { requireAuth } from '../../lib/auth';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { FatSecretApiError, FatSecretClient, type RawFatSecretFoodGetResponse } from './fatsecretClient';
import { fetchOffProductByBarcode } from './offLiveClient';
import {
  EXTERNAL_FOOD_BARCODE_HOURLY_LIMIT, EXTERNAL_FOOD_BARCODE_WINDOW_MS, FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET,
} from './fatsecretConfig';
import { enforceExternalFoodRateLimit } from './rateLimit';
import { evaluateOffProductQuality } from '../shared/nutrition/foodLog/offQualityFilter';
import { toOffFoodLogRecord } from '../shared/nutrition/foodLog/offMapper';
import { mapFatSecretFoodGetToFoodLogRecord } from '../shared/nutrition/foodLog/fatsecretFoodGetMapper';
import {
  foodLogId, normalizeBarcode, normalizeFoodLogRecord, normalizeSearchText, type RawFoodLogRecord,
} from '../shared/nutrition/foodLog/normalize';
import type { FoodLogEntry } from '../shared/types/nutrition';

const OFF_LIVE_CATALOG_VERSION = 'off-live-v1';
const FATSECRET_LIVE_CATALOG_VERSION = 'fatsecret-live-v1';

export type ResolveFoodByBarcodeStatus = 'local' | 'materialized' | 'not_found';
export interface ResolveFoodByBarcodeResult { status: ResolveFoodByBarcodeStatus; entry?: FoodLogEntry }

interface ResolveFoodByBarcodeData { barcode: string }

function parseData(data: unknown): ResolveFoodByBarcodeData {
  const invalid = (): never => { throw new HttpsError('invalid-argument', 'INVALID_REQUEST'); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'barcode')) return invalid();
  if (typeof value.barcode !== 'string') return invalid();
  const barcode = normalizeBarcode(value.barcode);
  if (!barcode) return invalid();
  return { barcode };
}

async function findLocalByBarcode(db: Firestore, barcode: string): Promise<FoodLogEntry | null> {
  const snap = await db.collection('foodLogCatalog').where('barcode', '==', barcode).where('status', '==', 'active').limit(1).get();
  return snap.empty ? null : snap.docs[0].data() as FoodLogEntry;
}

/**
 * Same priority-ordered dedup `materializeExternalFood.ts`'s own
 * `findExistingFoodLogEntry` uses: barcode first (works ACROSS providers
 * — an OFF item and a FatSecret item for the same physical product share
 * a barcode even though their deterministic doc ids differ), then
 * brand+normalized-name. Re-checked here (not just the handler's own
 * pre-write `findLocalByBarcode`) because two users scanning the same NEW
 * barcode concurrently can both pass that earlier check before either has
 * written — this is the actual race-safety net (round brief §7).
 */
async function findExistingFoodLogEntry(
  db: Firestore, barcode: string, name: string, brandName: string | null | undefined,
): Promise<FoodLogEntry | null> {
  const byBarcode = await findLocalByBarcode(db, barcode);
  if (byBarcode) return byBarcode;
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

/** Idempotent write under a deterministic id — a repeated/racing call for the same barcode re-derives and overwrites the same document with equivalent data, or returns the already-materialized/deduped doc untouched. */
async function materialize(db: Firestore, id: string, body: ReturnType<typeof normalizeFoodLogRecord>): Promise<FoodLogEntry> {
  const existing = await findExistingFoodLogEntry(db, body.barcode!, body.name, body.brand?.name);
  if (existing) return existing;
  const now = Timestamp.now();
  const finalBody = { ...body, createdAt: now, updatedAt: now, lastSyncedAt: now } as unknown as FoodLogEntry;
  await db.collection('foodLogCatalog').doc(id).set(finalBody);
  return finalBody;
}

/**
 * Live, single-barcode OFF lookup — primary leg (free, no credentials,
 * always attempted first per round brief §2: "Reaproveitar a arquitetura
 * federada atual"). Returns `null` for ANY failure to resolve (not found,
 * failed quality gate, unmappable, transport error) — every case falls
 * through to the FatSecret leg rather than surfacing a hard error; only
 * `evaluateOffProductQuality`'s gate (round brief §4: "Não aceitar produto
 * externo quebrado") decides whether OFF's data was good enough, same gate
 * the bulk importer uses.
 */
async function tryOff(db: Firestore, barcode: string, fetchImpl: typeof fetch): Promise<FoodLogEntry | null> {
  let product;
  try { product = await fetchOffProductByBarcode(barcode, fetchImpl); }
  catch { return null; }
  if (!product) return null;
  const quality = evaluateOffProductQuality(product);
  if (!quality.ok) return null;
  const raw: RawFoodLogRecord = { ...toOffFoodLogRecord(product, OFF_LIVE_CATALOG_VERSION), barcode };
  let body: ReturnType<typeof normalizeFoodLogRecord>;
  try { body = normalizeFoodLogRecord(raw, OFF_LIVE_CATALOG_VERSION); }
  catch { return null; }
  return materialize(db, foodLogId('off', barcode), body);
}

/**
 * FatSecret fallback leg: `food.find_id_for_barcode` resolves the GTIN to
 * a `food_id`, then `food.get.v2` fetches the structured nutrition/serving
 * data — the exact same two-call sequence `fatsecretClient.ts`'s own doc
 * comments anticipate. `raw.barcode` is forced to the SCANNED barcode
 * (FatSecret's `food.get` response never echoes it back) so a
 * FatSecret-sourced materialization is still barcode-dedupable against a
 * later OFF-sourced scan of the same physical product, and so the NEXT
 * scan of this barcode resolves locally without ever calling either
 * provider again.
 */
async function tryFatSecret(
  db: Firestore, barcode: string,
  clientFactory: (clientId: string, clientSecret: string) => FatSecretClient,
): Promise<FoodLogEntry | null> {
  const clientId = FATSECRET_CLIENT_ID.value();
  const clientSecret = FATSECRET_CLIENT_SECRET.value();
  if (!clientId.trim() || !clientSecret.trim()) return null;
  try {
    const client = clientFactory(clientId, clientSecret);
    const barcodeResponse = await client.findByBarcode(barcode);
    const rawId = barcodeResponse.food_id;
    const foodId = typeof rawId === 'string' ? rawId : rawId?.value;
    if (!foodId || !/^[0-9]{1,20}$/.test(foodId)) return null;
    const foodGetResponse: RawFatSecretFoodGetResponse = await client.getFood(foodId);
    if (!foodGetResponse.food?.food_name || !foodGetResponse.food.food_id) return null;
    const raw = mapFatSecretFoodGetToFoodLogRecord(foodGetResponse.food, FATSECRET_LIVE_CATALOG_VERSION);
    if (!raw) return null;
    let body: ReturnType<typeof normalizeFoodLogRecord>;
    try { body = normalizeFoodLogRecord({ ...raw, barcode }, FATSECRET_LIVE_CATALOG_VERSION); }
    catch { return null; }
    return materialize(db, foodLogId('fatsecret', foodId), body);
  } catch (error) {
    if (error instanceof FatSecretApiError) return null;
    throw error;
  }
}

/**
 * Barcode-scan resolution + materialization (round brief: "leitura de
 * código de barras de alimentos"). Local-first (a pre-write read, same
 * optimization `ensureFoodLogEntryMaterialized` already does client-side
 * — saves the external round trip AND the rate-limit charge entirely when
 * the barcode is already cataloged), then OFF live, then FatSecret,
 * returning `not_found` only once both legs have genuinely failed to
 * resolve it — never fabricating macros for an unknown product (round
 * brief §4).
 */
export async function resolveFoodByBarcodeHandler(
  request: CallableRequest,
  db: Firestore = defaultDb,
  fatSecretClientFactory: (clientId: string, clientSecret: string) => FatSecretClient = (clientId, clientSecret) => new FatSecretClient({ clientId, clientSecret }),
  offFetchImpl: typeof fetch = fetch,
): Promise<ResolveFoodByBarcodeResult> {
  const uid = requireAuth(request);
  const { barcode } = parseData(request.data);
  try { await requireActiveAccount(uid, db); }
  catch { throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE'); }

  const local = await findLocalByBarcode(db, barcode);
  if (local) return { status: 'local', entry: local };

  await enforceExternalFoodRateLimit(
    db, uid, 'externalFoodBarcode', EXTERNAL_FOOD_BARCODE_HOURLY_LIMIT, EXTERNAL_FOOD_BARCODE_WINDOW_MS, 'EXTERNAL_FOOD_BARCODE_RATE_LIMIT',
  );

  const off = await tryOff(db, barcode, offFetchImpl);
  if (off) return { status: 'materialized', entry: off };

  const fatsecret = await tryFatSecret(db, barcode, fatSecretClientFactory);
  if (fatsecret) return { status: 'materialized', entry: fatsecret };

  return { status: 'not_found' };
}

export const resolveFoodByBarcode = onCall(
  { enforceAppCheck: true, timeoutSeconds: 30, secrets: [FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET] },
  (request) => resolveFoodByBarcodeHandler(request),
);
