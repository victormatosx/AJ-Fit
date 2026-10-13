import type { NutritionFoodCategory } from '../../types/nutrition';

/**
 * Deterministic keyword match over Open Food Facts' `categories_tags`
 * (English taxonomy, `en:...` slugs) into the existing generation
 * taxonomy (`03_canonical_model.md`: "reaproveita o tipo existente").
 * Order matters — first match wins; no AI/fuzzy matching (round brief C2
 * Part 6: "Não usar IA para decidir qualidade").
 */
const KEYWORD_RULES: { category: NutritionFoodCategory; keywords: string[] }[] = [
  { category: 'supplement', keywords: ['whey', 'protein-supplement', 'dietary-supplement', 'sports-nutrition', 'creatine'] },
  { category: 'dairy', keywords: ['dairies', 'milk', 'cheese', 'yogurt', 'yogurts', 'dairy'] },
  { category: 'protein_source', keywords: ['meat', 'poultry', 'chicken', 'beef', 'pork', 'fish', 'seafood', 'egg', 'eggs', 'sausage', 'cold-cuts', 'charcuterie'] },
  { category: 'legume', keywords: ['legumes', 'beans', 'lentils', 'chickpeas', 'soy-products'] },
  { category: 'fruit', keywords: ['fruits', 'fruit-based', 'dried-fruits'] },
  { category: 'vegetable', keywords: ['vegetables', 'vegetable-based'] },
  { category: 'cereal', keywords: ['cereals', 'breads', 'bread', 'pastas', 'rice', 'flours', 'breakfast-cereals'] },
  { category: 'fat_source', keywords: ['oils', 'fats', 'margarines', 'butters'] },
  { category: 'beverage', keywords: ['beverages', 'drinks', 'waters', 'juices', 'sodas'] },
];

export function mapOffCategory(categoriesTags: readonly string[] | undefined): NutritionFoodCategory {
  const tags = (categoriesTags ?? []).map((tag) => tag.toLowerCase());
  for (const rule of KEYWORD_RULES) {
    if (tags.some((tag) => rule.keywords.some((keyword) => tag.includes(keyword)))) return rule.category;
  }
  return 'other';
}
