import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { EmptyNutritionState } from '../../components/nutrition/NutritionStates';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/AuthContext';
import { loadFavoriteFoods, loadFavoriteRecipes, type FavoriteFoodView, type FavoriteRecipeView } from '../../services/nutritionFavorites';

type Tab = 'foods' | 'recipes';

/**
 * "Meus favoritos" (Alimentos | Receitas) — round brief part "Audite e
 * ajuste Meus Favoritos". Separate from `NutritionFavoritesScreen` (favorited
 * MEAL OPTIONS, `nutritionFavoriteMealOptions` + `favoriteMealOptions`,
 * untouched here per round brief §5 — those three concepts never mix).
 *
 * `favoriteFoodIds`/`favoriteRecipeIds` are the only persisted state; this
 * screen re-resolves each id into its CURRENT catalog/custom/recipe record
 * on every open (same never-trust-a-snapshot rule `calculateStoredRecipeBreakdown`
 * already follows) — nothing cached or duplicated here.
 */
export function NutritionFoodFavoritesScreen({
  visible, favoriteFoodIds, favoriteRecipeIds, onClose, onToggleFavoriteFood, onToggleFavoriteRecipe,
}: {
  visible: boolean;
  favoriteFoodIds: readonly string[];
  favoriteRecipeIds: readonly string[];
  onClose: () => void;
  onToggleFavoriteFood: (foodId: string) => void;
  onToggleFavoriteRecipe: (recipeId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('foods');
  const [foods, setFoods] = useState<FavoriteFoodView[]>([]);
  const [recipes, setRecipes] = useState<FavoriteRecipeView[]>([]);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [loadingRecipes, setLoadingRecipes] = useState(false);

  useEffect(() => { if (visible) setTab('foods'); }, [visible]);

  useEffect(() => {
    if (!visible || !user) return;
    const ids = new Set(favoriteFoodIds);
    setFoods((current) => current.filter((food) => ids.has(food.foodId)));
    if (favoriteFoodIds.length === 0) { setLoadingFoods(false); return; }
    let cancelled = false;
    setLoadingFoods(foods.length === 0);
    loadFavoriteFoods(user.uid, favoriteFoodIds)
      .then((next) => { if (!cancelled) setFoods(next); })
      .catch(() => { if (!cancelled) setFoods([]); })
      .finally(() => { if (!cancelled) setLoadingFoods(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve whenever the id list itself changes, not on every render
  }, [visible, user, favoriteFoodIds.join(',')]);

  useEffect(() => {
    if (!visible || !user) return;
    const ids = new Set(favoriteRecipeIds);
    setRecipes((current) => current.filter((recipe) => ids.has(recipe.recipeId)));
    if (favoriteRecipeIds.length === 0) { setLoadingRecipes(false); return; }
    let cancelled = false;
    setLoadingRecipes(recipes.length === 0);
    loadFavoriteRecipes(user.uid, favoriteRecipeIds)
      .then((next) => { if (!cancelled) setRecipes(next); })
      .catch(() => { if (!cancelled) setRecipes([]); })
      .finally(() => { if (!cancelled) setLoadingRecipes(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve whenever the id list itself changes, not on every render
  }, [visible, user, favoriteRecipeIds.join(',')]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('favoriteItems.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={onClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 22, marginTop: 14 }}>
            <Pressable
              onPress={() => setTab('foods')}
              accessibilityRole="button" accessibilityState={{ selected: tab === 'foods' }} accessibilityLabel={t('favoriteItems.tabFoods')}
              style={{ flex: 1, paddingVertical: 10, borderRadius: theme.radii.control, alignItems: 'center',
                backgroundColor: tab === 'foods' ? theme.colors.choiceSelectedBackground : theme.colors.choiceBackground }}
            >
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.choiceText }}>{t('favoriteItems.tabFoods')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('recipes')}
              accessibilityRole="button" accessibilityState={{ selected: tab === 'recipes' }} accessibilityLabel={t('favoriteItems.tabRecipes')}
              style={{ flex: 1, paddingVertical: 10, borderRadius: theme.radii.control, alignItems: 'center',
                backgroundColor: tab === 'recipes' ? theme.colors.choiceSelectedBackground : theme.colors.choiceBackground }}
            >
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.choiceText }}>{t('favoriteItems.tabRecipes')}</Text>
            </Pressable>
          </View>

          {tab === 'foods' ? (
            loadingFoods ? (
              <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={theme.colors.primaryEmphasis} /></View>
            ) : foods.length === 0 ? (
              <View style={{ paddingTop: 20 }}>
                <EmptyNutritionState icon="heart" title={t('favoriteItems.emptyFoods')} body={t('favoriteItems.emptyFoodsBody')} />
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 22, gap: 4 }}>
                {foods.map((food) => (
                  <FoodRow
                    key={food.foodId} name={food.name || t('favoriteItems.unavailableName')}
                    brandName={food.available ? undefined : t('favoriteItems.unavailable')}
                    origin={food.origin}
                    kcal={food.nutritionPer100g?.kcal} proteinG={food.nutritionPer100g?.proteinG} per100g={food.available}
                    favorited onToggleFavorite={() => {
                      setFoods((current) => current.filter((item) => item.foodId !== food.foodId));
                      onToggleFavoriteFood(food.foodId);
                    }}
                  />
                ))}
              </ScrollView>
            )
          ) : loadingRecipes ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={theme.colors.primaryEmphasis} /></View>
          ) : recipes.length === 0 ? (
            <View style={{ paddingTop: 20 }}>
              <EmptyNutritionState icon="heart" title={t('favoriteItems.emptyRecipes')} body={t('favoriteItems.emptyRecipesBody')} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 22, gap: 10 }}>
              {recipes.map((recipe) => (
                <View
                  key={recipe.recipeId}
                  style={{ borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.cardBorder,
                    backgroundColor: theme.colors.surface, padding: 14, gap: 6 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary, flex: 1 }} numberOfLines={1}>
                      {recipe.name}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setRecipes((current) => current.filter((item) => item.recipeId !== recipe.recipeId));
                        onToggleFavoriteRecipe(recipe.recipeId);
                      }} accessibilityRole="button" hitSlop={8}
                      accessibilityLabel={t('favorites.remove')} accessibilityState={{ selected: true }}
                    >
                      <Icon name="heart" filled size={18} color={theme.colors.danger} />
                    </Pressable>
                  </View>
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted }}>
                    {Math.round(recipe.breakdown.total.kcal)} {t('units.kcal')} · P {recipe.breakdown.total.proteinG.toFixed(1)}{t('units.gramsShort')} ·
                    {' '}C {recipe.breakdown.total.carbsG.toFixed(1)}{t('units.gramsShort')} · G {recipe.breakdown.total.fatG.toFixed(1)}{t('units.gramsShort')}
                  </Text>
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint }}>
                    {Math.round(recipe.breakdown.per100g.kcal)} {t('units.kcal')} ·
                    {' '}P {recipe.breakdown.per100g.proteinG.toFixed(1)}{t('units.gramsShort')} ·
                    {' '}C {recipe.breakdown.per100g.carbsG.toFixed(1)}{t('units.gramsShort')} ·
                    {' '}G {recipe.breakdown.per100g.fatG.toFixed(1)}{t('units.gramsShort')} · {t('registerMeal.per100g')}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </ScreenBg>
    </Modal>
  );
}
