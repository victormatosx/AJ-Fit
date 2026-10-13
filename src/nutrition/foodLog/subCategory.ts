import type { FoodLogSubCategory, NutritionFoodCategory } from '../../types/nutrition';
import { normalizeSearchText } from './normalize';

/**
 * Deterministic keyword classifier into `FOOD_LOG_SUB_CATEGORIES` (Fase C3
 * Part 7) — reused by both the TACO and Open Food Facts importers so the
 * rule set lives in exactly one place. First match wins; no AI (round
 * brief: "Não usar IA"). Falls back to a `category`-based default when no
 * keyword matches, so every record still gets a reasonable bucket.
 */
// Order matters — first match wins. Narrower/less-ambiguous categories
// come first; broad ingredient-name categories (dairy/grains) come last
// since their keywords ("leite", "farinha"...) often appear as an
// INGREDIENT mention inside a snack/prepared-food/branded product name
// ("Chocolate ao leite" is a snack, not dairy).
const NAME_KEYWORD_RULES: { subCategory: FoodLogSubCategory; keywords: string[] }[] = [
  { subCategory: 'eggs', keywords: ['ovo', 'ovos', 'clara de ovo', 'omelete'] },
  { subCategory: 'poultry', keywords: ['frango', 'galinha', 'peru', 'ave', 'aves'] },
  { subCategory: 'pork', keywords: ['suino', 'suina', 'porco', 'bacon', 'linguica de porco', 'pernil'] },
  { subCategory: 'beef', keywords: ['bovina', 'bovino', 'boi', 'picanha', 'alcatra', 'patinho', 'acem',
    'contrafile', 'contra file', 'maminha', 'fraldinha', 'coxao', 'lagarto', 'musculo'] },
  { subCategory: 'fish', keywords: ['peixe', 'tilapia', 'salmao', 'atum', 'sardinha', 'bacalhau', 'camarao', 'pescado'] },
  { subCategory: 'supplements', keywords: ['whey', 'creatina', 'albumina', 'bcaa', 'multivitaminico', 'suplemento'] },
  { subCategory: 'snacks', keywords: ['salgadinho', 'chocolate', 'pipoca', 'barra de cereal', 'snack', 'doce'] },
  { subCategory: 'prepared_food', keywords: ['lasanha', 'estrogonofe', 'strogonoff', 'farofa', 'pure',
    'feijoada', 'escondidinho', 'pizza', 'hamburguer', 'panqueca', 'sopa', 'salada'] },
  { subCategory: 'beverages', keywords: ['refrigerante', 'suco', 'agua', 'cafe', 'cha', 'cerveja', 'vitamina', 'bebida'] },
  { subCategory: 'breads', keywords: ['pao', 'torrada', 'tapioca', 'biscoito', 'bolacha'] },
  { subCategory: 'grains', keywords: ['arroz', 'macarrao', 'aveia', 'quinoa', 'cuscuz', 'farinha', 'milho', 'granola'] },
  { subCategory: 'legumes', keywords: ['feijao', 'lentilha', 'grao de bico', 'ervilha', 'soja'] },
  { subCategory: 'fruits', keywords: ['banana', 'maca', 'mamao', 'manga', 'morango', 'abacate', 'laranja',
    'uva', 'melancia', 'abacaxi', 'limao', 'pera', 'kiwi', 'melao', 'fruta'] },
  { subCategory: 'vegetables', keywords: ['tomate', 'alface', 'cenoura', 'brocolis', 'abobrinha', 'cebola',
    'pepino', 'couve', 'batata', 'mandioca', 'aipim', 'verdura', 'legume'] },
  { subCategory: 'dairy', keywords: ['leite', 'queijo', 'iogurte', 'requeijao', 'mucarela', 'mussarela',
    'manteiga', 'creme de leite', 'cottage', 'coalhada'] },
];

/** `category`-level fallback when no keyword matched — coarser than the keyword rules but always deterministic. */
const CATEGORY_FALLBACK: Partial<Record<NutritionFoodCategory, FoodLogSubCategory>> = {
  protein_source: 'beef', fruit: 'fruits', vegetable: 'vegetables', dairy: 'dairy',
  legume: 'legumes', cereal: 'grains', beverage: 'beverages', supplement: 'supplements',
};

export function classifyFoodLogSubCategory(name: string, category: NutritionFoodCategory, hasBrand: boolean): FoodLogSubCategory {
  const normalized = normalizeSearchText(name);
  for (const rule of NAME_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => normalized === keyword
      || normalized.startsWith(`${keyword} `) || normalized.endsWith(` ${keyword}`)
      || normalized.includes(` ${keyword} `))) return rule.subCategory;
  }
  if (hasBrand) return 'branded_product';
  return CATEGORY_FALLBACK[category] ?? 'other';
}
