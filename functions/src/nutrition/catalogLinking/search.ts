import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import type { FoodLogEntry, NutritionFood } from '../shared/types/nutrition';
import { buildFoodLogSearchPlan } from '../shared/nutrition/foodLog/search';
import { normalizeSearchText } from '../shared/nutrition/catalog/normalize';

export type CatalogCollection = 'nutritionFoods' | 'foodLogCatalog';
export interface CatalogCandidate { collection: CatalogCollection; food: NutritionFood | FoodLogEntry }
export interface CatalogPage { candidates: CatalogCandidate[]; nextCursor: string | null }
export interface CatalogReader {
  page(collection: CatalogCollection, term: string, cursor: string | null, size: number): Promise<CatalogPage>;
  get(collection: CatalogCollection, id: string): Promise<CatalogCandidate | null>;
}
export function firestoreCatalogReader(db: Firestore): CatalogReader {
  return {
    async page(collection, term, cursor, size) {
      // One single-field array index + document ID. No new composite index required.
      let query = db.collection(collection).where('searchPrefixes', 'array-contains', term)
        .orderBy(FieldPath.documentId()).limit(size);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      return { candidates: snap.docs.map((d) => ({ collection, food: { ...d.data(), id: d.id } as NutritionFood | FoodLogEntry })),
        nextCursor: snap.size === size ? snap.docs.at(-1)!.id : null };
    },
    async get(collection, id) {
      const snap = await db.collection(collection).doc(id).get();
      return snap.exists ? { collection, food: { ...snap.data(), id: snap.id } as NutritionFood | FoodLogEntry } : null;
    },
  };
}
export type CatalogFailureReason = 'not_found' | 'ambiguous' | 'nutrition' | 'restriction' | 'preparation'
  | 'identity' | 'quantity' | 'budget' | 'timeout' | 'unavailable' | 'changed' | 'practicality';
export class CatalogResolutionError extends Error {
  constructor(readonly reason: CatalogFailureReason, readonly repair?: { unresolvedFood: string; candidates: string[] }) { super(`CATALOG_${reason.toUpperCase()}`); }
}
export interface CatalogMetrics {
  requested: number; matched: number; rejected: number; queries: number; reads: number; examined: number;
  pages: number; cacheHits: number; searchMs: number; corrections: number;
  sources: { taco: number; off: number }; failures: Partial<Record<CatalogFailureReason, number>>;
}
export class CatalogSearchSession {
  readonly metrics: CatalogMetrics = { requested: 0, matched: 0, rejected: 0, queries: 0, reads: 0, examined: 0,
    pages: 0, cacheHits: 0, searchMs: 0, corrections: 0, sources: { taco: 0, off: 0 }, failures: {} };
  private cache = new Map<string, CatalogCandidate[]>();
  constructor(readonly reader: CatalogReader, readonly deadline = Date.now() + 30_000,
    readonly maxReads = 1600, readonly maxQueries = 100) {}
  check() {
    if (Date.now() >= this.deadline) throw new CatalogResolutionError('timeout');
  }
  async bounded<T>(operation: Promise<T>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CatalogResolutionError('timeout')), Math.max(1, Math.min(10_000, this.deadline - Date.now())));
    })]); } catch (error) {
      if (error instanceof CatalogResolutionError) throw error;
      throw new CatalogResolutionError('unavailable');
    } finally { clearTimeout(timer); }
  }
  async *candidates(text: string, exactOnly = false): AsyncGenerator<CatalogCandidate> {
    const normalized = normalizeSearchText(text);
    const cacheKey = `${exactOnly}:${normalized}`;
    const cached = this.cache.get(cacheKey);
    if (cached) { this.metrics.cacheHits++; yield* cached; return; }
    const { anchorTerms } = buildFoodLogSearchPlan(text);
    // Complementary whole-phrase prefix helps precise products; no ranked candidates are discarded.
    const complements = normalized.split(' ').filter(t => t.length >= 3).slice(0, 5);
    const terms = [...new Set(exactOnly ? [normalized.slice(0, 32)] : [...anchorTerms, ...complements].map(t => t.slice(0, 32)))].filter(t => t.length >= 2);
    const found: CatalogCandidate[] = []; const seen = new Set<string>();
    const started = Date.now();
    try {
      for (const term of terms) for (const collection of ['nutritionFoods', 'foodLogCatalog'] as const) {
        let cursor: string | null = null;
        do {
          this.check();
          const size = Math.min(40, this.maxReads - this.metrics.reads);
          if (size < 1 || this.metrics.queries >= this.maxQueries) throw new CatalogResolutionError('budget');
          this.metrics.queries++;
          const page: CatalogPage = await this.bounded(this.reader.page(collection, term, cursor, size));
          this.metrics.reads += Math.max(1, page.candidates.length); this.metrics.pages++;
          for (const candidate of page.candidates) {
            const key = `${collection}/${candidate.food.id}`;
            if (seen.has(key)) continue;
            seen.add(key); found.push(candidate); this.metrics.examined++;
            yield candidate;
          }
          if (page.nextCursor && page.nextCursor === cursor) throw new CatalogResolutionError('unavailable');
          cursor = page.nextCursor;
        } while (cursor);
      }
      this.cache.set(cacheKey, found);
    } finally { this.metrics.searchMs += Date.now() - started; }
  }
  async verify(candidate: CatalogCandidate): Promise<CatalogCandidate> {
    if (this.metrics.reads >= this.maxReads || this.metrics.queries >= this.maxQueries) throw new CatalogResolutionError('budget');
    this.metrics.reads++; this.metrics.queries++;
    const current = await this.bounded(this.reader.get(candidate.collection, candidate.food.id));
    if (!current) throw new CatalogResolutionError('changed');
    return current;
  }
}
