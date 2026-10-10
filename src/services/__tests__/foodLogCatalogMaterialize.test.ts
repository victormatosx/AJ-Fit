import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

type FakeDoc = { id: string; data: Record<string, unknown> };
let barcodeDocs: FakeDoc[] = [];
let byIdDocs: Record<string, Record<string, unknown>> = {};

// Deliberately NO `setDoc` export (Fase C8 security fix) — `foodLogCatalog.ts` must never write
// `foodLogCatalog` from the client; if it ever regressed to calling `setDoc` again, every test
// below that reaches the write path would fail with "setDoc is not a function", not silently pass.
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __kind: 'collection', name }),
  doc: (_db: unknown, _name: string, id: string) => ({ __kind: 'doc', id }),
  documentId: () => '__name__',
  query: (...args: unknown[]) => ({ __kind: 'query', args }),
  where: (field: string, _op: string, value: unknown) => ({ __kind: 'where', field, value }),
  orderBy: () => ({ __kind: 'orderBy' }),
  startAfter: () => ({ __kind: 'startAfter' }),
  limit: (n: number) => ({ __kind: 'limit', n }),
  getDoc: async (ref: { id: string }) => ({ exists: () => byIdDocs[ref.id] !== undefined, data: () => byIdDocs[ref.id] }),
  getDocs: async (q: { args: unknown[] }) => {
    const whereClauses = q.args.filter((arg): arg is { __kind: string; field: string; value: unknown } => (arg as { __kind?: string }).__kind === 'where');
    const barcodeClause = whereClauses.find((clause) => clause.field === 'barcode');
    if (barcodeClause) {
      const matches = barcodeDocs.filter((item) => item.data.barcode === barcodeClause.value);
      return { empty: matches.length === 0, docs: matches.map((item) => ({ id: item.id, data: () => item.data })), size: matches.length };
    }
    // Bounded prefix/anchor query used by `searchFoodLogCatalog`'s brand+name dedup check — no pre-seeded match in these tests.
    return { empty: true, docs: [], size: 0 };
  },
}));

import { ensureFoodLogEntryMaterialized } from '../foodLogCatalog';
import type { FoodLogEntry } from '../../types/nutrition';
import type { Timestamp } from 'firebase/firestore';

function externalFood(partial: Partial<FoodLogEntry<Timestamp>> = {}): FoodLogEntry<Timestamp> {
  return {
    id: 'flc_fatsecret_yopro_morango_abc12345', source: { type: 'fatsecret', sourceId: '33691', sourceName: 'FatSecret Platform API' },
    name: 'YoPRO Morango', aliases: ['YoPRO'], brand: { name: 'YoPRO' }, locale: 'pt-BR', region: 'BR',
    category: 'other', subCategory: 'branded_product', nutritionPer100g: { kcal: 80, proteinG: 10, carbsG: 8, fatG: 2 },
    status: 'active', provenance: { license: 'proprietary_contract', attributionRequired: true, attributionText: 'x' },
    catalogVersion: 'fatsecret-live-v1', searchPrefixes: ['yopro'], searchSourcePriority: 1,
    createdAt: {} as Timestamp, updatedAt: {} as Timestamp,
    ...partial,
  } as FoodLogEntry<Timestamp>;
}

const fakeFirestore = { __kind: 'fake-firestore' } as unknown as import('firebase/firestore').Firestore;

describe('ensureFoodLogEntryMaterialized (Fase C8 — server-side materialization)', () => {
  beforeEach(() => { barcodeDocs = []; byIdDocs = {}; });

  it('returns a local-sourced entry unchanged, never calls the backend at all', async () => {
    const local = externalFood({ id: 'flc_taco_x', source: { type: 'taco', sourceId: 'x', sourceName: 'TACO' } });
    const materializeExternalFood = vi.fn();
    const result = await ensureFoodLogEntryMaterialized(local, fakeFirestore, materializeExternalFood);
    expect(result).toBe(local);
    expect(materializeExternalFood).not.toHaveBeenCalled();
  });

  it('returns the already-materialized doc when the deterministic id already exists — never calls the backend', async () => {
    const entry = externalFood();
    byIdDocs[entry.id] = { ...entry, name: 'Already materialized' };
    const materializeExternalFood = vi.fn();
    const result = await ensureFoodLogEntryMaterialized(entry, fakeFirestore, materializeExternalFood);
    expect((result as { name: string }).name).toBe('Already materialized');
    expect(materializeExternalFood).not.toHaveBeenCalled();
  });

  it('dedupes against an existing barcode match across providers WITHOUT calling the backend — a pure client-side read optimization', async () => {
    const entry = externalFood({ barcode: '7891000100103' });
    barcodeDocs = [{ id: 'flc_off_existing', data: { id: 'flc_off_existing', barcode: '7891000100103', name: 'Existing OFF item' } }];
    const materializeExternalFood = vi.fn();
    const result = await ensureFoodLogEntryMaterialized(entry, fakeFirestore, materializeExternalFood);
    expect((result as { id: string }).id).toBe('flc_off_existing');
    expect(materializeExternalFood).not.toHaveBeenCalled();
  });

  it('calls the backend materialize callable (by sourceId only) for a genuinely new external item — never writes from the client', async () => {
    const entry = externalFood();
    const materialized = { ...entry, servings: [{ id: 'fs-1', label: '1 garrafa (250 g)', quantity: 1, gramEquivalent: 250, provenance: 'provider_official' }] };
    const materializeExternalFood = vi.fn().mockResolvedValue(materialized);
    const result = await ensureFoodLogEntryMaterialized(entry, fakeFirestore, materializeExternalFood);
    expect(materializeExternalFood).toHaveBeenCalledWith('33691'); // entry.source.sourceId — never the name/macros themselves
    expect(materializeExternalFood).toHaveBeenCalledTimes(1);
    expect(result).toBe(materialized);
  });

  it('propagates a backend failure (rate limit, provider unavailable, ...) rather than falling back to a client write', async () => {
    const entry = externalFood();
    const materializeExternalFood = vi.fn().mockRejectedValue(new Error('EXTERNAL_FOOD_PROVIDER_UNAVAILABLE'));
    await expect(ensureFoodLogEntryMaterialized(entry, fakeFirestore, materializeExternalFood)).rejects.toThrow('EXTERNAL_FOOD_PROVIDER_UNAVAILABLE');
  });

});
