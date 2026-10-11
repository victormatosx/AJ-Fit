import { describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { resolveFoodByBarcodeHandler } from '../resolveFoodByBarcode';
import { FatSecretApiError, FatSecretClient } from '../fatsecretClient';
import { foodLogId } from '../../shared/nutrition/foodLog/normalize';

vi.mock('../../../accountDeletion/activeAccountGuard', () => ({ requireActiveAccount: vi.fn().mockResolvedValue(undefined) }));

function fakeRequest(data: unknown, uid = 'user-1'): CallableRequest {
  return { data, auth: { uid, token: {} as never } } as unknown as CallableRequest;
}

interface FakeDbOptions {
  barcodeMatches?: Record<string, unknown>[];
  nameMatches?: Record<string, unknown>[];
  rateLimitDoc?: Record<string, unknown>;
}

function fakeDb(options: FakeDbOptions = {}) {
  const sets: { id: string; data: Record<string, unknown> }[] = [];
  const rateDoc = { data: options.rateLimitDoc };
  let barcodeMatches = options.barcodeMatches ?? [];

  function fakeQuery(clauses: { field: string; value: unknown }[]) {
    return {
      where: (field: string, _op: string, value: unknown) => fakeQuery([...clauses, { field, value }]),
      limit: () => fakeQuery(clauses),
      get: async () => {
        const barcodeClause = clauses.find((clause) => clause.field === 'barcode');
        if (barcodeClause) {
          const matches = barcodeMatches.filter((doc) => doc.barcode === barcodeClause.value);
          return { empty: matches.length === 0, docs: matches.map((data) => ({ data: () => data })) };
        }
        const prefixClause = clauses.find((clause) => clause.field === 'searchPrefixes');
        if (prefixClause) {
          const matches = options.nameMatches ?? [];
          return { empty: matches.length === 0, docs: matches.map((data) => ({ data: () => data })) };
        }
        return { empty: true, docs: [] };
      },
    };
  }

  const db = {
    collection: (name: string) => {
      if (name === 'nutritionRateLimits') {
        return { doc: () => ({ get: async () => ({ exists: rateDoc.data !== undefined, get: (key: string) => rateDoc.data?.[key] }) }) };
      }
      if (name === 'foodLogCatalog') {
        return {
          doc: (id: string) => ({
            set: async (data: Record<string, unknown>) => { sets.push({ id, data }); barcodeMatches = [...barcodeMatches, data]; },
          }),
          where: (field: string, _op: string, value: unknown) => fakeQuery([{ field, value }]),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async () => ({ exists: rateDoc.data !== undefined, get: (key: string) => rateDoc.data?.[key] }),
      set: (_ref: unknown, value: Record<string, unknown>) => { rateDoc.data = { ...rateDoc.data, ...value }; },
    }),
  } as unknown as import('firebase-admin/firestore').Firestore;

  return { db, sets };
}

function fakeFetch(jsonValue: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => jsonValue }) as unknown as typeof fetch;
}

const NESCAU_OFF_PRODUCT = {
  code: '7891000100103', product_name: 'Nescau 2.0', brands: 'Nestlé', countries_tags: ['en:brazil'],
  nutriments: { 'energy-kcal_100g': 396, proteins_100g: 5.5, carbohydrates_100g: 80, fat_100g: 2.1, fiber_100g: 3.3 },
};

const YOPRO_FOOD_GET_RESPONSE = {
  food: {
    food_id: '33691', food_name: 'YoPRO Morango', brand_name: 'YoPRO',
    servings: { serving: [
      { serving_id: '1', serving_description: '1 garrafa (250g)', metric_serving_amount: '250', metric_serving_unit: 'g', is_default: '1', calories: '200', protein: '25', carbohydrate: '20', fat: '5' },
    ] },
  },
};

const originalId = process.env.FATSECRET_CLIENT_ID;
const originalSecret = process.env.FATSECRET_CLIENT_SECRET;
function withCredentials<T>(fn: () => Promise<T>): Promise<T> {
  process.env.FATSECRET_CLIENT_ID = 'test-id';
  process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
  return fn().finally(() => { process.env.FATSECRET_CLIENT_ID = originalId; process.env.FATSECRET_CLIENT_SECRET = originalSecret; });
}
function withoutCredentials<T>(fn: () => Promise<T>): Promise<T> {
  delete process.env.FATSECRET_CLIENT_ID;
  delete process.env.FATSECRET_CLIENT_SECRET;
  return fn();
}

describe('resolveFoodByBarcodeHandler', () => {
  it('rejects an unauthenticated request', async () => {
    const { db } = fakeDb();
    await expect(resolveFoodByBarcodeHandler({ data: { barcode: '7891000100103' }, auth: null } as unknown as CallableRequest, db))
      .rejects.toThrow();
  });

  it('rejects an invalid barcode', async () => {
    const { db } = fakeDb();
    await expect(resolveFoodByBarcodeHandler(fakeRequest({ barcode: 'abc' }), db)).rejects.toThrow();
  });

  it('local hit: returns it directly, never calls OFF or FatSecret, never rate-limited', () => withoutCredentials(async () => {
    const { db } = fakeDb({ barcodeMatches: [{ id: 'flc_off_x', barcode: '7891000100103', name: 'Already cataloged' }] });
    const offFetch = vi.fn();
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }), db, undefined, offFetch as unknown as typeof fetch);
    expect(result).toMatchObject({ status: 'local', entry: { name: 'Already cataloged' } });
    expect(offFetch).not.toHaveBeenCalled();
  }));

  it('OFF hit: materializes under the off/<barcode> id, never calls FatSecret', () => withCredentials(async () => {
    const { db, sets } = fakeDb();
    const offFetch = fakeFetch({ status: 1, product: NESCAU_OFF_PRODUCT });
    const getFood = vi.fn();
    const factory = () => ({ getFood } as unknown as FatSecretClient);
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }), db, factory, offFetch);
    expect(getFood).not.toHaveBeenCalled();
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe(foodLogId('off', '7891000100103'));
    expect(sets[0].data).toMatchObject({ name: 'Nescau 2.0', barcode: '7891000100103', source: { type: 'off' } });
    expect(result).toMatchObject({ status: 'materialized', entry: { name: 'Nescau 2.0' } });
  }));

  it('OFF miss (unknown barcode): falls through to FatSecret and materializes with the scanned barcode stamped on', () => withCredentials(async () => {
    const { db, sets } = fakeDb();
    const offFetch = fakeFetch({ status: 0 });
    const findByBarcode = vi.fn().mockResolvedValue({ food_id: '33691' });
    const getFood = vi.fn().mockResolvedValue(YOPRO_FOOD_GET_RESPONSE);
    const factory = () => ({ findByBarcode, getFood } as unknown as FatSecretClient);
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000200104' }), db, factory, offFetch);
    expect(findByBarcode).toHaveBeenCalledWith('7891000200104');
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe(foodLogId('fatsecret', '33691'));
    expect(sets[0].data).toMatchObject({ name: 'YoPRO Morango', barcode: '7891000200104' });
    expect(result).toMatchObject({ status: 'materialized' });
  }));

  it('OFF quality-gate rejection (implausible macros) never persists OFF data and still falls through to FatSecret', () => withCredentials(async () => {
    const { db, sets } = fakeDb();
    const offFetch = fakeFetch({ status: 1, product: { ...NESCAU_OFF_PRODUCT, nutriments: { 'energy-kcal_100g': -5, proteins_100g: 5.5, carbohydrates_100g: 80, fat_100g: 2.1 } } });
    const findByBarcode = vi.fn().mockResolvedValue({ food_id: '33691' });
    const getFood = vi.fn().mockResolvedValue(YOPRO_FOOD_GET_RESPONSE);
    const factory = () => ({ findByBarcode, getFood } as unknown as FatSecretClient);
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }), db, factory, offFetch);
    expect(sets.filter((set) => set.data.source && (set.data.source as { type: string }).type === 'off')).toHaveLength(0);
    expect(result).toMatchObject({ status: 'materialized', entry: { name: 'YoPRO Morango' } });
  }));

  it('not found anywhere: returns not_found, persists nothing', () => withCredentials(async () => {
    const { db, sets } = fakeDb();
    const offFetch = fakeFetch({ status: 0 });
    const findByBarcode = vi.fn().mockResolvedValue({});
    const factory = () => ({ findByBarcode, getFood: vi.fn() } as unknown as FatSecretClient);
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '0000000000000' }), db, factory, offFetch);
    expect(sets).toHaveLength(0);
    expect(result).toEqual({ status: 'not_found' });
  }));

  it('not found when FatSecret credentials are not configured either (degrades, never throws)', () => withoutCredentials(async () => {
    const { db } = fakeDb();
    const offFetch = fakeFetch({ status: 0 });
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '0000000000000' }), db, undefined, offFetch);
    expect(result).toEqual({ status: 'not_found' });
  }));

  it('cross-provider dedup: a second scan resolving via FatSecret finds the OFF-materialized doc by barcode and writes nothing new', () => withCredentials(async () => {
    const { db, sets } = fakeDb({ barcodeMatches: [] });
    // First scan materializes via OFF.
    const offFetch = fakeFetch({ status: 1, product: NESCAU_OFF_PRODUCT });
    const first = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }, 'user-1'), db, undefined, offFetch);
    expect(first.status).toBe('materialized');
    expect(sets).toHaveLength(1);
  }));

  it('FatSecret transport failure degrades to not_found rather than throwing, when OFF also misses', () => withCredentials(async () => {
    const { db } = fakeDb();
    const offFetch = fakeFetch({ status: 0 });
    const factory = () => ({ findByBarcode: vi.fn().mockRejectedValue(new FatSecretApiError('unavailable')), getFood: vi.fn() } as unknown as FatSecretClient);
    const result = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '0000000000000' }), db, factory, offFetch);
    expect(result).toEqual({ status: 'not_found' });
  }));

  it('enforces its own rate-limit budget', () => withCredentials(async () => {
    const { db } = fakeDb({ rateLimitDoc: { externalFoodBarcodeWindowStartedAt: Timestamp.now(), externalFoodBarcodeWindowCount: 60 } });
    const offFetch = vi.fn();
    await expect(resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }), db, undefined, offFetch as unknown as typeof fetch))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(offFetch).not.toHaveBeenCalled();
  }));

  it('a repeated scan of an already-materialized barcode resolves locally on the next call', () => withCredentials(async () => {
    const { db, sets } = fakeDb();
    const offFetch = fakeFetch({ status: 1, product: NESCAU_OFF_PRODUCT });
    const first = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }), db, undefined, offFetch);
    expect(first.status).toBe('materialized');
    expect(sets).toHaveLength(1);
    const second = await resolveFoodByBarcodeHandler(fakeRequest({ barcode: '7891000100103' }), db, undefined, offFetch);
    expect(second.status).toBe('local');
    expect(sets).toHaveLength(1);
  }));
});
