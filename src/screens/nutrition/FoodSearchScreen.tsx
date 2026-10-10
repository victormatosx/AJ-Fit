import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/AuthContext';
import { searchNutritionCatalog, listCustomFoods } from '../../services/nutritionFoods';
import { createLocalFoodLogSearchProvider } from '../../services/foodLogCatalog';
import { listNutritionRecipes, calculateStoredRecipeNutrition } from '../../services/nutritionRecipes';
import type { FoodLogSourceType, NutritionCustomFood, NutritionFoodNutritionValues, NutritionFoodSourceType, NutritionRecipe } from '../../types/nutrition';
import { countBucket, durationBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { CreateCustomFoodScreen } from './CreateCustomFoodScreen';

export interface NutritionFoodPick {
  foodId: string;
  name: string;
  origin: 'catalog' | 'custom' | 'recipe' | 'food_log';
  nutritionPer100g: NutritionFoodNutritionValues;
  /** The resolved item's `source.type` (taco/off/tbca/.../manual) — closed-vocabulary, analytics-only (Fase C3 "search_source_selected"); never shown to the user (round brief Part 17). */
  sourceType?: FoodLogSourceType | NutritionFoodSourceType;
}

/** Shared shape both `searchNutritionCatalog` (NutritionFood) and `searchFoodLogCatalog` (FoodLogEntry) results are mapped into for rendering — only the fields this screen actually displays. */
interface CatalogSearchResult {
  id: string;
  name: string;
  brandName?: string | null;
  nutritionPer100g: NutritionFoodNutritionValues;
  sourceType?: FoodLogSourceType | NutritionFoodSourceType;
}

const DEBOUNCE_MS = 350;

/** `FoodSearchProvider` (Fase C3 Part 10) — swapping/federating with an external provider later is a change here, not in this screen's render logic. */
const localFoodLogSearchProvider = createLocalFoodLogSearchProvider();

/**
 * Reusable full-screen picker (`08_frontend/screens.md` §7) — opened as a
 * modal from Nutrition Profile (preferred/usual/excluded) and the Diary.
 *
 * `catalog` picks which global catalog backs the search (Fase C2,
 * `docs/nutrition/catalog-expansion/03_canonical_model.md`):
 * - `'generation'` (default): the small curated `nutritionFoods` catalog —
 *   REQUIRED for Nutrition Profile's preferred/usual/excluded pickers,
 *   since those ids feed the Nutrition Engine directly. Never change this
 *   default for that caller.
 * - `'logging'`: the amplo `foodLogCatalog` (TACO + Open Food Facts) — only
 *   for diary/food-logging contexts, never read by generation.
 *
 * Also lists the user's own custom foods client-side (bounded, no server
 * text index needed for a small personal list).
 */
export function FoodSearchScreen({
  visible, onClose, onSelect, excludeIds = [], includeRecipes = false, catalog = 'generation',
  favoriteFoodIds, recentFoodIds, favoriteRecipeIds, onToggleFavoriteFood, onToggleFavoriteRecipe,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (food: NutritionFoodPick) => void;
  excludeIds?: readonly string[];
  /** Diary context only (round brief §8) — a recipe can never be a plan/recipe ingredient. */
  includeRecipes?: boolean;
  /** `'generation'` (default) searches the curated AI-generation catalog; `'logging'` searches the Fase C2 amplo food-log catalog. See doc comment above — never pass `'logging'` for the Nutrition Profile food pickers. */
  catalog?: 'generation' | 'logging';
  /** Heart toggles on each row — omit either pair to render that row type without a heart (e.g. the Profile preferred/usual/excluded pickers). */
  favoriteFoodIds?: readonly string[];
  /** Derived from diary data already subscribed by the shell; never causes a search-path read. */
  recentFoodIds?: readonly string[];
  favoriteRecipeIds?: readonly string[];
  onToggleFavoriteFood?: (foodId: string) => void;
  onToggleFavoriteRecipe?: (recipeId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [lastSearchHadZeroResults, setLastSearchHadZeroResults] = useState(false);
  const [customFoods, setCustomFoods] = useState<NutritionCustomFood<Timestamp>[]>([]);
  const [recipes, setRecipes] = useState<NutritionRecipe<Timestamp>[]>([]);
  const [selectingRecipeId, setSelectingRecipeId] = useState<string | null>(null);
  const [creatingFood, setCreatingFood] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    if (!visible || !user) return;
    listCustomFoods(user.uid).then(setCustomFoods).catch(() => setCustomFoods([]));
    if (includeRecipes) listNutritionRecipes(user.uid).then(setRecipes).catch(() => setRecipes([]));
  }, [visible, user, includeRecipes]);

  useEffect(() => {
    if (!visible) { setText(''); setResults([]); setCursor(null); setError(false); }
  }, [visible]);

  const favoriteIdSet = useMemo(() => (favoriteFoodIds ? new Set(favoriteFoodIds) : undefined), [favoriteFoodIds]);
  const recentIdSet = useMemo(() => (recentFoodIds ? new Set(recentFoodIds) : undefined), [recentFoodIds]);

  const runCatalogSearch = useCallback((query: string, cursorId?: string) => (catalog === 'logging'
    ? localFoodLogSearchProvider.search(query, { cursor: cursorId, favoriteIds: favoriteIdSet, recentIds: recentIdSet }).then(({ foods, nextCursor }) => ({
      results: foods.map((food): CatalogSearchResult => ({ id: food.id, name: food.name, brandName: food.brand?.name, nutritionPer100g: food.nutritionPer100g, sourceType: food.source.type })),
      nextCursor,
    }))
    : searchNutritionCatalog(query, { cursor: cursorId }).then(({ foods, nextCursor }) => ({
      results: foods.map((food): CatalogSearchResult => ({ id: food.id, name: food.name, brandName: food.brand?.name, nutritionPer100g: food.nutritionPer100g, sourceType: food.source.type })),
      nextCursor,
    }))), [catalog, favoriteIdSet, recentIdSet]);

  const runSearch = useCallback((query: string) => {
    const requestId = ++searchRequestRef.current;
    if (query.trim().length < 2) { setResults([]); setCursor(null); setLastSearchHadZeroResults(false); return; }
    setLoading(true);
    setError(false);
    const startedAt = Date.now();
    runCatalogSearch(query)
      .then(({ results: found, nextCursor }) => {
        if (requestId !== searchRequestRef.current) return;
        setResults(found); setCursor(nextCursor);
        // Fase C2/C3 observability (round brief Part 17/19) — bucketed
        // count/latency and closed-vocabulary catalog mode only, never the
        // raw query text.
        trackNutritionEvent({ name: 'nutrition_catalog_search_performed', properties: {
          catalogMode: catalog, resultCountBucket: countBucket(found.length), latencyBucket: durationBucket(Date.now() - startedAt),
        } });
        setLastSearchHadZeroResults(found.length === 0);
        if (found.length === 0) trackNutritionEvent({ name: 'nutrition_catalog_search_zero_results', properties: { catalogMode: catalog } });
      })
      .catch(() => { if (requestId === searchRequestRef.current) setError(true); })
      .finally(() => { if (requestId === searchRequestRef.current) setLoading(false); });
  }, [runCatalogSearch, catalog]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text, runSearch]);

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    const requestId = searchRequestRef.current;
    setLoadingMore(true);
    runCatalogSearch(text, cursor)
      .then(({ results: found, nextCursor }) => {
        if (requestId !== searchRequestRef.current) return;
        setResults((prev) => {
          const ids = new Set(prev.map((food) => food.id));
          return [...prev, ...found.filter((food) => !ids.has(food.id))];
        }); setCursor(nextCursor);
      })
      .catch(() => { if (requestId === searchRequestRef.current) setError(true); })
      .finally(() => { if (requestId === searchRequestRef.current) setLoadingMore(false); });
  };

  const matchingCustom = useMemo(() => {
    const needle = text.trim().toLocaleLowerCase('pt-BR');
    if (needle.length < 2) return [];
    return customFoods.filter((food) => food.name.toLocaleLowerCase('pt-BR').includes(needle));
  }, [customFoods, text]);
  const matchingRecipes = useMemo(() => {
    const needle = text.trim().toLocaleLowerCase('pt-BR');
    if (needle.length < 2) return [];
    return recipes.filter((recipe) => recipe.name.toLocaleLowerCase('pt-BR').includes(needle));
  }, [recipes, text]);

  const visibleResults = results.filter((food) => !excluded.has(food.id));
  const visibleCustom = matchingCustom.filter((food) => !excluded.has(food.id));
  const visibleRecipes = matchingRecipes.filter((recipe) => !excluded.has(recipe.id));
  const showEmpty = !loading && text.trim().length >= 2
    && visibleResults.length === 0 && visibleCustom.length === 0 && visibleRecipes.length === 0 && !error;

  const trackedSelect = useCallback((pick: NutritionFoodPick) => {
    trackNutritionEvent({ name: 'nutrition_catalog_item_selected',
      properties: { catalogMode: catalog, origin: pick.origin, ...(pick.sourceType ? { source: pick.sourceType } : {}) } });
    onSelect(pick);
  }, [catalog, onSelect]);

  const selectRecipe = async (recipe: NutritionRecipe<Timestamp>) => {
    if (!user) return;
    setSelectingRecipeId(recipe.id);
    try {
      const nutritionPer100g = await calculateStoredRecipeNutrition(user.uid, recipe.id);
      trackedSelect({ foodId: recipe.id, name: recipe.name, origin: 'recipe', nutritionPer100g });
    } finally {
      setSelectingRecipeId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('foodSearch.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={onClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>

          <View
            style={{
              marginHorizontal: 22, marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingHorizontal: 14, height: 48, borderRadius: theme.radii.lg,
              backgroundColor: theme.colors.inputBackground, borderWidth: 1, borderColor: theme.colors.inputBorder,
            }}
          >
            <Icon name="search" size={16} color={theme.colors.inputIcon} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('foodSearch.placeholder')}
              placeholderTextColor={theme.colors.inputPlaceholder}
              style={{ flex: 1, fontFamily: theme.fonts.ui, fontSize: 15, color: theme.colors.inputText }}
              autoFocus
              returnKeyType="search"
            />
          </View>

          <ScrollView style={{ flex: 1, marginTop: 10 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            {text.trim().length < 2 ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint, textAlign: 'center', marginTop: 24 }}>
                {t('foodSearch.typeMore')}
              </Text>
            ) : loading ? (
              <View style={{ paddingHorizontal: 22, gap: 8, marginTop: 8 }}>
                <SkeletonBlock height={52} /><SkeletonBlock height={52} /><SkeletonBlock height={52} />
              </View>
            ) : error ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.feedbackErrorTextStrong, textAlign: 'center', marginTop: 24 }}>
                {t('foodSearch.error')}
              </Text>
            ) : showEmpty ? (
              <View style={{ alignItems: 'center', gap: 14, marginTop: 24 }}>
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint, textAlign: 'center' }}>
                  {t('foodSearch.empty')}
                </Text>
                <CtaButton onPress={() => setCreatingFood(true)} style={{ width: '70%' }}>{t('foodSearch.emptyCta')}</CtaButton>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 12 }}>
                {visibleCustom.map((food) => (
                  <FoodRow key={food.id} name={food.name} origin="custom"
                    kcal={food.nutritionPer100g.kcal} proteinG={food.nutritionPer100g.proteinG} per100g
                    favorited={favoriteFoodIds?.includes(food.id)}
                    onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                    onPress={() => trackedSelect({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g })} />
                ))}
                {visibleRecipes.map((recipe) => (
                  <FoodRow key={recipe.id} name={recipe.name} origin="recipe"
                    favorited={favoriteRecipeIds?.includes(recipe.id)}
                    onToggleFavorite={onToggleFavoriteRecipe ? () => onToggleFavoriteRecipe(recipe.id) : undefined}
                    trailing={selectingRecipeId === recipe.id ? <ActivityIndicator size="small" color={theme.colors.textFaint} /> : undefined}
                    onPress={() => { void selectRecipe(recipe); }} />
                ))}
                {visibleResults.map((food) => {
                  const origin: 'catalog' | 'food_log' = catalog === 'logging' ? 'food_log' : 'catalog';
                  return (
                    <FoodRow key={food.id} name={food.name} brandName={food.brandName} origin={origin}
                      kcal={food.nutritionPer100g.kcal} proteinG={food.nutritionPer100g.proteinG} per100g
                      favorited={favoriteFoodIds?.includes(food.id)}
                      onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                      onPress={() => trackedSelect({ foodId: food.id, name: food.name, origin, nutritionPer100g: food.nutritionPer100g, sourceType: food.sourceType })} />
                  );
                })}
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
            )}
          </ScrollView>
        </SafeAreaView>
      </ScreenBg>

      <CreateCustomFoodScreen
        visible={creatingFood}
        onClose={() => setCreatingFood(false)}
        onCreated={(food) => {
          setCreatingFood(false);
          setCustomFoods((prev) => [...prev, food]);
          trackNutritionEvent({ name: 'nutrition_custom_item_created_after_search',
            properties: { catalogMode: catalog, afterZeroResults: lastSearchHadZeroResults } });
          trackedSelect({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g });
        }}
      />
    </Modal>
  );
}
