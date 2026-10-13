import type { FoodLogServingUnit } from '../../types/nutrition';
import { normalizeSearchText } from './normalize';

/**
 * Fase C6/C7 ("serving units") — hand-reviewed, versioned natural-unit
 * rules for generic staple foods (same convention this codebase already
 * trusts for fiber/allergen enrichment — `scripts/nutrition/sources/
 * taco-v1-enrichment.json`'s per-item review, not a generic formula).
 * Priority 3 in the round brief's ordering: only applied when a food has
 * NO provider-official serving at all (TACO/TBCA never carry one — they
 * are generic composition tables, not packaged products).
 *
 * Matching is deliberately NOT "does the keyword appear anywhere in the
 * name" — a naive substring match on TACO's own "Food, variant, prep"
 * naming convention produces real false positives: "Banana, maçã, crua"
 * contains the substring "maçã" (TACO's own name for that banana
 * CULTIVAR, not the fruit apple) and would wrongly inherit maçã's unit;
 * "Pão, de queijo, assado" contains "queijo" and would wrongly inherit
 * cheese's "1 fatia". Instead:
 *   - `head` must equal the name's FIRST token — TACO/TBCA names always
 *     lead with the primary food, variants/prep come after
 *     ("Banana, maçã, crua" head is "banana", not "maçã"; "Pão, de
 *     queijo, assado" head is "pao", not "queijo").
 *   - `requireAnyToken`, when given, additionally requires at least one
 *     of these tokens to appear somewhere in the name — disambiguates a
 *     head that covers multiple sub-foods needing different units (plain
 *     "pão" has no natural single-unit size; only the "francês"/"sal"
 *     roll does).
 *   - `excludeAnyToken`, when given, skips the rule if ANY of these
 *     tokens appear — a prepared/liquid/powdered form of the same head
 *     food is not naturally logged by the raw-ingredient unit (orange
 *     JUICE isn't "1 unidade"; condensed/powdered milk isn't "1 copo").
 * First matching rule wins; deliberately small and curated — exactly the
 * staples named in the round brief, not an attempt to cover every food.
 *
 * `gramEquivalent` values are reviewed reference weights for a typical
 * Brazilian serving (e.g. INFORMANTE/TACO portion tables), not a
 * physical constant — reasonable, bounded estimates, explicitly marked
 * `reviewed_generic` so no caller mistakes them for a provider-stated fact.
 */
export const GENERIC_SERVING_RULES_VERSION = 'generic-serving-rules-v3';

interface GenericServingRule {
  head: string[];
  requireAnyToken?: string[];
  excludeAnyToken?: string[];
  /** Multiple units per food when more than one is genuinely natural (e.g. arroz by colher OR xícara) — first unit is the default. */
  units: Omit<FoodLogServingUnit, 'provenance'>[];
}

const RULES: readonly GenericServingRule[] = [
  // Egg weight varies a lot by species — a single "ovo" rule previously gave quail eggs (~10 g) the
  // same "1 unidade (50 g)" as chicken eggs, a ~5x overstatement. Each species gets its OWN reviewed
  // weight; `excludeAnyToken` keeps "1 clara"/"1 gema" (just the white/yolk, not a whole egg) from
  // inheriting either whole-egg weight — a fraction of an egg is not "1 unidade" of one.
  { head: ['ovo'], requireAnyToken: ['galinha'], excludeAnyToken: ['clara', 'gema'],
    units: [{ id: 'unidade', label: '1 unidade (50 g)', quantity: 1, gramEquivalent: 50 }] },
  { head: ['ovo'], requireAnyToken: ['codorna'], excludeAnyToken: ['clara', 'gema'],
    units: [{ id: 'unidade', label: '1 unidade (10 g)', quantity: 1, gramEquivalent: 10 }] },
  // Any other egg species (pato/ganso/avestruz/...) has no confidently-reviewed weight here — stays
  // grams-only (round brief: "caso contrário, manter gramas") rather than guessing one.
  // Plain "pão" has no single natural unit size (forma/trigo/integral loaves vary wildly) — only the
  // francês/sal bread ROLL does. Real TACO naming: "Pão, trigo, francês" — the variant token comes
  // after the head, never adjacent to it, so this can't be a `head` value of its own.
  { head: ['pao'], requireAnyToken: ['frances', 'sal'], units: [{ id: 'unidade', label: '1 unidade (50 g)', quantity: 1, gramEquivalent: 50 }] },
  { head: ['maca'], units: [{ id: 'unidade', label: '1 unidade (130 g)', quantity: 1, gramEquivalent: 130 }] },
  // Excludes "barra" — "Banana, doce em barra" is a confection, not a whole fruit; "1 unidade" doesn't apply.
  { head: ['banana'], excludeAnyToken: ['barra'], units: [{ id: 'unidade', label: '1 unidade (90 g)', quantity: 1, gramEquivalent: 90 }] },
  // Excludes "suco" — orange JUICE ("Laranja, da terra, suco") is not naturally logged as "1 unidade".
  { head: ['laranja'], excludeAnyToken: ['suco'], units: [{ id: 'unidade', label: '1 unidade (180 g)', quantity: 1, gramEquivalent: 180 }] },
  // ~30 g — no official per-slice source available; reviewed estimate (round brief: "se não houver fonte oficial melhor").
  // Excludes "suisse" — "Queijo, petit suisse, ..." is a dessert cup (fromage frais), not a sliceable cheese.
  { head: ['mussarela', 'mucarela', 'queijo'], excludeAnyToken: ['suisse'], units: [{ id: 'fatia', label: '1 fatia (30 g)', quantity: 1, gramEquivalent: 30 }] },
  { head: ['arroz'], units: [
    { id: 'colher-servir', label: '1 colher de servir (60 g)', quantity: 1, gramEquivalent: 60 },
    { id: 'xicara', label: '1 xícara (150 g)', quantity: 1, gramEquivalent: 150 },
  ] },
  { head: ['feijao'], units: [{ id: 'concha', label: '1 concha (80 g)', quantity: 1, gramEquivalent: 80 }] },
  // Excludes "condensado"/"po" — condensed or powdered milk is not naturally logged as "1 copo (200 ml)".
  // Also excludes plant-based/compound milks ("Leite, de coco" being the one TACO/TBCA actually carries
  // today) — a 200 ml dairy-milk cup is not a reviewed weight for coconut/soy/oat/etc. "milk", which has
  // very different density and is often used by the spoonful in cooking rather than drunk by the cup.
  // Any such milk stays grams/ml-only unless it gets its own explicit rule or a provider-official serving.
  { head: ['leite'], excludeAnyToken: ['condensado', 'po', 'coco', 'soja', 'amendoa', 'aveia', 'arroz', 'amendoim', 'castanha', 'quinoa'],
    units: [{ id: 'copo', label: '1 copo (200 ml)', quantity: 1, gramEquivalent: 200, mlEquivalent: 200 }] },
];

function matchesRule(tokens: readonly string[], rule: GenericServingRule): boolean {
  const head = tokens[0];
  if (!rule.head.includes(head)) return false;
  if (rule.requireAnyToken && !rule.requireAnyToken.some((token) => tokens.includes(token))) return false;
  if (rule.excludeAnyToken && rule.excludeAnyToken.some((token) => tokens.includes(token))) return false;
  return true;
}

/**
 * Returns every reviewed generic unit for `name` (first matching rule's
 * units — possibly more than one, e.g. arroz's colher/xícara), or `[]` —
 * never guesses for a food this table doesn't explicitly cover, and never
 * matches on a variant/prep word that merely appears somewhere in the
 * name (see the module doc comment above).
 */
export function genericServingUnitsFor(name: string): FoodLogServingUnit[] {
  const tokens = normalizeSearchText(name).split(' ').filter(Boolean);
  const rule = RULES.find((candidate) => matchesRule(tokens, candidate));
  return rule ? rule.units.map((unit) => ({ ...unit, provenance: 'reviewed_generic' as const })) : [];
}

/** Convenience for callers that only ever want the single default unit. */
export function genericServingUnitFor(name: string): FoodLogServingUnit | null {
  return genericServingUnitsFor(name)[0] ?? null;
}
