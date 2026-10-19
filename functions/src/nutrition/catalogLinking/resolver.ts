import type { NutritionCatalogBinding, NutritionCatalogSafetyEvidence, NutritionProfile } from '../shared/types/nutrition';
import { catalogNutritionRevision } from '../shared/nutrition/catalog/binding';
import { validateNutritionValues } from '../shared/nutrition/catalog/math';
import { foodLogId } from '../shared/nutrition/foodLog/normalize';
import { normalizeSearchText, nutritionFoodId } from '../shared/nutrition/catalog/normalize';
import { expandSynonyms, FOOD_LOG_SYNONYM_GROUPS } from '../shared/nutrition/foodLog/aliases';
import { auditFoodLogEntry } from '../shared/nutrition/foodLog/qualityAudit';
import type { RawAiFoodItem } from '../generation/domain';
import type { NutritionPromptFoodNames } from '../generation/foodNames';
import { CatalogResolutionError, CatalogSearchSession, type CatalogCandidate, type CatalogFailureReason } from './search';

type Policy = Pick<NutritionProfile, 'dietaryPattern' | 'excludedAllergens' | 'excludedFoodIds' | 'excludedSubstances'>;
const PREPARATIONS: Record<string, string> = { cru: 'raw', crua: 'raw', cozido: 'cooked', cozida: 'cooked',
  grelhado: 'grilled', grelhada: 'grilled', assado: 'roasted', assada: 'roasted', torrado: 'roasted', torrada: 'roasted',
  frito: 'fried', frita: 'fried', empanado: 'breaded', empanada: 'breaded', milanesa: 'breaded' };
const FILLER = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'com', 'sem']);
function normalized(text: string) {
  return normalizeSearchText(text).replace(/tipo 1\b/g, 'branco').replace(/\b(mucarela|mussarella|mozarela|muzzarella)\b/g, 'mussarela');
}
function tokens(text: string): string[] {
  return normalized(text).split(' ').filter(t => !FILLER.has(t) && !PREPARATIONS[t])
    .map(t => FOOD_LOG_SYNONYM_GROUPS.find(group => group.includes(t))?.[0] ?? expandSynonyms(t)[0]).sort();
}
export function preparationOf(text: string): string | null {
  const kinds = [...new Set(normalized(text).split(' ').map(t => PREPARATIONS[t]).filter(Boolean))];
  return kinds.length === 1 ? kinds[0] : kinds.length > 1 ? 'ambiguous' : null;
}
const MODIFIERS = ['integral', 'desnatado', 'desnatada', 'proteico', 'proteica', 'concentrado', 'isolado', 'natural',
  'light', 'zero', 'sabor', 'recheado', 'recheada', 'empanado', 'empanada', 'sem lactose', 'sem gluten', 'sem pele',
  'com pele', 'sem gordura', 'com gordura', 'salgado', 'salgada', 'defumado', 'defumada'];

/** High lexical coverage alone never establishes a match. Preparation and distinguishing
 * qualifiers are mandatory, and branded products require their full product identity. */
export function equivalenceScore(intent: RawAiFoodItem, candidate: CatalogCandidate): number {
  const food = candidate.food;
  const wanted = normalized(`${intent.name} ${intent.preparationNote}`); const actual = normalized(food.name);
  const requestedPreparation = preparationOf(wanted);
  const metadataPreparation = 'preparation' in food && food.preparation !== 'none' ? food.preparation : null;
  const actualPreparation = preparationOf(actual) ?? metadataPreparation;
  if (requestedPreparation === 'ambiguous' || actualPreparation === 'ambiguous'
    || requestedPreparation !== actualPreparation && (requestedPreparation || actualPreparation)) return -1;
  if (['fried', 'breaded'].includes(actualPreparation ?? '') || /\b(milanesa|rechead|sabor|molho)\b/.test(actual)) return -1;
  // A health/nutrition qualifier cannot disappear or be introduced by matching.
  for (const qualifier of MODIFIERS) if (wanted.includes(qualifier) !== actual.includes(qualifier)) return -1;
  const brand = food.brand?.name ? normalized(food.brand.name) : '';
  const wantedWithoutBrand = brand ? wanted.replace(brand, '').trim() : wanted;
  const wantedTokens = tokens(wantedWithoutBrand); const actualTokens = tokens(actual);
  const labels = [actual, ...(food.aliases ?? []).map(normalized).filter(a => a !== brand)];
  const exact = labels.some(label => normalized(wantedWithoutBrand) === label);
  const sameTokens = wantedTokens.length === actualTokens.length && wantedTokens.every((t, i) => t === actualTokens[i]);
  if (!exact && !sameTokens) return -1;
  if (brand && !wanted.includes(brand)) return -1; // never choose an arbitrary commercial formulation
  return (exact ? 100 : 90) + (brand ? 10 : 0);
}

export function nutritionFailure(candidate: CatalogCandidate): CatalogFailureReason | null {
  const f = candidate.food;
  if (!f || !f.source || !['taco', 'off'].includes(f.source.type) || !f.source.sourceId || !f.catalogVersion
    || !f.id.startsWith(candidate.collection === 'nutritionFoods' ? 'nf_' : 'flc_')) return 'identity';
  if (candidate.collection === 'foodLogCatalog' ? !('status' in f) || f.status !== 'active'
    : !('generationStatus' in f) || !['approved', 'pending_review'].includes(f.generationStatus)) return 'identity';
  try {
    const expectedId = candidate.collection === 'nutritionFoods' ? nutritionFoodId(f.source.type as 'taco', f.source.sourceId) : foodLogId(f.source.type as 'taco' | 'off', f.source.sourceId);
    if (f.id !== expectedId) return 'identity';
  } catch { return 'identity'; }
  try { validateNutritionValues(f.nutritionPer100g); } catch { return 'nutrition'; }
  if (typeof f.nutritionPer100g.fiberG !== 'number' || f.name.length > 120) return 'nutrition';
  if (f.source.type === 'off' && (f.category === 'beverage' || 'servings' in f
    && (f.servings ?? []).some(s => /\bml\b/i.test(s.label)))) return 'quantity';
  // Category-only warnings do not change source values. Energy/macro inconsistencies do block.
  const flags = auditFoodLogEntry(f as Parameters<typeof auditFoodLogEntry>[0]);
  if (flags.some(flag => flag !== 'UNUSUAL_KCAL_FOR_CATEGORY')) return 'nutrition';
  if ('preparation' in f && f.preparation === 'composite') return 'preparation';
  const prep = preparationOf(f.name) ?? ('preparation' in f ? f.preparation : null);
  if (prep === 'raw' && f.category === 'protein_source') return 'preparation';
  const name = normalized(f.name);
  if (prep === 'raw' && /^(feijao|lentilha|grao de bico|soja|macarrao)\b/.test(name)
    || /^farinha de (trigo|milho)\b/.test(name) || /^soja farinha\b/.test(name)) return 'preparation';
  return null;
}
function verifiedEvidence(candidate: CatalogCandidate): NutritionCatalogSafetyEvidence | null {
  const e = candidate.food.safetyEvidence;
  return e?.schemaVersion === 1 && e.nutritionRevision === catalogNutritionRevision(candidate.food)
    && typeof e.reference === 'string' && e.reference.trim().length > 0
    && Array.isArray(e.absentSubstances) && Array.isArray(e.dietaryPatterns) ? e : null;
}
// Closed single-ingredient taxonomy, not a model declaration. Unknown/composite products never qualify.
const PLANTS = /^(arroz|aveia|milho|feijao|lentilha|ervilha|grao de bico|soja|banana|maca|mamao|laranja|abacaxi|uva|manga|morango|abacate|kiwi|goiaba|maracuja|batata|mandioca|brocolis|cenoura|abobrinha|alface|tomate|cebola|couve|repolho|pimentao|quiabo|vagem|chuchu|berinjela|beterraba|amendoim|amendoa|noz|castanha|linhaca|gergelim)( |$)/;
const PLANT_DESCRIPTORS = new Set(('arroz integral branco tipo 1 2 parboilizado aveia flocos milho verde feijao carioca preto fradinho jalo rajado rosinha roxo lentilha ervilha vagem grao bico soja farinha banana nanica prata maca argentina casca mamao formosa papaia laranja baia pera abacaxi uva italia manga tommy atkins morango abacate kiwi goiaba branca vermelha maracuja batata doce baroa inglesa mandioca brocolis cenoura abobrinha italiana alface americana lisa tomate semente cebola couve manteiga repolho pimentao quiabo vagem chuchu berinjela beterraba amendoim grao amendoa noz castanha caju brasil linhaca gergelim torrada torrado salgada salgado crua cru cozida cozido assada assado de do da com sem').split(' '));
const COMPOSITE = /\b(sabor|molho|rechead[oa]|temperad[oa]|empanad[oa]|milanesa|mistura|composto|pizza|lasanha|pao|biscoito|bolo)\b/;
function simplePlant(candidate: CatalogCandidate): boolean {
  const f = candidate.food; const n = normalized(f.name);
  return f.source.type === 'taco' && PLANTS.test(n) && !COMPOSITE.test(n)
    && n.split(' ').every(token => PLANT_DESCRIPTORS.has(token));
}
export function restrictionFailure(candidate: CatalogCandidate, profile: Policy, names: NutritionPromptFoodNames): CatalogFailureReason | null {
  const f = candidate.food; const e = verifiedEvidence(candidate);
  if (profile.excludedFoodIds.includes(f.id)) return 'restriction';
  const text = normalized(f.name);
  // Exclusion tokens are conservative across sources/preparations. Never rely on ID inequality alone.
  for (const name of names.excluded) {
    const excluded = tokens(name);
    if (excluded.length && excluded.every(t => tokens(f.name).includes(t))) return 'restriction';
    const head = excluded.find(t => ['leite', 'ovo', 'soja', 'trigo', 'frango', 'arroz', 'feijao', 'amendoim'].includes(t));
    if (head && tokens(f.name).includes(head)) return 'restriction';
  }
  const critical = [...(profile.excludedAllergens ?? []), ...(profile.excludedSubstances ?? [])];
  if (critical.length) {
    if (critical.includes('other')) return 'restriction'; // unspecified substances cannot be verified as a group
    const ingredientText = text.replace(/sem (leite|ovo|soja|trigo|amendoim)/g, '')
      .replace(/leite de (soja|aveia|arroz|coco|amendoa)/g, '').replace(/couve manteiga/g, 'couve');
    const presence: Record<string, RegExp> = {
      milk: /\b(leite|queijo|iogurte|whey|caseina|manteiga|nata)\b/,
      egg: /\b(ovo|ovos|clara|gema|albumina)\b/,
      soy: /\b(soja|tofu)\b/, wheat: /\btrigo\b/,
      gluten: /\b(trigo|centeio|cevada|malte)\b/,
      peanut: /\bamendoim\b/, tree_nuts: /\b(castanha|amendoa|noz|nozes|avela|pistache)\b/,
      fish: /\b(peixe|atum|salmao|sardinha|bacalhau|tilapia)\b/,
      shellfish: /\b(camarao|caranguejo|lagosta|mexilhao|ostra|lula|polvo)\b/,
    };
    if (critical.some(a => presence[a]?.test(ingredientText))) return 'restriction';
    if ('allergens' in f && f.allergens?.some(a => critical.includes(a))) return 'restriction';
    // A reviewed empty array is ingredient-level only, NOT proof of critical absence.
    if (!e || critical.some(a => !e.absentSubstances.includes(a))) return 'restriction';
  }
  if (names.excluded.length && !simplePlant(candidate) && !('allergens' in f && f.allergens !== null)
    && !e?.compositionReviewed) return 'restriction';
  if (profile.dietaryPattern !== 'omnivore') {
    if ('dietaryFlags' in f && f.dietaryFlags[profile.dietaryPattern] === false) return 'restriction';
    const reviewed = 'dietaryFlags' in f && f.dietaryFlags[profile.dietaryPattern] === true;
    if (!reviewed && !simplePlant(candidate) && !e?.dietaryPatterns.includes(profile.dietaryPattern)) return 'restriction';
    // Independent contradictory-name backstop; unknown commercial ingredients require evidence.
    const animalText = text.startsWith('ovo ') ? text.replace(/\bgalinha\b/g, '') : text;
    if (/\b(carne|frango|porco|peru|bacon|presunto|gelatina|banha)\b/.test(animalText)) return 'restriction';
    if (profile.dietaryPattern !== 'pescatarian' && /\b(peixe|atum|salmao|sardinha|camarao|caranguejo|bacalhau)\b/.test(text)) return 'restriction';
    if (profile.dietaryPattern === 'vegan' && /\b(leite|queijo|ovo|whey|mel|carne|frango|peixe)\b/.test(text)) return 'restriction';
  }
  return null;
}
export interface ResolvedIntent { intent: RawAiFoodItem; candidate: CatalogCandidate; binding: NutritionCatalogBinding }
export async function resolveIntent(intent: RawAiFoodItem, session: CatalogSearchSession,
  profile: Policy, names: NutritionPromptFoodNames): Promise<ResolvedIntent> {
  session.metrics.requested++;
  if (intent.ingredients.length !== 1 || tokens(intent.ingredients[0].name).join(' ') !== tokens(intent.name).join(' ')) throw new CatalogResolutionError('identity');
  if (!['g', 'grama', 'gramas'].includes(normalized(intent.unit)) || intent.quantity <= 0 || intent.quantity > 600) {
    throw new CatalogResolutionError('quantity');
  }
  let best: CatalogCandidate | null = null; let score = -1; let ambiguous = false;
  let lastReason: CatalogFailureReason = 'not_found';
  const suggestions = new Set<string>();
  for (const exactOnly of [true, false]) {
  for await (const c of session.candidates(intent.name, exactOnly)) {
    const failure = nutritionFailure(c) ?? restrictionFailure(c, profile, names);
    const rank = equivalenceScore(intent, c);
    if (!failure && rank < 0 && suggestions.size < 4
      && preparationOf(`${intent.name} ${intent.preparationNote}`) === preparationOf(c.food.name)
      && tokens(intent.name).every(t => tokens(c.food.name).includes(t))) {
      suggestions.add(c.food.brand?.name ? `${c.food.name} ${c.food.brand.name}` : c.food.name);
    }
    if (failure || rank < 0) {
      lastReason = failure ?? 'identity'; session.metrics.rejected++;
      session.metrics.failures[lastReason] = (session.metrics.failures[lastReason] ?? 0) + 1;
      continue;
    }
    if (rank > score) { best = c; score = rank; ambiguous = false; }
    else if (rank === score && best && (best.food.source.type !== c.food.source.type || best.food.source.sourceId !== c.food.source.sourceId)) ambiguous = true;

  }
  if (best && score >= 100) break;
  }
  if (!best) throw new CatalogResolutionError(lastReason, { unresolvedFood: intent.name, candidates: [...suggestions] });
  if (ambiguous) throw new CatalogResolutionError('ambiguous');
  const current = await session.verify(best);
  if (catalogNutritionRevision(current.food) !== catalogNutritionRevision(best.food)
    || nutritionFailure(current) || restrictionFailure(current, profile, names)
    || equivalenceScore(intent, current) < 0) throw new CatalogResolutionError('changed');
  const f = current.food;
  session.metrics.matched++; session.metrics.sources[f.source.type as 'taco' | 'off']++;
  return { intent, candidate: current, binding: { schemaVersion: 1, collection: current.collection, foodId: f.id,
    grams: intent.quantity, source: { type: f.source.type as 'taco' | 'off', sourceId: f.source.sourceId },
    ...(f.brand?.name ? { brandName: f.brand.name } : {}),
    catalogVersion: f.catalogVersion, nutritionRevision: catalogNutritionRevision(f),
    nutritionPer100g: f.nutritionPer100g, preparation: preparationOf(f.name) ?? ('preparation' in f ? f.preparation : null) ?? 'none' } };
}
