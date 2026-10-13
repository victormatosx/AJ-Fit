import { describe, expect, it } from 'vitest';
import { FoodLogSearchCache, searchCacheKey } from '../searchCache';

describe('FoodLogSearchCache', () => {
  it('distinguishes misses from hits and expires entries at the TTL', () => {
    let now = 100;
    const cache = new FoodLogSearchCache<string>({ ttlMs: 50, maxEntries: 2, now: () => now });
    expect(cache.get('a')).toBeNull();
    cache.set('a', 'value');
    expect(cache.get('a')).toBe('value');
    now = 150;
    expect(cache.get('a')).toBeNull();
  });

  it('is bounded and evicts the least recently used entry', () => {
    const cache = new FoodLogSearchCache<number>({ ttlMs: 100, maxEntries: 2, now: () => 0 });
    cache.set('a', 1); cache.set('b', 2); expect(cache.get('a')).toBe(1); cache.set('c', 3);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('uses cursor and pool size in the opaque key, keeping pagination pages isolated', () => {
    const first = searchCacheKey(['frango', '', '60']);
    const second = searchCacheKey(['frango', 'v1:0:abc', '60']);
    expect(first).not.toBe(second);
    expect(first).not.toContain('frango');
  });
});
