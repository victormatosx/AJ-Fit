import { describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { materializeExternalFoodHandler } from '../materializeExternalFood';
import { FatSecretApiError, FatSecretClient } from '../fatsecretClient';
import { foodLogId } from '../../shared/nutrition/foodLog/normalize';

vi.mock('../../../accountDeletion/activeAccountGuard', () => ({ requireActiveAccount: vi.fn().mockResolvedValue(undefined) }));

function fakeRequest(data: unknown, uid = 'user-1'): CallableRequest {
  return { data, auth: { uid, token: {} as never } } as unknown as CallableRequest;
}

interface FakeDbOptions {
  existingById?: Record<string, Record<string, unknown>>;
  barcodeMatches?: Record<string, unknown>[];
  nameMatches?: Record<string, unknown>[];
  rateLimitDoc?: Record<string, unknown>;
}

function fakeDb(options: FakeDbOptions = {}) {
  const sets: { id: string; data: Record<string, unknown> }[] = [];
  const rateDoc = { data: options.rateLimitDoc };

  function fakeQuery(clauses: { field: string; value: unknown }[]) {
    return {
      where: (field: string, _op: string, value: unknown) => fakeQuery([...clauses, { field, value }]),
      limit: () => fakeQuery(clauses),
      get: async () => {
        const barcodeClause = clauses.find((clause) => clause.field === 'barcode');
        if (barcodeClause) {
          const matches = (options.barcodeMatches ?? []).filter((doc) => doc.barcode === barcodeClause.value);
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
        return {
          doc: () => ({
            get: async () => ({ exists: rateDoc.data !== undefined, get: (key: string) => rateDoc.data?.[key] }),
          }),
        };
      }
      if (name === 'foodLogCatalog') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: options.existingById?.[id] !== undefined, data: () => options.existingById?.[id] }),
            set: async (data: Record<string, unknown>) => { sets.push({ id, data }); },
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

const originalId = process.env.FATSECRET_CLIENT_ID;
const originalSecret = process.env.FATSECRET_CLIENT_SECRET;
function withCredentials<T>(fn: () => Promise<T>): Promise<T> {
  process.env.FATSECRET_CLIENT_ID = 'test-id';
  process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
  return fn().finally(() => { process.env.FATSECRET_CLIENT_ID = originalId; process.env.FATSECRET_CLIENT_SECRET = originalSecret; });
}

const YOPRO_FOOD_GET_RESPONSE = {
  food: {
    food_id: '33691', food_name: 'YoPRO Morango', brand_name: 'YoPRO',
    servings: { serving: [
      { serving_id: '1', serving_description: '1 garrafa (250g)', metric_serving_amount: '250', metric_serving_unit: 'g', is_default: '1', calories: '200', protein: '25', carbohydrate: '20', fat: '5' },
    ] },
  },
};

describe('materializeExternalFoodHandler', () => {
  it('rejects an unauthenticated request', async () => {
    const { db } = fakeDb();
    await expect(materializeExternalFoodHandler({ data: { sourceId: '33691' }, auth: null } as unknown as CallableRequest, db))
      .rejects.toThrow();
  });

  it('rejects a non-numeric sourceId — never passes client-controlled free text to the FatSecret call', async () => {
    const { db } = fakeDb();
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: 'not-a-food-id' }), db)).rejects.toThrow();
  });

  it('rejects a request carrying any field other than sourceId (e.g. a client-supplied name/macros)', async () => {
    const { db } = fakeDb();
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '33691', name: 'Injected Food', nutritionPer100g: { kcal: 1 } }), db))
      .rejects.toThrow();
  });

  it('returns the already-materialized doc by deterministic id, never calling FatSecret at all', async () => {
    const id = foodLogId('fatsecret', '33691');
    const { db } = fakeDb({ existingById: { [id]: { id, name: 'Already materialized' } } });
    const getFood = vi.fn();
    const factory = () => ({ getFood } as unknown as FatSecretClient);
    const result = await materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory);
    expect(getFood).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id, name: 'Already materialized' });
  });

  it('fails closed with EXTERNAL_FOOD_PROVIDER_UNAVAILABLE when no credentials are configured', async () => {
    delete process.env.FATSECRET_CLIENT_ID;
    delete process.env.FATSECRET_CLIENT_SECRET;
    const { db } = fakeDb();
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('fetches food.get, maps + normalizes it, and writes the materialized doc under the deterministic id', () => withCredentials(async () => {
    const { db, sets } = fakeDb();
    const getFood = vi.fn().mockResolvedValue(YOPRO_FOOD_GET_RESPONSE);
    const factory = () => ({ getFood } as unknown as FatSecretClient);
    const result = await materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory);
    expect(getFood).toHaveBeenCalledWith('33691');
    expect(sets).toHaveLength(1);
    expect(sets[0].data).toMatchObject({ name: 'YoPRO Morango', source: { type: 'fatsecret', sourceId: '33691' } });
    expect((sets[0].data as { nutritionPer100g: { kcal: number } }).nutritionPer100g.kcal).toBe(80);
    expect(result).toMatchObject({ name: 'YoPRO Morango' });
  }));

  it('dedups against an existing brand+name match and never writes a new doc', () => withCredentials(async () => {
    const { db, sets } = fakeDb({ nameMatches: [{ id: 'flc_off_existing', name: 'YoPRO Morango', brand: { name: 'YoPRO' } }] });
    const getFood = vi.fn().mockResolvedValue(YOPRO_FOOD_GET_RESPONSE);
    const factory = () => ({ getFood } as unknown as FatSecretClient);
    const result = await materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory);
    expect(sets).toHaveLength(0);
    expect(result).toMatchObject({ id: 'flc_off_existing' });
  }));

  it('throws EXTERNAL_FOOD_NOT_FOUND when FatSecret has no such food', () => withCredentials(async () => {
    const { db } = fakeDb();
    const getFood = vi.fn().mockResolvedValue({ food: undefined });
    const factory = () => ({ getFood } as unknown as FatSecretClient);
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory))
      .rejects.toMatchObject({ code: 'not-found' });
  }));

  it('throws EXTERNAL_FOOD_UNMAPPABLE when the food has no gram-based serving to derive per-100g from', () => withCredentials(async () => {
    const { db } = fakeDb();
    const getFood = vi.fn().mockResolvedValue({
      food: { food_id: '1', food_name: 'Coca-Cola Zero', servings: { serving: [
        { serving_description: '1 lata (350ml)', metric_serving_amount: '350', metric_serving_unit: 'ml', calories: '0', protein: '0', carbohydrate: '0', fat: '0' },
      ] } },
    });
    const factory = () => ({ getFood } as unknown as FatSecretClient);
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '1' }), db, factory))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  }));

  it('enforces its own rate-limit budget', () => withCredentials(async () => {
    const { db } = fakeDb({ rateLimitDoc: { externalFoodMaterializeWindowStartedAt: Timestamp.now(), externalFoodMaterializeWindowCount: 30 } });
    const factory = () => ({ getFood: vi.fn() } as unknown as FatSecretClient);
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
  }));

  it('maps a FatSecret rate-limit error from the client into resource-exhausted', () => withCredentials(async () => {
    const { db } = fakeDb();
    const factory = () => ({ getFood: vi.fn().mockRejectedValue(new FatSecretApiError('rate_limited', 429)) } as unknown as FatSecretClient);
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
  }));

  it('maps a FatSecret unavailable error into unavailable, never crashing the callable', () => withCredentials(async () => {
    const { db } = fakeDb();
    const factory = () => ({ getFood: vi.fn().mockRejectedValue(new FatSecretApiError('unavailable')) } as unknown as FatSecretClient);
    await expect(materializeExternalFoodHandler(fakeRequest({ sourceId: '33691' }), db, factory))
      .rejects.toMatchObject({ code: 'unavailable' });
  }));
});
