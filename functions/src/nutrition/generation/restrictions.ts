import type { FoodRestrictions, RawAiFoodItem } from './domain';
import type { NutritionFoodAllergen } from '../shared/types/nutrition';

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Composition metadata is mandatory. Names provide an independent backstop for
// common ingredients whose origin/allergens the model may have misclassified.
const terrestrial = /\b(carne|frango|galinha|peru|pato|bovina|bovino|suina|suino|porco|bacon|presunto|linguica|salsicha|salame|costela|picanha|alcatra|patinho|acem|lombo|cordeiro|beef|chicken|pork|turkey)\b/;
const seafood = /\b(peixe|atum|salmao|sardinha|tilapia|bacalhau|camarao|caranguejo|lagosta|lula|polvo|mexilhao|ostra|fish|shrimp|salmon|tuna)\b/;
const dairy = /\b(leite|queijo|iogurte|requeijao|manteiga|nata|whey|caseina|caseinato|caseinate|casein|lactoalbumina|lactoglobulina|ricota|mucarela|mozzarella|parmesao|milk|cheese|butter|yogurt)\b/;
const eggs = /\b(ovo|ovos|gema|clara|albumina|egg|eggs)\b/;
const animalOther = /\b(mel|gelatina|colageno|banha|honey|gelatin|lard)\b/;
const plantSubstitutes = /\b(leite de (coco|soja|aveia|amendoa|arroz|castanha)|manteiga de (amendoim|castanha)|carne de (soja|jaca))\b/g;
const preparation = new Set(['cru', 'crua', 'cozido', 'cozida', 'grelhado', 'grelhada', 'assado', 'assada', 'frito', 'frita', 'refogado', 'refogada', 'sem', 'com', 'sal', 'oleo', 'de', 'do', 'da', 'em', 'in', 'natura']);
function coreTokens(value: string): string[] {
  return normalized(value).split(' ').filter((token) => token && !preparation.has(token)).map((token) => token.length > 3 ? token.replace(/s$/, '') : token);
}
function matchesExclusion(text: string, excluded: string): boolean {
  const tokens = coreTokens(excluded);
  const actual = new Set(coreTokens(text));
  const broadFoodNames = new Set(['frango', 'carne', 'peixe', 'arroz', 'feijao', 'amendoim', 'leite', 'ovo', 'queijo', 'soja']);
  return tokens.length > 0 && (tokens.every((token) => actual.has(token))
    || tokens.some((token) => broadFoodNames.has(token) && actual.has(token)));
}

export function foodRestrictionViolation(
  item: RawAiFoodItem, excludedAllergens: readonly NutritionFoodAllergen[], restrictions?: FoodRestrictions,
): string | null {
  const texts = [item.name, item.preparationNote, ...item.ingredients.map((ingredient) => ingredient.name)];
  const text = normalized(texts.join(' '));
  const animalText = text.replace(plantSubstitutes, '');
  // Dietary-pattern word backstops (unlike the allergen inference above) must
  // scan ONLY declared ingredient names, never the dish name or the free-text
  // `preparationNote` — those are prose, and prose negates ("cozido SEM caldo
  // de carne") or references the source animal of an already-truthful
  // non-meat declaration ("ovo de GALINHA", origin `egg`). A plain word match
  // on that prose reads "sem caldo de carne" as containing meat and "ovo de
  // galinha" as containing chicken meat — both false positives that blocked
  // essentially every realistic vegetarian meal (2026-10-21 fix). The
  // ingredient list is the one field the prompt requires to be complete and
  // literal, so it is the only safe surface for a word-based backstop.
  const nonMeatAnimalOrigin = new Set(['dairy', 'egg', 'fish', 'shellfish']);
  const ingredientTexts = (skip: Set<string> = new Set()) => item.ingredients
    .filter((ingredient) => !skip.has(ingredient.origin))
    .map((ingredient) => normalized(ingredient.name).replace(plantSubstitutes, ''));
  const inferred: NutritionFoodAllergen[] = [];
  const origins = item.ingredients.map((ingredient) => ingredient.origin);
  if (origins.includes('dairy')) inferred.push('milk');
  if (origins.includes('egg')) inferred.push('egg');
  if (origins.includes('fish')) inferred.push('fish');
  if (origins.includes('shellfish')) inferred.push('shellfish');
  if (/\b(peixe|atum|salmao|sardinha|tilapia|bacalhau|fish|tuna|salmon)\b/.test(text)) inferred.push('fish');
  if (dairy.test(animalText)) inferred.push('milk');
  if (eggs.test(animalText)) inferred.push('egg');
  if (/\b(amendoim|peanut)\b/.test(text)) inferred.push('peanut');
  if (/\b(soja|tofu|soy)\b/.test(text)) inferred.push('soy');
  if (/\b(trigo|centeio|cevada|wheat|barley|rye)\b/.test(text)) inferred.push('wheat');
  if (/\b(castanha|amendoa|noz|nozes|avela|pistache)\b/.test(text)) inferred.push('tree_nuts');
  if (/\b(camaroes|camarao|lagosta|caranguejo)\b/.test(text)) inferred.push('shellfish');
  if (item.allergens.concat(inferred).some((allergen) => excludedAllergens.includes(allergen as NutritionFoodAllergen))) return 'unsafe_allergen';
  if (!restrictions) return null;
  if (restrictions.excludedFoodNames.some((excluded) => texts.some((value) => matchesExclusion(value, excluded)))) return 'excluded_food';
  const pattern = restrictions.dietaryPattern;
  if (pattern === 'omnivore') return null;
  // `unknown` origin is the AI's own uncertainty, not a confirmed animal
  // classification — it is corrigible ambiguity for the independent
  // reviewer to resolve (it explicitly requires insufficient_information
  // for unresolved composition under a restriction), not a deterministic
  // pre-review block. Only confirmed animal origins/terms hard-block here.
  // A truthfully declared egg/dairy/fish/shellfish ingredient is excluded from
  // the meat-word scan: its own name may legitimately reference the source
  // animal ("ovo de galinha", "leite de vaca") without containing meat.
  const meatCandidateTexts = ingredientTexts(nonMeatAnimalOrigin);
  if (origins.some((origin) => ['terrestrial_animal', 'other_animal'].includes(origin))
    || meatCandidateTexts.some((t) => terrestrial.test(t) || /\b(gelatina|banha|gelatin|lard)\b/.test(t))) return 'incompatible_dietary_pattern';
  if (pattern !== 'pescatarian' && (origins.some((origin) => origin === 'fish' || origin === 'shellfish')
    || ingredientTexts().some((t) => seafood.test(t)) || item.allergens.some((allergen) => ['fish', 'shellfish'].includes(allergen)))) return 'incompatible_dietary_pattern';
  if (pattern === 'vegan' && (origins.some((origin) => origin === 'dairy' || origin === 'egg')
    || ingredientTexts().some((t) => dairy.test(t) || eggs.test(t) || animalOther.test(t))
    || item.allergens.some((allergen) => ['milk', 'egg'].includes(allergen)))) return 'incompatible_dietary_pattern';
  return null;
}
