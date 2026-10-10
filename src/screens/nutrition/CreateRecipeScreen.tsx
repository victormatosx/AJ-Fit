import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/AuthContext';
import { createNutritionRecipe } from '../../services/nutritionRecipes';
import { listCustomFoods } from '../../services/nutritionFoods';
import { createLocalFoodLogSearchProvider } from '../../services/foodLogCatalog';
import { calculateRecipeBreakdown, type RecipeNutritionBreakdown } from '../../nutrition/catalog/math';
import type { FoodLogEntry, NutritionCustomFood } from '../../types/nutrition';
import type { NutritionFoodPick } from './FoodSearchScreen';
import { countBucket, durationBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';

const DEBOUNCE_MS = 350;
const localFoodLogSearchProvider = createLocalFoodLogSearchProvider();

interface DraftIngredient extends NutritionFoodPick { grams: string }

/** Round brief part 1 §12: recipes accept at most 6 ingredients (`09_safety/nutrition_safety_rules.md`) — never raised here. */
const MAX_INGREDIENTS = 6;

function NutrientRow({ label, values }: { label: string; values: RecipeNutritionBreakdown['total'] }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  return (
    <View style={{ gap: 4 }}>
      <MonoLabel color={theme.colors.textFaint}>{label}</MonoLabel>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondary }}>
        {Math.round(values.kcal)} {t('units.kcal')} · P {values.proteinG.toFixed(1)}{t('units.gramsShort')} ·
        {' '}C {values.carbsG.toFixed(1)}{t('units.gramsShort')} · G {values.fatG.toFixed(1)}{t('units.gramsShort')} ·
        {' '}F {values.fiberG == null ? '—' : `${values.fiberG.toFixed(1)}${t('units.gramsShort')}`}
      </Text>
    </View>
  );
}

/**
 * `08_frontend/screens.md` §9 — macros are always derived, never
 * user-editable. Ingredient search is embedded directly on this screen
 * (same search services + "por 100 g" `FoodRow` labeling `RegisterMealScreen`
 * uses for its own embedded food search) — never a separate `FoodSearchScreen` page.
 */
export function CreateRecipeScreen({
  visible, onClose, onCreated, favoriteFoodIds, recentFoodIds, onToggleFavoriteFood,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  favoriteFoodIds?: readonly string[];
  recentFoodIds?: readonly string[];
  onToggleFavoriteFood?: (foodId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [finalWeightText, setFinalWeightText] = useState('');
  const [servingsText, setServingsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');
  const [catalogResults, setCatalogResults] = useState<FoodLogEntry<Timestamp>[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [customFoods, setCustomFoods] = useState<NutritionCustomFood<Timestamp>[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);
  const favoriteIdSet = useMemo(() => (favoriteFoodIds ? new Set(favoriteFoodIds) : undefined), [favoriteFoodIds]);
  const recentIdSet = useMemo(() => (recentFoodIds ? new Set(recentFoodIds) : undefined), [recentFoodIds]);

  const reset = () => {
    setName(''); setDescription(''); setIngredients([]); setFinalWeightText(''); setServingsText(''); setError(null);
    setSearchText(''); setCatalogResults([]); setCursor(null);
  };

  useEffect(() => {
    if (!visible) { setSearchText(''); setCatalogResults([]); setCursor(null); return; }
    if (user) listCustomFoods(user.uid).then(setCustomFoods).catch(() => setCustomFoods([]));
  }, [visible, user]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestId = ++searchRequestRef.current;
    const query = searchText.trim();
    if (query.length < 2) { setCatalogResults([]); setCursor(null); setSearchError(false); return; }
    debounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      setSearchError(false);
      const startedAt = Date.now();
      localFoodLogSearchProvider.search(query, { favoriteIds: favoriteIdSet, recentIds: recentIdSet })
        .then(({ foods, nextCursor }) => {
          if (requestId !== searchRequestRef.current) return;
          setCatalogResults(foods); setCursor(nextCursor);
          trackNutritionEvent({ name: 'nutrition_catalog_search_performed', properties: {
            catalogMode: 'logging', resultCountBucket: countBucket(foods.length), latencyBucket: durationBucket(Date.now() - startedAt),
          } });
          if (foods.length === 0) trackNutritionEvent({ name: 'nutrition_catalog_search_zero_results', properties: { catalogMode: 'logging' } });
        })
        .catch(() => { if (requestId === searchRequestRef.current) setSearchError(true); })
        .finally(() => { if (requestId === searchRequestRef.current) setSearchLoading(false); });
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchText, favoriteIdSet, recentIdSet]);

  const loadMore = () => {
    const queryText = searchText.trim();
    if (!cursor || loadingMore || queryText.length < 2) return;
    const requestId = searchRequestRef.current;
    setLoadingMore(true);
    localFoodLogSearchProvider.search(queryText, { cursor, favoriteIds: favoriteIdSet, recentIds: recentIdSet })
      .then(({ foods, nextCursor }) => {
        if (requestId !== searchRequestRef.current) return;
        setCatalogResults((previous) => {
          const ids = new Set(previous.map((food) => food.id));
          return [...previous, ...foods.filter((food) => !ids.has(food.id))];
        });
        setCursor(nextCursor);
      })
      .catch(() => { if (requestId === searchRequestRef.current) setSearchError(true); })
      .finally(() => { if (requestId === searchRequestRef.current) setLoadingMore(false); });
  };

  const addedFoodIds = useMemo(() => new Set(ingredients.map((item) => item.foodId)), [ingredients]);
  const query = searchText.trim().toLocaleLowerCase('pt-BR');
  const matchingCustom = query.length < 2 ? [] : customFoods.filter((food) =>
    !addedFoodIds.has(food.id) && food.name.toLocaleLowerCase('pt-BR').includes(query));
  const visibleCatalogResults = catalogResults.filter((food) => !addedFoodIds.has(food.id));

  const addIngredient = (food: NutritionFoodPick) => {
    trackNutritionEvent({ name: 'nutrition_catalog_item_selected', properties: {
      catalogMode: 'logging', origin: food.origin, ...(food.sourceType ? { source: food.sourceType } : {}),
    } });
    setIngredients((prev) => [...prev, { ...food, grams: '100' }]);
  };

  const finalWeightValue = Number(finalWeightText.replace(',', '.'));
  const hasFinalWeight = finalWeightText.trim().length > 0 && Number.isFinite(finalWeightValue) && finalWeightValue > 0;
  const servingsValue = Number(servingsText);
  const hasServings = servingsText.trim().length > 0 && Number.isInteger(servingsValue) && servingsValue > 0;

  const breakdown = useMemo<RecipeNutritionBreakdown | null>(() => {
    const valid = ingredients.filter((item) => Number(item.grams) > 0);
    if (valid.length === 0) return null;
    try {
      const map = new Map(valid.map((item) => [item.foodId, item.nutritionPer100g] as const));
      return calculateRecipeBreakdown({
        ingredients: valid.map((item) => ({ foodId: item.foodId, grams: Number(item.grams) })),
        ...(hasFinalWeight ? { finalWeightG: finalWeightValue } : {}),
        ...(hasServings ? { servings: servingsValue } : {}),
      }, map);
    } catch {
      return null;
    }
  }, [ingredients, hasFinalWeight, finalWeightValue, hasServings, servingsValue]);

  const handleSave = async () => {
    if (!user) return;
    const valid = ingredients.filter((item) => Number(item.grams) > 0);
    if (name.trim().length === 0) { setError(t('recipe.errors.name')); return; }
    if (valid.length === 0) { setError(t('recipe.errors.ingredients')); return; }
    setSaving(true);
    setError(null);
    try {
      await createNutritionRecipe(user.uid, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(hasFinalWeight ? { finalWeightG: finalWeightValue } : {}),
        ...(hasServings ? { servings: servingsValue } : {}),
        ingredients: valid.map((item) => ({ foodId: item.foodId, grams: Number(item.grams) })),
      });
      reset();
      onCreated();
    } catch {
      setError(t('recipe.errors.ingredients'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('recipe.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={() => { reset(); onClose(); }} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 22, gap: 16 }} keyboardShouldPersistTaps="handled">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('recipe.namePlaceholder')}
              placeholderTextColor={theme.colors.inputPlaceholder}
              style={{ height: 48, borderRadius: theme.radii.lg, paddingHorizontal: 14, backgroundColor: theme.colors.inputBackground,
                borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 15, color: theme.colors.inputText }}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={t('recipe.description')}
              placeholderTextColor={theme.colors.inputPlaceholder}
              multiline
              style={{ minHeight: 60, borderRadius: theme.radii.lg, paddingHorizontal: 14, paddingTop: 12, backgroundColor: theme.colors.inputBackground,
                borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.inputText }}
            />

            <MonoLabel color={theme.colors.textFaint}>{t('recipe.ingredients')}</MonoLabel>
            {ingredients.length === 0 ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{t('recipe.empty')}</Text>
            ) : ingredients.map((item, index) => (
              <View key={`${item.foodId}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }} numberOfLines={1}>
                  {formatFoodDisplayName(item.name)}
                </Text>
                {/* Editing an ingredient is just changing its grams here — the macros preview/total recompute live, never typed directly. */}
                <TextInput
                  value={item.grams}
                  onChangeText={(v) => setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, grams: v } : ing)))}
                  keyboardType="decimal-pad"
                  placeholder={t('recipe.grams')}
                  placeholderTextColor={theme.colors.inputPlaceholder}
                  style={{ width: 70, height: 40, borderRadius: theme.radii.control, textAlign: 'center',
                    backgroundColor: theme.colors.inputBackground, borderWidth: 1, borderColor: theme.colors.inputBorder,
                    fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.inputText }}
                />
                <Pressable onPress={() => setIngredients((prev) => prev.filter((_, i) => i !== index))} accessibilityRole="button"
                  accessibilityLabel={t('recipe.removeIngredient')}>
                  <Icon name="trash" size={16} color={theme.colors.textFaint} />
                </Pressable>
              </View>
            ))}

            {ingredients.length < MAX_INGREDIENTS ? (
              <View style={{ gap: 10 }}>
                {/* Same embedded search UX as RegisterMealScreen: search field right on this
                    page, results show kcal/protein/"per 100 g", tapping one adds it straight
                    to the ingredient list — never a separate FoodSearchScreen page. */}
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 48,
                    borderRadius: theme.radii.lg, backgroundColor: theme.colors.inputBackground,
                    borderWidth: 1, borderColor: theme.colors.inputBorder }}
                >
                  <Icon name="search" size={16} color={theme.colors.inputIcon} />
                  <TextInput
                    value={searchText} onChangeText={setSearchText} placeholder={t('foodSearch.placeholder')}
                    placeholderTextColor={theme.colors.inputPlaceholder} returnKeyType="search"
                    style={{ flex: 1, fontFamily: theme.fonts.ui, fontSize: 15, color: theme.colors.inputText }}
                  />
                </View>

                {searchText.trim().length >= 2 ? (
                  searchLoading ? (
                    <View style={{ gap: 8 }}><SkeletonBlock height={52} /><SkeletonBlock height={52} /></View>
                  ) : searchError ? (
                    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.feedbackErrorTextStrong }}>
                      {t('foodSearch.error')}
                    </Text>
                  ) : matchingCustom.length === 0 && visibleCatalogResults.length === 0 ? (
                    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>
                      {t('foodSearch.empty')}
                    </Text>
                  ) : (
                    <View>
                      {matchingCustom.map((food) => (
                        <FoodRow key={food.id} name={food.name} origin="custom" kcal={food.nutritionPer100g.kcal}
                          proteinG={food.nutritionPer100g.proteinG} per100g
                          favorited={favoriteFoodIds?.includes(food.id)}
                          onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                          onPress={() => addIngredient({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g })} />
                      ))}
                      {visibleCatalogResults.map((food) => (
                        <FoodRow key={food.id} name={food.name} brandName={food.brand?.name} origin="food_log"
                          kcal={food.nutritionPer100g.kcal} proteinG={food.nutritionPer100g.proteinG} per100g
                          favorited={favoriteFoodIds?.includes(food.id)}
                          onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                          onPress={() => addIngredient({ foodId: food.id, name: food.name, origin: 'food_log', nutritionPer100g: food.nutritionPer100g, sourceType: food.source.type })} />
                      ))}
                      {cursor ? (
                        <Pressable onPress={loadMore} disabled={loadingMore} style={{ paddingVertical: 14, alignItems: 'center' }}>
                          {loadingMore ? <ActivityIndicator color={theme.colors.primaryEmphasis} /> : (
                            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.primaryEmphasis }}>
                              {t('foodSearch.loadMore')}
                            </Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  )
                ) : null}
              </View>
            ) : (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textFaint }}>
                {t('recipe.maxIngredients', { count: MAX_INGREDIENTS })}
              </Text>
            )}

            {breakdown ? (
              <View style={{ marginTop: 8, padding: 14, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted, gap: 14 }}>
                <View style={{ gap: 4 }}>
                  <MonoLabel color={theme.colors.textFaint}>{t('recipe.totalWeight')}</MonoLabel>
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondary }}>
                    {Math.round(breakdown.totalIngredientWeightG)}{t('units.gramsShort')}
                  </Text>
                </View>
                <NutrientRow label={t('recipe.calculatedMacros')} values={breakdown.total} />

                <View>
                  <TextInput
                    value={finalWeightText}
                    onChangeText={setFinalWeightText}
                    keyboardType="decimal-pad"
                    placeholder={t('recipe.finalWeightPlaceholder')}
                    placeholderTextColor={theme.colors.inputPlaceholder}
                    style={{ height: 44, borderRadius: theme.radii.lg, paddingHorizontal: 14, backgroundColor: theme.colors.inputBackground,
                      borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.inputText }}
                  />
                  <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12, color: theme.colors.textFaint, marginTop: 6 }}>
                    {t('recipe.finalWeightLabel')}
                  </Text>
                  {breakdown.usedIngredientWeightFallback ? (
                    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint, marginTop: 4 }}>
                      {t('recipe.finalWeightFallback', { grams: Math.round(breakdown.totalIngredientWeightG) })}
                    </Text>
                  ) : null}
                </View>
                <NutrientRow label={t('recipe.per100g')} values={breakdown.per100g} />

                <View>
                  <TextInput
                    value={servingsText}
                    onChangeText={setServingsText}
                    keyboardType="number-pad"
                    placeholder={t('recipe.servingsPlaceholder')}
                    placeholderTextColor={theme.colors.inputPlaceholder}
                    style={{ height: 44, borderRadius: theme.radii.lg, paddingHorizontal: 14, backgroundColor: theme.colors.inputBackground,
                      borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.inputText }}
                  />
                  <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12, color: theme.colors.textFaint, marginTop: 6 }}>
                    {t('recipe.servingsLabel')}
                  </Text>
                </View>
                {breakdown.perServing ? (
                  <NutrientRow label={t('recipe.perServing')} values={breakdown.perServing} />
                ) : null}
              </View>
            ) : null}

            {error ? <Text style={{ color: theme.colors.formErrorText, fontSize: 12 }}>{error}</Text> : null}
            <CtaButton onPress={handleSave} disabled={saving} style={{ marginTop: 8 }}>{t('recipe.save')}</CtaButton>
          </ScrollView>
        </SafeAreaView>
      </ScreenBg>
    </Modal>
  );
}
