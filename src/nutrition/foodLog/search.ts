import type { FoodLogEntry } from '../../types/nutrition';
import { normalizeSearchText } from './normalize';
import { expandSynonyms } from './aliases';

/**
 * Portuguese stopwords common in multi-word food queries ("peito DE
 * frango", "arroz COM feijão") — excluded both from anchor selection and
 * from the refine step, since requiring them to literally appear would
 * reject true matches over nothing but a preposition.
 */
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'a', 'o', 'em']);

export interface FoodLogSearchPlan {
  /** The single word Firestore is queried by (`searchPrefixes array-contains`) — the longest non-stopword word, since it's the most selective single `array-contains` term available. */
  anchorWord: string;
  /**
   * `anchorWord` plus its known synonym variants (`expandSynonyms`, e.g.
   * "mucarela" -> also "mussarela"), capped at 10 — Firestore's
   * `array-contains-any` limit. Querying with this list instead of the
   * bare `anchorWord` (Fase C3) means a user typing "mussarela" finds
   * foods indexed under "muçarela" and vice versa, without either being
   * re-indexed.
   */
  anchorTerms: string[];
  /** Remaining non-stopword words the candidate pool is refined by client-side (plain substring, not prefix — Firestore already did the selective part). */
  refineWords: string[];
}

/**
 * `searchFoodLogCatalog`'s one-`array-contains`-query-per-request
 * limitation (round brief C2 Part 9: "melhor solução intermediária" short
 * of a real search engine) means a multi-word query like "peito de
 * frango" can't be matched as one literal prefix — the stored name
 * ("Frango, peito, sem pele, cru") doesn't start with "peito". Splitting
 * the query, querying Firestore by its most selective single word, then
 * refining the candidate pool client-side by the remaining words closes
 * most of that gap without a new search infrastructure dependency.
 */
export function buildFoodLogSearchPlan(text: string): FoodLogSearchPlan {
  if (!text.trim()) return { anchorWord: '', anchorTerms: [], refineWords: [] };
  const words = normalizeSearchText(text).split(' ').filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  if (words.length === 0) {
    const whole = normalizeSearchText(text);
    return { anchorWord: whole, anchorTerms: whole ? expandSynonyms(whole).slice(0, 10) : [], refineWords: [] };
  }
  const [anchorWord, ...rest] = [...words].sort((a, b) => b.length - a.length || words.indexOf(a) - words.indexOf(b));
  return { anchorWord, anchorTerms: expandSynonyms(anchorWord).slice(0, 10), refineWords: rest };
}

/**
 * True when every refine word appears somewhere in the food's normalized
 * name or any alias — plain substring, since the candidate pool is
 * already anchor-matched. Each refine word is synonym-expanded too (Fase
 * C3), so "frango com mussarela" still matches a food whose stored name
 * only contains "muçarela".
 */
export function matchesRefineWords<TTimestamp>(food: FoodLogEntry<TTimestamp>, refineWords: readonly string[]): boolean {
  if (refineWords.length === 0) return true;
  const haystacks = [normalizeSearchText(food.name), ...food.aliases.map((alias) => normalizeSearchText(alias))];
  return refineWords.every((word) => expandSynonyms(word).some((variant) => haystacks.some((haystack) => haystack.includes(variant))));
}
