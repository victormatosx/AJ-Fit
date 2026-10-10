/** The current recommended option's food names — passed to the model as a soft "avoid" signal (round brief §11). Diet-quality-v3: items have no `foodId` anymore, so the avoid-list is name-based. */
export function recommendedOptionFoodNames(meal: { recommendedOptionId: string; options: { id: string; foods: { name: string }[] }[] }): string[] {
  const option = meal.options.find((item) => item.id === meal.recommendedOptionId);
  return option ? option.foods.map((food) => food.name) : [];
}
