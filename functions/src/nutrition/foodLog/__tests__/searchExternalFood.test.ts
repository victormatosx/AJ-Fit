import { describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { searchExternalFoodHandler } from '../searchExternalFood';
import { FatSecretApiError, FatSecretClient } from '../fatsecretClient';

vi.mock('../../../accountDeletion/activeAccountGuard', () => ({ requireActiveAccount: vi.fn().mockResolvedValue(undefined) }));

function fakeRequest(data: unknown, uid = 'user-1'): CallableRequest {
  return { data, auth: { uid, token: {} as never } } as unknown as CallableRequest;
}

class FakeDocRef {
  data: Record<string, unknown> | undefined;
  get = vi.fn(async () => ({ exists: this.data !== undefined, get: (key: string) => this.data?.[key], data: () => this.data }));
}

function fakeDb(existing?: Record<string, unknown>) {
  const ref = new FakeDocRef();
  ref.data = existing;
  const sets: Record<string, unknown>[] = [];
  return {
    db: {
      collection: () => ({ doc: () => ref }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        get: async () => ref.get(),
        set: (_ref: unknown, value: Record<string, unknown>) => { sets.push(value); ref.data = { ...ref.data, ...value }; },
      }),
    } as unknown as import('firebase-admin/firestore').Firestore,
    sets,
  };
}

describe('searchExternalFoodHandler', () => {
  it('rejects an unauthenticated request', async () => {
    const { db } = fakeDb();
    await expect(searchExternalFoodHandler({ data: { query: 'yopro' }, auth: null } as unknown as CallableRequest, db))
      .rejects.toThrow();
  });

  it('rejects a too-short query', async () => {
    const { db } = fakeDb();
    await expect(searchExternalFoodHandler(fakeRequest({ query: 'a' }), db)).rejects.toThrow();
  });

  const originalId = process.env.FATSECRET_CLIENT_ID;
  const originalSecret = process.env.FATSECRET_CLIENT_SECRET;

  it('fails closed with EXTERNAL_FOOD_PROVIDER_UNAVAILABLE when no credentials are configured — never invents one', async () => {
    delete process.env.FATSECRET_CLIENT_ID;
    delete process.env.FATSECRET_CLIENT_SECRET;
    const { db } = fakeDb();
    await expect(searchExternalFoodHandler(fakeRequest({ query: 'yopro morango' }), db))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('calls the FatSecret client and returns its raw response once credentials exist', async () => {
    process.env.FATSECRET_CLIENT_ID = 'test-id';
    process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
    const { db } = fakeDb();
    const searchFoods = vi.fn().mockResolvedValue({ foods: { food: [{ food_id: '1', food_name: 'YoPRO Morango' }] } });
    const factory = () => ({ searchFoods } as unknown as FatSecretClient);

    const result = await searchExternalFoodHandler(fakeRequest({ query: 'yopro morango' }), db, factory);
    expect(result).toEqual({ provider: 'fatsecret', response: { foods: { food: [{ food_id: '1', food_name: 'YoPRO Morango' }] } } });
    expect(searchFoods).toHaveBeenCalledWith('yopro morango', 20);
    process.env.FATSECRET_CLIENT_ID = originalId;
    process.env.FATSECRET_CLIENT_SECRET = originalSecret;
  });

  it('enforces the per-uid hourly rate limit', async () => {
    process.env.FATSECRET_CLIENT_ID = 'test-id';
    process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
    const { db } = fakeDb({ externalFoodSearchWindowStartedAt: Timestamp.now(), externalFoodSearchWindowCount: 60 });
    const factory = () => ({ searchFoods: vi.fn() } as unknown as FatSecretClient);
    await expect(searchExternalFoodHandler(fakeRequest({ query: 'yopro morango' }), db, factory))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    process.env.FATSECRET_CLIENT_ID = originalId;
    process.env.FATSECRET_CLIENT_SECRET = originalSecret;
  });

  it('maps a FatSecret rate-limit error from the client into resource-exhausted', async () => {
    process.env.FATSECRET_CLIENT_ID = 'test-id';
    process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
    const { db } = fakeDb();
    const factory = () => ({ searchFoods: vi.fn().mockRejectedValue(new FatSecretApiError('rate_limited', 429)) } as unknown as FatSecretClient);
    await expect(searchExternalFoodHandler(fakeRequest({ query: 'yopro morango' }), db, factory))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    process.env.FATSECRET_CLIENT_ID = originalId;
    process.env.FATSECRET_CLIENT_SECRET = originalSecret;
  });

  it('maps a FatSecret network/unavailable error into unavailable, never crashing the callable', async () => {
    process.env.FATSECRET_CLIENT_ID = 'test-id';
    process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
    const { db } = fakeDb();
    const factory = () => ({ searchFoods: vi.fn().mockRejectedValue(new FatSecretApiError('unavailable')) } as unknown as FatSecretClient);
    await expect(searchExternalFoodHandler(fakeRequest({ query: 'yopro morango' }), db, factory))
      .rejects.toMatchObject({ code: 'unavailable' });
    process.env.FATSECRET_CLIENT_ID = originalId;
    process.env.FATSECRET_CLIENT_SECRET = originalSecret;
  });
});
