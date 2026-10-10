import type { FoodLogEntry } from '../../types/nutrition';
import { normalizeSearchText } from './normalize';
import { expandSynonyms } from './aliases';

export interface RankContext {
  /** Ids the user has favorited. Personalization breaks ties inside a semantic tier; it never beats a more relevant result. */
  favoriteIds?: ReadonlySet<string>;
  /** Ids the user logged recently — below favorites, also only inside the same semantic tier. */
  recentIds?: ReadonlySet<string>;
}

function tokensOf(value: string): string[] {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

/**
 * Deterministic ranking (round brief C2 Part 10, refined in C3 Part 6) —
 * no ML, no personalization beyond the caller-supplied favorite/recent id
 * sets. Pure (no Firestore/firebase import) so it can run from a plain
 * Node CLI (`scripts/nutrition/foodLog/searchBenchmark.ts`) as well as the
 * client search service, and so it can be swapped for a real search
 * engine's relevance score later
 * (`docs/nutrition/catalog-expansion/06_federated_search_architecture.md`)
 * without touching either caller.
 *
 * Tiers (lowest number wins):
 * 0. exact normalized name match (synonym-aware)
 * 1. exact non-brand alias match (synonym-aware)
 * 2. query/synonym is the first whole token of the name
 * 3. every meaningful query token occurs as a whole token in the name
 * 4. exact brand alias match
 * 5. every meaningful query token occurs in name/aliases
 * 6. single whole-word token match — the query (or a synonym) equals one whole word of the
 *    name/alias, stronger signal than a mid-word substring (e.g. "ovo"
 *    matching the standalone word "ovo" in "Ovo, de galinha, cru", not a
 *    coincidental substring buried in an unrelated product name)
 * 7. name starts with the query
 * 8. contains (substring) match
 * 9. everything else (reached only via an `array-contains-any` synonym
 *    match that isn't textually explainable any other way)
 *
 * Within equal tiers: generic sources (TACO/TBCA) rank before branded
 * sources (OFF/FatSecret) — round brief: "genérico BR relevante" before
 * "produto de marca" — then alphabetical (pt-BR) as the final, stable
 * tie-break.
 */
export function rankFoodLogResults<TTimestamp = unknown>(
  entries: readonly FoodLogEntry<TTimestamp>[], query_: string, context: RankContext = {},
): FoodLogEntry<TTimestamp>[] {
  const normalizedQuery = normalizeSearchText(query_);
  const needleVariants = expandSynonyms(normalizedQuery);
  const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'a', 'o', 'em']);
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length >= 2 && !stopwords.has(token));
  const tier = (food: FoodLogEntry<TTimestamp>): number => {
    const name = normalizeSearchText(food.name);
    const aliasNorms = food.aliases.map((alias) => normalizeSearchText(alias));
    const brand = food.brand?.name ? normalizeSearchText(food.brand.name) : null;
    const lexicalAliases = brand ? aliasNorms.filter((alias) => alias !== brand) : aliasNorms;
    if (needleVariants.includes(name)) return 0;
    if (lexicalAliases.some((alias) => needleVariants.includes(alias))) return 1;
    const nameTokens = tokensOf(food.name);
    const aliasTokens = aliasNorms.flatMap((alias) => alias.split(' '));
    if (needleVariants.some((needle) => nameTokens[0] === needle)) return 2;
    if (queryTokens.length > 0 && queryTokens.every((token) => expandSynonyms(token).some((variant) => nameTokens.includes(variant)))) return 3;
    if (brand && needleVariants.includes(brand)) return 4;
    const allTokens = [...nameTokens, ...aliasTokens];
    if (queryTokens.length > 0 && queryTokens.every((token) => expandSynonyms(token).some((variant) => allTokens.includes(variant)))) return 5;
    if (needleVariants.some((needle) => nameTokens.includes(needle) || aliasTokens.includes(needle))) return 6;
    if (needleVariants.some((needle) => name.startsWith(needle))) return 7;
    if (needleVariants.some((needle) => name.includes(needle) || aliasNorms.some((alias) => alias.includes(needle)))) return 8;
    return 9;
  };
  const personalRank = (food: FoodLogEntry<TTimestamp>): number => context.favoriteIds?.has(food.id) ? 0
    : context.recentIds?.has(food.id) ? 1 : 2;
  const queryMentionsBrand = (food: FoodLogEntry<TTimestamp>): boolean => {
    if (!food.brand?.name) return false;
    const brand = normalizeSearchText(food.brand.name);
    return normalizedQuery === brand || normalizedQuery.startsWith(`${brand} `)
      || normalizedQuery.endsWith(` ${brand}`) || normalizedQuery.includes(` ${brand} `);
  };
  // A single bad/community-supplied OFF brand can itself be a generic food
  // word (observed: brand="Sopa", product="Vono"). Require corroboration
  // from at least two candidates before brand matching may override normal
  // lexical tiers; real catalog brands such as Nestlé/Danone have many.
  const hasBrandIntent = entries.filter(queryMentionsBrand).length >= 2;
  const sourceRank = (food: FoodLogEntry<TTimestamp>): number => (food.source.type === 'taco' || food.source.type === 'tbca' ? 0 : 1);
  return [...entries].sort((a, b) => {
    if (hasBrandIntent) {
      const brandDiff = Number(queryMentionsBrand(b)) - Number(queryMentionsBrand(a));
      if (brandDiff !== 0) return brandDiff;
    }
    const tierDiff = tier(a) - tier(b);
    if (tierDiff !== 0) return tierDiff;
    const personalDiff = personalRank(a) - personalRank(b);
    if (personalDiff !== 0) return personalDiff;
    const sourceDiff = sourceRank(a) - sourceRank(b);
    if (sourceDiff !== 0) return sourceDiff;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/**
 * Presentation-only dedupe. Documents and nutrition values remain
 * independent in Firestore; only the inferior duplicate is omitted from
 * this ranked response. Barcode is authoritative. Without a barcode, only
 * exact normalized name+brand duplicates are collapsed.
 */
export function dedupeFoodLogSearchResults<TTimestamp>(
  entries: readonly FoodLogEntry<TTimestamp>[],
): FoodLogEntry<TTimestamp>[] {
  const seenIdentity = new Set<string>();
  const seenBarcode = new Set<string>();
  const seenPresentation = new Set<string>();
  return entries.filter((food) => {
    const identity = `${food.source.type}:${food.source.sourceId}`;
    const barcode = food.barcode?.trim() || null;
    const presentation = `${normalizeSearchText(food.name)}|${food.brand?.name ? normalizeSearchText(food.brand.name) : ''}`;
    if (seenIdentity.has(identity) || (barcode != null && seenBarcode.has(barcode)) || seenPresentation.has(presentation)) return false;
    seenIdentity.add(identity);
    if (barcode != null) seenBarcode.add(barcode);
    seenPresentation.add(presentation);
    return true;
  });
}
