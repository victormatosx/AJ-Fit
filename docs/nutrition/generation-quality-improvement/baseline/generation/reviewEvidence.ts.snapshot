import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { NutritionProfile, NutritionFoodNutritionValues } from '../shared/types/nutrition';
import { catalogNutritionRevision } from '../shared/nutrition/catalog/binding';
import { equivalenceScore, nutritionFailure, restrictionFailure, verifiedEvidence } from '../catalogLinking/resolver';
import type { CatalogCandidate, CatalogSearchSession } from '../catalogLinking/search';
import { candidateDigest } from '../ai/review';
import { PlanValidationError, type RawAiFoodItem } from './domain';
import type { NutritionPromptFoodNames } from './foodNames';
import { foodRestrictionViolation } from './restrictions';

export interface TrustedFoodEvidence {
  itemIndex: number; collection: string; foodId: string; fingerprint: string;
  name: string; absentSubstances: string[]; reference: string;
  nutritionPer100g: NutritionFoodNutritionValues;
  declaredAllergens: string[] | null;
}
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Evidence-sensitive manufactured/branded categories only \u2014 never ordinary
// foods. An everyday "iogurte"/"queijo"/"p\u00e3o" is not itself a verifiable
// commercial claim; only an actual branded/industrial/supplement product or
// an explicit absence claim ("sem lactose") is something the backend can
// and must verify before trusting it. This is never a closed list of
// allowed foods \u2014 it only decides which specific claims require evidence.
const manufactured = /\b(whey|caseina|caseinato|caseinate|casein|lactoalbumina|lactoglobulina|suplemento|proteina (?:vegetal|de |isolada|concentrada)|isolado|hidrolisado|industrializado|marca|certificado|zero lactose|sem lactose|sem gluten)\b/;
const gluten = /\b(trigo|centeio|cevada|malte|wheat|barley|rye|seitan)\b/;
function fingerprint(c: CatalogCandidate): string {
  return candidateDigest({ revision: catalogNutritionRevision(c.food), name: c.food.name,
    brand: c.food.brand ?? null, evidence: c.food.safetyEvidence ?? null,
    status: 'status' in c.food ? c.food.status : null,
    generationStatus: 'generationStatus' in c.food ? c.food.generationStatus : null,
    allergens: 'allergens' in c.food ? c.food.allergens ?? null : null });
}
async function findEvidence(item: RawAiFoodItem, index: number, profile: NutritionProfile,
  names: NutritionPromptFoodNames, session?: CatalogSearchSession): Promise<TrustedFoodEvidence | null> {
  if (!session) return null;
  let found: CatalogCandidate | null = null;
  try {
    for (const exactOnly of [true, false]) {
    for await (const c of session.candidates(item.name, exactOnly)) {
      if (equivalenceScore(item, c) < 100 || nutritionFailure(c) || restrictionFailure(c, profile, names)
        || verifiedEvidence(c)?.compositionReviewed !== true) continue;
      if (found && (found.collection !== c.collection || found.food.id !== c.food.id)) return null;
      found = c;
    }
    if (found) break;
    }
    if (!found) return null;
    const current = await session.verify(found);
    if (fingerprint(found) !== fingerprint(current)) return null;
    const e = verifiedEvidence(current)!;
    return { itemIndex: index, collection: current.collection, foodId: current.food.id,
      fingerprint: fingerprint(current), name: current.food.name,
      absentSubstances: [...e.absentSubstances], reference: e.reference,
      nutritionPer100g: { ...current.food.nutritionPer100g },
      declaredAllergens: 'allergens' in current.food ? current.food.allergens ?? null : null };
  } catch { return null; } // Optional source unavailable: ordinary foods still work, uncertain products do not.
}

export async function inspectFoodEvidence(items: RawAiFoodItem[], profile: NutritionProfile,
  names: NutritionPromptFoodNames, session?: CatalogSearchSession): Promise<TrustedFoodEvidence[]> {
  const evidence: TrustedFoodEvidence[] = [];
  const critical = [...profile.excludedAllergens ?? [], ...profile.excludedSubstances ?? []];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const violation = foodRestrictionViolation(item, profile.excludedAllergens ?? [],
      { dietaryPattern: profile.dietaryPattern, excludedFoodNames: names.excluded });
    if (violation) throw new PlanValidationError('AI_CONTENT_SAFETY_MISMATCH', true, violation);
    if (/\b(whey|caseina|caseinato|caseinate|casein|lactoalbumina|lactoglobulina|suplemento|proteina (vegetal|de ervilha|de arroz|de soja|isolada|concentrada))\b/.test(norm(item.name))
      && !profile.supplements.includes('whey_or_protein')) throw new PlanValidationError('AI_CONTENT_SAFETY_MISMATCH', true, 'supplement_not_selected');
    const text = norm([item.name, item.preparationNote, ...item.ingredients.map(x => x.name)].join(' '));
    // An ordinary dairy/gluten-containing food (plain yogurt, bread, cheese)
    // is NOT, by itself, a reason to hard-block or demand unavailable
    // catalog evidence — lactose intolerance is not a dairy ban. The
    // independent reviewer runs its own `lactose`/`gluten` checks with full
    // visibility into these ingredients; only an explicit textual admission
    // (`explicitLactose`/`explicitGluten` below) or a genuine branded claim
    // stays a deterministic pre-review block.
    const certificationClaim = /\b(certificad[oa]|certified|certification|laudo|laboratorial)\b/.test(text);
    // An explicit, literal textual admission ("lactose" or a gluten grain
    // named as an ingredient, without a "sem/zero" qualifier) is an objective
    // fact the model itself declared — not semantic ambiguity — so it stays
    // a deterministic pre-review block, unlike ordinary dairy/gluten foods.
    const explicitLactose = profile.excludedSubstances?.includes('lactose') && item.ingredients.some(x =>
      /\blactose\b/.test(norm(x.name)) && !/\b(sem lactose|zero lactose)\b/.test(norm(x.name)));
    const explicitGluten = profile.excludedSubstances?.includes('gluten') && item.ingredients.some(x =>
      gluten.test(norm(x.name)) && !/\b(sem gluten|gluten free)\b/.test(norm(x.name)));
    // A catalog claim cannot excuse contradictory ingredients in the proposed recipe.
    if (explicitLactose || explicitGluten) throw new PlanValidationError('AI_CONTENT_SAFETY_MISMATCH', true, 'incompatible_substance');
    if (!critical.length && profile.dietaryPattern === 'omnivore' && !certificationClaim) continue;
    if (critical.includes('other')) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, 'unspecified_allergen');
    const clearlyHomemade = /\b(caseiro|caseira|feito em casa|feita em casa)\b/.test(text)
      && item.ingredients.length >= 2 && item.ingredients.every(x => !manufactured.test(norm(x.name)));
    // Evidence is required only for genuinely verifiable commercial/branded
    // claims (a certification, a named supplement category, an explicit
    // "zero lactose"/"sem gluten" label) or a known cross-contact risk
    // (oats under gluten exclusion) — never for an ordinary food merely
    // containing dairy/gluten, and never merely because the AI marked some
    // ingredient's origin as `unknown` (that ambiguity is corrigible by the
    // independent reviewer, not a reason to demand unavailable catalog proof).
    const needsEvidence = certificationClaim || manufactured.test(text) && !clearlyHomemade
      || profile.excludedSubstances?.includes('gluten') && /\b(aveia|oats)\b/.test(text);
    if (!needsEvidence) continue;
    const verified = await findEvidence(item, i, profile, names, session);
    if (verified && critical.every(s => verified.absentSubstances.includes(s))) {
      if (verified.declaredAllergens?.some(a => !item.allergens.includes(a))) {
        throw new PlanValidationError('AI_CONTENT_SAFETY_MISMATCH', true, 'incomplete_allergen_declaration');
      }
      evidence.push(verified); continue;
    }
    throw new PlanValidationError('AI_EVIDENCE_INSUFFICIENT', true, 'unverified_product_composition');
  }
  return evidence;
}

export async function assertReviewEvidenceCurrent(tx: Transaction, db: Firestore, refs: TrustedFoodEvidence[]): Promise<void> {
  for (const ref of refs) {
    const snap = await tx.get(db.collection(ref.collection).doc(ref.foodId));
    const c = { collection: ref.collection, food: { ...snap.data(), id: snap.id } } as CatalogCandidate;
    let current: string | null = null;
    try { if (snap.exists) current = fingerprint(c); } catch { /* A malformed/deleted source is no longer evidence. */ }
    if (current !== ref.fingerprint) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, 'evidence_changed');
  }
}
