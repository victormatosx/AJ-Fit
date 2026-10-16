import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, Modal, Platform, Pressable, ScrollView, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { NU, NuButton, NuPanel, NuSheetHeader } from '../../components/nutrition/NuKit';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/AuthContext';
import { searchNutritionCatalog, listCustomFoods } from '../../services/nutritionFoods';
import { createLocalFoodLogSearchProvider, ensureFoodLogEntryMaterialized } from '../../services/foodLogCatalog';
import { createFatSecretSearchProvider } from '../../nutrition/foodLog/fatsecretProvider';
import { createFederatedFoodLogSearchProvider } from '../../nutrition/foodLog/federatedSearchProvider';
import { resolveDefaultServingUnit, nutrientsForServing } from '../../nutrition/catalog/servings';
import { listNutritionRecipes, calculateStoredRecipeNutrition } from '../../services/nutritionRecipes';
import type {
  FoodLogEntry, FoodLogServingUnit, FoodLogSourceType, NutritionCustomFood, NutritionFoodNutritionValues, NutritionFoodSourceType,
  NutritionRecipe,
} from '../../types/nutrition';
import { countBucket, durationBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { CreateCustomFoodScreen } from './CreateCustomFoodScreen';

export interface NutritionFoodPick {
  foodId: string;
  name: string;
  origin: 'catalog' | 'custom' | 'recipe' | 'food_log';
  nutritionPer100g: NutritionFoodNutritionValues;
  /** The resolved item's `source.type` (taco/off/tbca/.../manual) — closed-vocabulary, analytics-only (Fase C3 "search_source_selected"); never shown to the user (round brief Part 17). */
  sourceType?: FoodLogSourceType | NutritionFoodSourceType;
  /** Fase C8 — carried through from the resolved `FoodLogEntry` so a caller logging straight from this picked result (no own grams/serving step, unlike `RegisterMealScreen`) can still resolve the food's natural unit instead of defaulting to grams. Absent for custom foods/recipes, which have no `FoodLogServingUnit`. */
  servings?: FoodLogServingUnit[];
  defaultServingId?: string | null;
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

/**
 * `FoodSearchProvider` (Fase C3 Part 10) — swapping/federating with an
 * external provider later is a change here, not in this screen's render
 * logic. Fase C5: now the local-first federated provider (local +
 * FatSecret fallback), same interface as the plain local provider it
 * replaces.
 */
const localFoodLogSearchProvider = createFederatedFoodLogSearchProvider({
  localProvider: createLocalFoodLogSearchProvider(), externalProvider: createFatSecretSearchProvider(),
});

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
  visible, onClose, onSelect, excludeIds = [], includeRecipes = false, catalog = 'generation', variant = 'profile',
  favoriteFoodIds, recentFoodIds, favoriteRecipeIds, onToggleFavoriteFood, onToggleFavoriteRecipe, overlay, presentation = 'modal',
}: {
  visible: boolean;
  /** Embed in the Diary's native modal using the quantity panel's shared chrome. */
  presentation?: 'modal' | 'sheet';
  onClose: () => void;
  onSelect: (food: NutritionFoodPick) => void;
  excludeIds?: readonly string[];
  /** Diary context only (round brief §8) — a recipe can never be a plan/recipe ingredient. */
  includeRecipes?: boolean;
  /** `'generation'` (default) searches the curated AI-generation catalog; `'logging'` searches the Fase C2 amplo food-log catalog. See doc comment above — never pass `'logging'` for the Nutrition Profile food pickers. */
  catalog?: 'generation' | 'logging';
  /**
   * Purely visual switch (2026-10 Nutrição redesign). `'profile'` (default)
   * keeps this screen's original theme-driven look — required for
   * `NutritionProfileScreen.tsx`'s preferred/usual/excluded pickers, which
   * are OUTSIDE that redesign's scope and must render exactly as before.
   * `'nutrition'` is the new fixed dark palette, used only by the Diary's
   * "+ Adicionar alimento" call site. No behavior differs between the two.
   */
  variant?: 'profile' | 'nutrition';
  /** Heart toggles on each row — omit either pair to render that row type without a heart (e.g. the Profile preferred/usual/excluded pickers). */
  favoriteFoodIds?: readonly string[];
  /** Derived from diary data already subscribed by the shell; never causes a search-path read. */
  recentFoodIds?: readonly string[];
  favoriteRecipeIds?: readonly string[];
  onToggleFavoriteFood?: (foodId: string) => void;
  onToggleFavoriteRecipe?: (recipeId: string) => void;
  /**
   * A caller-owned overlay (e.g. the Diary's `RecipeQuantityModal`) that
   * needs to appear on top of this screen while it stays open — rendered
   * as a plain View alongside `CreateCustomFoodScreen` inside this
   * screen's single `Modal`, never as the caller's own separate
   * `<Modal>`. Two independent native Modals both `visible` at once is
   * unreliable; see the comment on `CreateCustomFoodScreen` for the
   * concrete failure this avoids.
   */
  overlay?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const sheetHeight = useRef(new Animated.Value(45)).current;
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
  /** Fase C5 — `results` only keeps the slim render projection; this holds the full `FoodLogEntry` per id so selecting a row can materialize a fresh external result before resolving `foodId`. */
  const foodLogEntriesRef = useRef<Map<string, FoodLogEntry<Timestamp>>>(new Map());
  const [materializingId, setMaterializingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    listCustomFoods(user.uid).then(setCustomFoods).catch(() => setCustomFoods([]));
    if (includeRecipes) listNutritionRecipes(user.uid).then(setRecipes).catch(() => setRecipes([]));
  }, [visible, user, includeRecipes]);

  useEffect(() => {
    if (presentation === 'sheet') {
      setSearchExpanded(false);
      if (visible) Keyboard.dismiss();
    }
    if (!visible) {
      searchRequestRef.current++;
      setText(''); setResults([]); setCursor(null); setError(false); setLoading(false); setCreatingFood(false);
    }
  }, [visible, presentation]);

  const dismissSearchKeyboard = useCallback(() => {
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    setSearchExpanded(false);
  }, []);

  useEffect(() => {
    if (presentation !== 'sheet' || !visible) return;
    const subscription = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      searchInputRef.current?.blur();
      setSearchExpanded(false);
    });
    return () => subscription.remove();
  }, [presentation, visible]);

  useEffect(() => {
    if (presentation !== 'sheet' || !visible) {
      sheetHeight.setValue(45);
      return;
    }
    const transition = Animated.timing(sheetHeight, {
      toValue: searchExpanded ? 90 : 45,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // Height changes the available space for the scrollable results.
    });
    transition.start();
    return () => transition.stop();
  }, [presentation, visible, searchExpanded, sheetHeight]);

  const favoriteIdSet = useMemo(() => (favoriteFoodIds ? new Set(favoriteFoodIds) : undefined), [favoriteFoodIds]);
  const recentIdSet = useMemo(() => (recentFoodIds ? new Set(recentFoodIds) : undefined), [recentFoodIds]);

  const runCatalogSearch = useCallback((query: string, cursorId?: string) => (catalog === 'logging'
    ? localFoodLogSearchProvider.search(query, { cursor: cursorId, favoriteIds: favoriteIdSet, recentIds: recentIdSet }).then(({ foods, nextCursor }) => {
      foods.forEach((food) => foodLogEntriesRef.current.set(food.id, food));
      return {
        results: foods.map((food): CatalogSearchResult => ({ id: food.id, name: food.name, brandName: food.brand?.name, nutritionPer100g: food.nutritionPer100g, sourceType: food.source.type })),
        nextCursor,
      };
    })
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
    if (!visible) return;
    debounceRef.current = setTimeout(() => runSearch(text), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [visible, text, runSearch]);

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
    Keyboard.dismiss();
    onSelect(pick);
  }, [catalog, onSelect]);

  /** Materializes a possibly-fresh external (`fatsecret`) result into `foodLogCatalog` before resolving its final id — a no-op read for every local-sourced result. */
  const selectFoodLogResult = async (result: CatalogSearchResult) => {
    const origin: 'catalog' | 'food_log' = catalog === 'logging' ? 'food_log' : 'catalog';
    const raw = foodLogEntriesRef.current.get(result.id);
    if (!raw) { trackedSelect({ foodId: result.id, name: result.name, origin, nutritionPer100g: result.nutritionPer100g, sourceType: result.sourceType }); return; }
    setMaterializingId(result.id);
    try {
      const materialized = await ensureFoodLogEntryMaterialized(raw);
      trackedSelect({
        foodId: materialized.id, name: materialized.name, origin, nutritionPer100g: materialized.nutritionPer100g,
        sourceType: materialized.source.type, servings: materialized.servings, defaultServingId: materialized.defaultServingId,
      });
    } catch {
      setError(true);
    } finally {
      setMaterializingId(null);
    }
  };

  const selectRecipe = async (recipe: NutritionRecipe<Timestamp>) => {
    if (!user) return;
    setSelectingRecipeId(recipe.id);
    try {
      const nutritionPer100g = await calculateStoredRecipeNutrition(user.uid, recipe.id);
      trackedSelect({ foodId: recipe.id, name: recipe.name, origin: 'recipe', nutritionPer100g });
    } catch {
      setError(true);
    } finally {
      setSelectingRecipeId(null);
    }
  };

  // Purely visual branch (see `variant` doc comment above) — every handler,
  // state value and piece of logic below this point is shared identically
  // by both render paths.
  const resultsList = (nu: boolean) => (
    <View style={nu ? undefined : { paddingHorizontal: 12 }}>
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
          trailing={selectingRecipeId === recipe.id ? <ActivityIndicator size="small" color={nu ? NU.faint : theme.colors.textFaint} /> : undefined}
          onPress={() => { void selectRecipe(recipe); }} />
      ))}
      {visibleResults.map((food) => {
        const origin: 'catalog' | 'food_log' = catalog === 'logging' ? 'food_log' : 'catalog';
        // Fase C7 — shows the food's default natural unit (ovo -> "1 unidade", mussarela -> "1 fatia") instead of always "por 100 g", when one exists.
        const raw = origin === 'food_log' ? foodLogEntriesRef.current.get(food.id) : undefined;
        const defaultUnit = raw ? resolveDefaultServingUnit(raw.servings, raw.defaultServingId) : null;
        const servingNutrients = defaultUnit ? nutrientsForServing(food.nutritionPer100g, defaultUnit) : null;
        return (
          <FoodRow key={food.id} name={food.name} brandName={food.brandName} origin={origin}
            kcal={servingNutrients?.kcal ?? food.nutritionPer100g.kcal} proteinG={servingNutrients?.proteinG ?? food.nutritionPer100g.proteinG}
            per100g={!servingNutrients} servingLabel={defaultUnit?.label}
            favorited={favoriteFoodIds?.includes(food.id)}
            onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
            trailing={materializingId === food.id ? <ActivityIndicator size="small" color={nu ? NU.faint : theme.colors.textFaint} /> : undefined}
            onPress={() => { void selectFoodLogResult(food); }} />
        );
      })}
      {cursor ? (
        <Pressable onPress={loadMore} disabled={loadingMore} style={{ paddingVertical: 14, alignItems: 'center' }}>
          {loadingMore ? <ActivityIndicator color={nu ? NU.blueHi : theme.colors.primaryEmphasis} /> : (
            <Text style={{ fontFamily: nu ? 'Archivo_600SemiBold' : theme.fonts.uiSemi, fontSize: 13, color: nu ? NU.secondary : theme.colors.primaryEmphasis }}>
              {t('foodSearch.loadMore')}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );

  const createCustomFoodOverlay = (
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
  );

  // Share search content between the standalone picker and the Diary's
  // embedded sheet. Sheet presentation never creates another native Modal.
  const body = variant === 'nutrition' ? (
    <View style={{ flex: 1, backgroundColor: presentation === 'sheet' ? NU.panel : NU.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={presentation === 'sheet' ? [] : ['top', 'bottom']}>
        <NuSheetHeader title={t('foodSearch.title')} onBack={onClose} />

        <View
          style={{
            marginHorizontal: 24, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingHorizontal: 16, height: 50, borderRadius: 12, backgroundColor: NU.surfaceSubtleStrong,
          }}
        >
          <Icon name="search" size={17} color={NU.faint} />
          <TextInput
            ref={searchInputRef}
            value={text}
            onChangeText={setText}
            placeholder={t('foodSearch.placeholder')}
            placeholderTextColor={NU.faint}
            style={{ flex: 1, fontFamily: 'Archivo_400Regular', fontSize: 15.5, color: NU.white }}
            autoFocus={presentation !== 'sheet'}
            onFocus={() => setSearchExpanded(true)}
            returnKeyType="search"
          />
          {text.length > 0 ? (
            <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} hitSlop={8}>
              <Icon name="x" size={15} color={NU.faint} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView style={{ flex: 1, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {text.trim().length < 2 ? (
            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint, textAlign: 'center', marginTop: 24 }}>
              {t('foodSearch.typeMore')}
            </Text>
          ) : loading ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <SkeletonBlock height={52} /><SkeletonBlock height={52} /><SkeletonBlock height={52} />
            </View>
          ) : error ? (
            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.danger, textAlign: 'center', marginTop: 24 }}>
              {t('foodSearch.error')}
            </Text>
          ) : showEmpty ? (
            <View style={{ alignItems: 'center', gap: 14, marginTop: 24 }}>
              <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint, textAlign: 'center' }}>
                {t('foodSearch.empty')}
              </Text>
              <NuButton ghost onPress={() => setCreatingFood(true)} style={{ width: '70%' }}>{t('foodSearch.emptyCta')}</NuButton>
            </View>
          ) : resultsList(true)}
        </ScrollView>
      </SafeAreaView>
    </View>
  ) : (
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
            autoFocus={presentation !== 'sheet'}
            onFocus={() => setSearchExpanded(true)}
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
          ) : resultsList(false)}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );

  if (presentation === 'sheet') {
    return (
      <>
        <NuPanel visible={visible} onClose={searchExpanded ? dismissSearchKeyboard : onClose} avoidKeyboard
          animatedHeight={sheetHeight.interpolate({ inputRange: [45, 90], outputRange: ['45%', '90%'] })}
          contentStyle={{ paddingHorizontal: 0, paddingBottom: 16 }}>
          <TouchableWithoutFeedback onPress={dismissSearchKeyboard} accessible={false}>
            {body}
          </TouchableWithoutFeedback>
        </NuPanel>
        {visible ? createCustomFoodOverlay : null}
        {visible ? overlay : null}
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      {body}
      {createCustomFoodOverlay}
      {overlay}
    </Modal>
  );
}
