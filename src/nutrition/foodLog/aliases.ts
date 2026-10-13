function normalizeAliasKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

/**
 * Canonical synonym groups for Fase C3 (`docs/nutrition/catalog-expansion/14_c3_external_providers.md`
 * is NOT where this lives — this is query-time, not a provider concern).
 * Deliberately SMALL and curated, not an auto-generated or per-food list
 * (round brief C3 Part 5: "não criar uma lista gigantesca aleatória") —
 * each group is a genuine PT-BR orthographic/loanword variant that
 * `normalizeSearchText`'s accent/punctuation stripping cannot resolve on
 * its own (different letters, not just accents — e.g. "mussarela" vs.
 * "muçarela" differ in "ss" vs "ç", not in an accent).
 *
 * All entries are already `normalizeSearchText`-normalized (lowercase,
 * no accents) so they can be compared directly against query/stored
 * tokens without re-normalizing here.
 */
export const FOOD_LOG_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['mucarela', 'mussarela', 'mussarella', 'mozarela', 'muzzarella'],
  ['estrogonofe', 'strogonoff', 'stroganoff', 'estrogonoff'],
  ['contrafile', 'contra file'],
  ['moida', 'moido'],
  // The real C3 corpus contains an English-labelled OFF supplement
  // (`MULTIVITAMINS + MINERALS MAN`) but no Portuguese-labelled product.
  // This is a genuine lexical equivalence, not a synthetic food.
  ['multivitaminico', 'multivitamin', 'multivitamins', 'complexo vitaminico'],
];

const SYNONYM_INDEX = new Map<string, readonly string[]>();
for (const group of FOOD_LOG_SYNONYM_GROUPS) {
  for (const member of group) SYNONYM_INDEX.set(member, group);
}

/** `word` plus every other member of its synonym group (itself included, deduped), or just `[word]` if it belongs to no group. */
export function expandSynonyms(word: string): string[] {
  const normalized = normalizeAliasKey(word);
  const group = SYNONYM_INDEX.get(normalized);
  return group ? [...new Set([normalized, ...group])] : [normalized];
}

/**
 * Generic, data-driven fix for compound words joined by a hyphen in the
 * SOURCE name (e.g. "contra-filé", "batata-doce") — `normalizeSearchText`
 * turns the hyphen into a space ("contra file"), but a user typing the
 * compound as one run-together word ("contrafile") never matches a
 * two-word stored prefix/alias. Deriving the concatenated form as an
 * EXTRA alias at import time (not a manual per-food list — this runs for
 * every hyphenated name from any source) closes that gap mechanically.
 * Must run on the RAW name, before normalization destroys the hyphen.
 */
export function deriveHyphenCompoundAliases(rawName: string): string[] {
  const aliases: string[] = [];
  for (const segment of rawName.split(/[,;]/u)) {
    // `\b` is ASCII-`\w`-based (excludes accented letters like "é"/"ó"),
    // so a plain `\b[\p{L}]+...\b` would truncate "contra-filé" to
    // "contra-fil". Lookarounds on `\p{L}` give correct Unicode word
    // boundaries instead.
    const hyphenated = segment.match(/(?<![\p{L}])\p{L}+(?:-\p{L}+)+(?![\p{L}])/gu) ?? [];
    for (const compound of hyphenated) {
      const concatenated = normalizeAliasKey(compound.replace(/-/gu, ''));
      if (concatenated.length >= 2) aliases.push(concatenated);
    }
  }
  return [...new Set(aliases)];
}
