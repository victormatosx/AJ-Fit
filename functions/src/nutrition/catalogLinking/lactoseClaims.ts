import { normalizeSearchText } from '../shared/nutrition/catalog/normalize';
import type { CatalogCandidate } from './search';

/**
 * Lactose-specific exception to the "admin-reviewed `safetyEvidence` required
 * for any critical substance" rule (see `resolver.ts#restrictionFailure`,
 * `reviewEvidence.ts#findEvidence`). No pipeline has ever populated
 * `safetyEvidence` for any catalog record (2026-10 production audit,
 * generation `6428a2d1-...`) — treating it as the ONLY path made lactose
 * exclusion + any manufactured/branded claim an unconditional dead end.
 * This reads an explicit, unqualified absence claim already present on the
 * catalog's OWN curated identity fields (the same `name`/`brand` fields
 * `equivalenceScore` already resolved this exact candidate against) — never
 * the AI's free-form item text, and never a generic ingredient keyword like
 * "isolado"/"concentrado"/"hidrolisado" (none of those imply lactose-free).
 * Scoped to lactose only; gluten/celiac and allergens keep requiring real
 * admin-reviewed evidence (`absentSubstances`/`compositionReviewed`).
 */

// A weaker/ambiguous qualifier takes precedence whenever present: residual lactose
// may remain ("sem adição de" = no added lactose, not zero), the quantity claim is
// relative ("baixo teor"/"reduzido"), or it is a cross-contact warning, not a
// composition fact ("pode conter leite"). None of these are an absence claim.
const AMBIGUOUS_LACTOSE_QUALIFIER = /\b(sem adicao de lactose|baixo teor de lactose|reduzido em lactose|menos lactose|teor reduzido de lactose|pode conter leite|traco de leite|tracos de leite|traces of milk|may contain milk)\b/;

// An unqualified, explicit absence claim — the kind a label states outright.
const EXPLICIT_ZERO_LACTOSE_CLAIM = /\b(zero lactose|sem lactose|livre de lactose|0 lactose|lactose free)\b/;

function identityText(candidate: CatalogCandidate): string {
  const f = candidate.food;
  const brandName = f.brand?.name ?? '';
  const productName = f.brand?.productName ?? '';
  return normalizeSearchText([f.name, brandName, productName].filter(Boolean).join(' '));
}

/** True only for an unqualified, explicit lactose-absence claim on the catalog's own curated identity. */
export function hasExplicitZeroLactoseClaim(candidate: CatalogCandidate): boolean {
  const text = identityText(candidate);
  if (AMBIGUOUS_LACTOSE_QUALIFIER.test(text)) return false;
  return EXPLICIT_ZERO_LACTOSE_CLAIM.test(text);
}
