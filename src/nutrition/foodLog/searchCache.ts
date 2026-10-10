export interface SearchCacheOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

interface CacheEntry<T> { value: T; expiresAt: number }

/** Small in-memory TTL+LRU cache. It never persists queries or results. */
export class FoodLogSearchCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly now: () => number;

  constructor(private readonly options: SearchCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) throw new Error('INVALID_SEARCH_CACHE_TTL');
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) throw new Error('INVALID_SEARCH_CACHE_SIZE');
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.entries.delete(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest == null) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}

/** Fixed-size non-cryptographic key: raw food queries are not retained as cache keys. */
export function searchCacheKey(parts: readonly string[]): string {
  let hash = 5381;
  for (const char of parts.join('\u001f')) hash = (Math.imul(hash, 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
