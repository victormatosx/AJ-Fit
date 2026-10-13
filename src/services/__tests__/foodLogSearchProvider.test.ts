import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));

import { createLocalFoodLogSearchProvider, decodeFoodLogSearchCursor, encodeFoodLogSearchCursor } from '../foodLogCatalog';
import type { FoodSearchProvider } from '../../nutrition/foodLog/searchProvider';

describe('createLocalFoodLogSearchProvider', () => {
  it('conforms to the FoodSearchProvider interface — a future external provider is a drop-in alternative', () => {
    const provider: FoodSearchProvider = createLocalFoodLogSearchProvider();
    expect(provider.providerName).toBe('local');
    expect(typeof provider.search).toBe('function');
  });

  it('rejects too-short queries the same way searchFoodLogCatalog does (delegates, does not reimplement validation)', async () => {
    const provider = createLocalFoodLogSearchProvider();
    await expect(provider.search('a')).rejects.toThrow('INVALID_CATALOG_SEARCH');
  });

  it('round-trips an opaque value cursor and rejects legacy/malformed values', () => {
    const encoded = encodeFoodLogSearchCursor({ priority: 0, id: 'flc_taco/a:b' });
    expect(decodeFoodLogSearchCursor(encoded)).toEqual({ priority: 0, id: 'flc_taco/a:b' });
    expect(decodeFoodLogSearchCursor('flc_old_cursor')).toBeNull();
    expect(decodeFoodLogSearchCursor('v1:9:x')).toBeNull();
  });
});
