import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { EmptyNutritionState } from '../../components/nutrition/NutritionStates';
import { NU, NuSelectPill, NuSheetHeader } from '../../components/nutrition/NuKit';
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

  const countLabel = tab === 'foods' ? favoriteFoodIds.length : favoriteRecipeIds.length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <NuSheetHeader title={t('favoriteItems.title')} onBack={onClose} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 24, marginTop: 4 }}>
            <NuSelectPill on={tab === 'foods'} onPress={() => setTab('foods')}>{t('favoriteItems.tabFoods')}</NuSelectPill>
            <NuSelectPill on={tab === 'recipes'} onPress={() => setTab('recipes')}>{t('favoriteItems.tabRecipes')}</NuSelectPill>
            <View style={{ flex: 1 }} />
            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint }}>{countLabel}</Text>
          </View>

          {tab === 'foods' ? (
            loadingFoods ? (
              <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={NU.blueHi} /></View>
            ) : foods.length === 0 ? (
              <View style={{ paddingTop: 20 }}>
                <EmptyNutritionState icon="heart" title={t('favoriteItems.emptyFoods')} body={t('favoriteItems.emptyFoodsBody')} />
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 14 }} showsVerticalScrollIndicator={false}>
                {foods.map((food, index) => (
                  <View key={food.foodId} style={index ? { borderTopWidth: 1, borderTopColor: NU.hairline } : undefined}>
                    <FoodRow
                      name={food.name || t('favoriteItems.unavailableName')}
                      brandName={food.available ? undefined : t('favoriteItems.unavailable')}
                      origin={food.origin}
                      kcal={food.nutritionPer100g?.kcal} proteinG={food.nutritionPer100g?.proteinG} per100g={food.available}
                      favorited onToggleFavorite={() => {
                        setFoods((current) => current.filter((item) => item.foodId !== food.foodId));
                        onToggleFavoriteFood(food.foodId);
                      }}
                    />
                  </View>
                ))}
              </ScrollView>
            )
          ) : loadingRecipes ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={NU.blueHi} /></View>
          ) : recipes.length === 0 ? (
            <View style={{ paddingTop: 20 }}>
              <EmptyNutritionState icon="heart" title={t('favoriteItems.emptyRecipes')} body={t('favoriteItems.emptyRecipesBody')} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 14, gap: 18 }} showsVerticalScrollIndicator={false}>
              {recipes.map((recipe, index) => (
                <View key={recipe.recipeId} style={[{ paddingBottom: 18 }, index ? { borderTopWidth: 1, borderTopColor: NU.hairline, paddingTop: 18 } : null]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 15, color: NU.white, flex: 1 }} numberOfLines={1}>
                      {recipe.name}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setRecipes((current) => current.filter((item) => item.recipeId !== recipe.recipeId));
                        onToggleFavoriteRecipe(recipe.recipeId);
                      }}
                      accessibilityRole="button" hitSlop={8}
                      accessibilityLabel={t('favorites.remove')} accessibilityState={{ selected: true }}
                    >
                      <Icon name="heart" filled size={18} color={NU.white} />
                    </Pressable>
                  </View>
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.secondary, marginTop: 6 }}>
                    {Math.round(recipe.breakdown.total.kcal)} {t('units.kcal')} · P {recipe.breakdown.total.proteinG.toFixed(1)}{t('units.gramsShort')} ·
                    {' '}C {recipe.breakdown.total.carbsG.toFixed(1)}{t('units.gramsShort')} · G {recipe.breakdown.total.fatG.toFixed(1)}{t('units.gramsShort')}
                  </Text>
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 11.5, color: NU.faint, marginTop: 4 }}>
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
      </View>
    </Modal>
  );
}
