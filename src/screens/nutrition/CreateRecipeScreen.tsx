import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, InputAccessoryView, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { NU, NuButton, NuCap, NuPanel, NuSelectPill, NuStepper } from '../../components/nutrition/NuKit';
import { useAuth } from '../../state/AuthContext';
import { createNutritionRecipe } from '../../services/nutritionRecipes';
import { listCustomFoods } from '../../services/nutritionFoods';
import { createLocalFoodLogSearchProvider } from '../../services/foodLogCatalog';
import { calculateRecipeBreakdown, nutrientsForGrams, type RecipeNutritionBreakdown } from '../../nutrition/catalog/math';
import { resolveDefaultServingUnit, servingGrams } from '../../nutrition/catalog/servings';
import { isPositiveGrams } from '../../nutrition/ui/diaryModel';
import type { FoodLogEntry, NutritionCustomFood } from '../../types/nutrition';
import type { NutritionFoodPick } from './FoodSearchScreen';
import { countBucket, durationBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';
import { displayLineHeight } from '../../theme/tokens';

const DEBOUNCE_MS = 350;
const localFoodLogSearchProvider = createLocalFoodLogSearchProvider();

interface DraftIngredient extends NutritionFoodPick { grams: string }

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
  const { t } = useTranslation('nutrition');
  const { t: tCommon } = useTranslation('common');
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [servingsText, setServingsText] = useState('');
  const [focusedField, setFocusedField] = useState<string | null>(null);
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

  /** Same add-grams confirmation step `RegisterMealScreen` uses — serving-unit pills, stepper, live kcal/protein preview, keyboard dismissal. */
  const [gramsStep, setGramsStep] = useState<NutritionFoodPick | null>(null);
  const [gramsText, setGramsText] = useState('100');
  const gramsInputRef = useRef<TextInput>(null);
  const [selectedServingId, setSelectedServingId] = useState<string | null>(null);

  const reset = () => {
    setName(''); setDescription(''); setIngredients([]); setServingsText(''); setError(null);
    setSearchText(''); setCatalogResults([]); setCursor(null);
    setGramsStep(null); setGramsText('100'); setSelectedServingId(null);
  };

  useEffect(() => {
    if (!visible) {
      setSearchText(''); setCatalogResults([]); setCursor(null);
      setGramsStep(null); setGramsText('100'); setSelectedServingId(null);
      return;
    }
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

  const gramsValue = Number(gramsText.replace(',', '.'));
  const gramsValid = isPositiveGrams(gramsValue);
  const preview = gramsStep && gramsValid ? nutrientsForGrams(gramsStep.nutritionPer100g, gramsValue) : null;
  /** Fase C6 — only units with a confident gram basis are selectable; absent/ml-only units never appear here (grams stays the only input for them). */
  const servableUnits = (gramsStep?.servings ?? []).filter((unit) => servingGrams(unit) != null);
  const selectServingUnit = (unit: typeof servableUnits[number] | null) => {
    setSelectedServingId(unit?.id ?? null);
    if (unit) { const grams = servingGrams(unit); if (grams != null) setGramsText(String(grams)); }
  };

  const openAddIngredient = (food: NutritionFoodPick) => {
    Keyboard.dismiss();
    trackNutritionEvent({ name: 'nutrition_catalog_item_selected', properties: {
      catalogMode: 'logging', origin: food.origin, ...(food.sourceType ? { source: food.sourceType } : {}),
    } });
    const defaultUnit = resolveDefaultServingUnit(food.servings, food.defaultServingId);
    const defaultGrams = defaultUnit ? servingGrams(defaultUnit) : null;
    setGramsStep(food);
    setSelectedServingId(defaultUnit?.id ?? null);
    setGramsText(defaultGrams != null ? String(defaultGrams) : '100');
  };

  const confirmAddIngredient = () => {
    if (!gramsStep || !gramsValid) return;
    Keyboard.dismiss();
    setIngredients((prev) => [...prev, { ...gramsStep, grams: gramsText }]);
    setSearchText('');
    setGramsStep(null);
  };

  const servingsValue = Number(servingsText);
  const hasServings = servingsText.trim().length > 0 && Number.isInteger(servingsValue) && servingsValue > 0;

  const breakdown = useMemo<RecipeNutritionBreakdown | null>(() => {
    const valid = ingredients.filter((item) => Number(item.grams) > 0);
    if (valid.length === 0) return null;
    try {
      const map = new Map(valid.map((item) => [item.foodId, item.nutritionPer100g] as const));
      return calculateRecipeBreakdown({
        ingredients: valid.map((item) => ({ foodId: item.foodId, grams: Number(item.grams) })),
        ...(hasServings ? { servings: servingsValue } : {}),
      }, map);
    } catch {
      return null;
    }
  }, [ingredients, hasServings, servingsValue]);

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

  const totalChips: [string, string, string][] | null = breakdown ? [
    ['kcal', String(Math.round(breakdown.total.kcal)), t('units.kcal')],
    ['proteinG', breakdown.total.proteinG.toFixed(1), t('home.summary.protein')],
    ['carbsG', breakdown.total.carbsG.toFixed(1), t('home.summary.carbs')],
    ['fatG', breakdown.total.fatG.toFixed(1), t('home.summary.fat')],
    ['fiberG', breakdown.total.fiberG == null ? '—' : breakdown.total.fiberG.toFixed(1), t('home.summary.fiber')],
  ] : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* A. Cabeçalho — compacto, título + subtítulo discreto, controle de fechar preservado. */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 22, paddingTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 19, color: NU.white }}>{t('recipe.title')}</Text>
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, lineHeight: 18, color: NU.secondary, marginTop: 4 }}>
                  {t('recipe.subtitle')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={() => { reset(); onClose(); }} style={{ padding: 6, marginTop: -2 }}>
                <Icon name="x" size={20} color={NU.faint} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
              <View style={styles.detailsPanel}>
                <Text style={[styles.sectionTitle, styles.detailsTitle]}>{t('recipe.detailsTitle')}</Text>
                <View style={styles.detailsFieldGroup}>
                  <Text style={styles.fieldLabel}>{t('recipe.name')}</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder={t('recipe.namePlaceholder')}
                    accessibilityLabel={t('recipe.name')}
                    placeholderTextColor={NU.faint}
                    onFocus={() => setFocusedField('name')}
                    onBlur={() => setFocusedField(null)}
                    style={[styles.input, focusedField === 'name' && styles.inputFocused]}
                  />
                </View>
                <View style={styles.detailsFieldGroup}>
                  <Text style={styles.fieldLabel}>{t('recipe.description')}</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t('recipe.descriptionPlaceholder')}
                    accessibilityLabel={t('recipe.description')}
                    placeholderTextColor={NU.faint}
                    multiline
                    textAlignVertical="top"
                    onFocus={() => setFocusedField('description')}
                    onBlur={() => setFocusedField(null)}
                    style={[styles.input, styles.descriptionInput, focusedField === 'description' && styles.inputFocused]}
                  />
                </View>
              </View>

              {/* D. Ingredientes — sem limite de quantidade. */}
              <View style={{ marginTop: 32 }}>
                <View style={styles.sectionHeading}>
                  <Text style={styles.sectionTitle}>{t('recipe.ingredients')}</Text>
                  {ingredients.length > 0 ? (
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{ingredients.length}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={{ gap: 10, marginTop: 14 }}>
                  {/* Same embedded search UX as RegisterMealScreen: search field right on this
                      page, results show kcal/protein/"per 100 g", tapping one opens the shared
                      add-grams step — never a separate FoodSearchScreen page. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 48, borderRadius: 12, backgroundColor: NU.surfaceSubtleStrong }}>
                    <Icon name="search" size={16} color={NU.faint} />
                    <TextInput
                      value={searchText} onChangeText={setSearchText} placeholder={t('foodSearch.placeholder')}
                      placeholderTextColor={NU.faint} returnKeyType="search"
                      style={{ flex: 1, fontFamily: 'Archivo_400Regular', fontSize: 15, color: NU.white }}
                    />
                  </View>

                  {searchText.trim().length >= 2 ? (
                    searchLoading ? (
                      <View style={{ gap: 8 }}><SkeletonBlock height={52} /><SkeletonBlock height={52} /></View>
                    ) : searchError ? (
                      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.danger }}>
                        {t('foodSearch.error')}
                      </Text>
                    ) : matchingCustom.length === 0 && visibleCatalogResults.length === 0 ? (
                      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint }}>
                        {t('foodSearch.empty')}
                      </Text>
                    ) : (
                      <View>
                        {matchingCustom.map((food) => (
                          <FoodRow key={food.id} name={food.name} origin="custom" kcal={food.nutritionPer100g.kcal}
                            proteinG={food.nutritionPer100g.proteinG} per100g
                            favorited={favoriteFoodIds?.includes(food.id)}
                            onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                            onPress={() => openAddIngredient({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g })} />
                        ))}
                        {visibleCatalogResults.map((food) => (
                          <FoodRow key={food.id} name={food.name} brandName={food.brand?.name} origin="food_log"
                            kcal={food.nutritionPer100g.kcal} proteinG={food.nutritionPer100g.proteinG} per100g
                            favorited={favoriteFoodIds?.includes(food.id)}
                            onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                            onPress={() => openAddIngredient({
                              foodId: food.id, name: food.name, origin: 'food_log', nutritionPer100g: food.nutritionPer100g,
                              sourceType: food.source.type, servings: food.servings, defaultServingId: food.defaultServingId,
                            })} />
                        ))}
                        {cursor ? (
                          <Pressable onPress={loadMore} disabled={loadingMore} style={{ paddingVertical: 14, alignItems: 'center' }}>
                            {loadingMore ? <ActivityIndicator color={NU.blueHi} /> : (
                              <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: NU.blueHi }}>
                                {t('foodSearch.loadMore')}
                              </Text>
                            )}
                          </Pressable>
                        ) : null}
                      </View>
                    )
                  ) : null}
                </View>

                {ingredients.length > 0 ? (
                  <View style={styles.ingredientsCard}>
                    {ingredients.map((item, index) => (
                      <View key={`${item.foodId}-${index}`} style={[styles.ingredientRow, index > 0 && styles.ingredientDivider]}>
                        <Text style={styles.ingredientName} numberOfLines={2}>
                          {formatFoodDisplayName(item.name)}
                        </Text>
                        <View style={[styles.gramsField, focusedField === item.foodId && styles.inputFocused]}>
                          <TextInput
                            value={item.grams}
                            onChangeText={(v) => setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, grams: v } : ing)))}
                            keyboardType="decimal-pad"
                            accessibilityLabel={`${t('recipe.grams')}: ${formatFoodDisplayName(item.name)}`}
                            placeholder={t('recipe.grams')}
                            placeholderTextColor={NU.faint}
                            textAlign="right"
                            selectTextOnFocus
                            onFocus={() => setFocusedField(item.foodId)}
                            onBlur={() => setFocusedField(null)}
                            style={styles.gramsInput}
                          />
                          <Text style={styles.quantityLabel}>{t('units.gramsShort')}</Text>
                        </View>
                        <Pressable onPress={() => setIngredients((prev) => prev.filter((_, i) => i !== index))}
                          accessibilityRole="button" accessibilityLabel={`${t('recipe.removeIngredient')}: ${formatFoodDisplayName(item.name)}`}
                          style={styles.removeButton}>
                          <Icon name="x" size={16} color={NU.faint} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {/* E. Informações nutricionais — um agrupamento único com divisórias
                  sutis (mesmo componente de totais do RegisterMealScreen), não
                  cinco cards com ícones. */}
              {breakdown && totalChips ? (
                <View style={{ marginTop: 36 }}>
                  <NuCap>{t('recipe.nutritionTitle')}</NuCap>

                  <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1,
                    borderColor: NU.hairline, backgroundColor: NU.surfaceSubtle, paddingVertical: 14, marginTop: 14 }}>
                    {totalChips.map(([key, value, label], index) => (
                      <React.Fragment key={key}>
                        {index > 0 ? <View style={{ width: 1, alignSelf: 'stretch', marginVertical: 3, backgroundColor: NU.hairline }} /> : null}
                        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 2 }}>
                          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: 'Archivo_700Bold', fontSize: 15.5, color: NU.white }}>
                            {value}
                          </Text>
                          <Text numberOfLines={1} style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 8.5, letterSpacing: 0.4, color: NU.faint, marginTop: 3 }}>
                            {label.toUpperCase()}
                          </Text>
                        </View>
                      </React.Fragment>
                    ))}
                  </View>

                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.secondary, marginTop: 12 }}>
                    {t('recipe.totalWeight')} — <Text style={{ fontFamily: 'Archivo_600SemiBold', color: NU.white }}>{Math.round(breakdown.totalIngredientWeightG)}{t('units.gramsShort')}</Text>
                  </Text>
                </View>
              ) : null}

              <View style={styles.yieldPanel}>
                <View style={styles.sectionHeading}>
                  <Icon name="utensils" size={18} color={NU.blueHi} />
                  <Text style={styles.sectionTitle}>{t('recipe.yieldTitle')}</Text>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t('recipe.servingsLabel')}</Text>
                  <View style={[styles.servingsField, focusedField === 'servings' && styles.inputFocused]}>
                    <TextInput
                      value={servingsText}
                      onChangeText={setServingsText}
                      keyboardType="number-pad"
                      placeholder={t('recipe.servingsPlaceholder')}
                      placeholderTextColor={NU.faint}
                      accessibilityLabel={t('recipe.servingsLabel')}
                      onFocus={() => setFocusedField('servings')}
                      onBlur={() => setFocusedField(null)}
                      style={styles.servingsInput}
                    />
                    <Text style={styles.quantityLabel}>{t('recipe.portionsUnit')}</Text>
                  </View>
                </View>
                {breakdown?.perServing ? (
                  <View style={styles.servingSummary}>
                    <NuCap>{t('recipe.perServing')}</NuCap>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10 }}>
                      <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 38, lineHeight: displayLineHeight(38), color: NU.white }}>
                        {Math.round(breakdown.perServing.kcal)}
                      </Text>
                      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: NU.secondary }}> {t('units.kcal')}</Text>
                    </View>
                    <View style={styles.servingMacros}>
                      {[
                        [t('home.summary.protein'), breakdown.perServing.proteinG.toFixed(1)],
                        [t('home.summary.carbs'), breakdown.perServing.carbsG.toFixed(1)],
                        [t('home.summary.fat'), breakdown.perServing.fatG.toFixed(1)],
                      ].map(([label, value]) => (
                        <View key={label} style={styles.servingMacro}>
                          <Text style={styles.macroValue}>{value} <Text style={styles.quantityLabel}>{t('units.gramsShort')}</Text></Text>
                          <Text style={styles.macroLabel}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              {error ? <Text style={{ color: NU.danger, fontSize: 12, marginTop: 20 }}>{error}</Text> : null}
            </ScrollView>

            {/* H. Botão principal — fixo no rodapé, respeitando a safe area, fora
                do ScrollView para nunca cobrir campos nem travar a rolagem. */}
            <View style={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10, borderTopWidth: 1, borderTopColor: NU.hairline, backgroundColor: NU.bg }}>
              <NuButton onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : t('recipe.save')}
              </NuButton>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>

        <NuPanel visible={gramsStep != null} avoidKeyboard onClose={() => {
          if (gramsInputRef.current?.isFocused()) Keyboard.dismiss();
          else setGramsStep(null);
        }}>
          {gramsStep ? (
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="never" keyboardDismissMode="on-drag" contentContainerStyle={{ gap: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white, lineHeight: 23 }}>
                  {formatFoodDisplayName(gramsStep.name)}
                </Text>
                {onToggleFavoriteFood ? (() => {
                  const stepFavorited = favoriteFoodIds?.includes(gramsStep.foodId);
                  return (
                    <Pressable
                      onPress={() => onToggleFavoriteFood(gramsStep.foodId)} accessibilityRole="button" hitSlop={8}
                      accessibilityLabel={stepFavorited ? t('favorites.remove') : t('favorites.add')}
                      accessibilityState={{ selected: Boolean(stepFavorited) }}
                    >
                      <Icon name="heart" filled={Boolean(stepFavorited)} size={20} color={stepFavorited ? NU.white : NU.faint} />
                    </Pressable>
                  );
                })() : null}
              </View>
              {servableUnits.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <NuCap>{t('registerMeal.unitLabel')}</NuCap>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <NuSelectPill on={selectedServingId === null} onPress={() => selectServingUnit(null)}>
                      {t('registerMeal.unitGrams')}
                    </NuSelectPill>
                    {servableUnits.map((unit) => (
                      <NuSelectPill key={unit.id} on={selectedServingId === unit.id} onPress={() => selectServingUnit(unit)}>
                        {unit.label}
                      </NuSelectPill>
                    ))}
                  </View>
                </View>
              ) : null}
              <NuStepper
                value={(
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <TextInput
                      ref={gramsInputRef}
                      value={gramsText}
                      onChangeText={setGramsText}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      submitBehavior="blurAndSubmit"
                      onSubmitEditing={Keyboard.dismiss}
                      inputAccessoryViewID={Platform.OS === 'ios' ? 'create-recipe-quantity-done' : undefined}
                      accessibilityLabel={t('registerMeal.unitGrams')}
                      selectTextOnFocus
                      style={{ minWidth: 64, flexShrink: 1, paddingVertical: 6, paddingHorizontal: 2, fontFamily: 'Archivo_700Bold', fontSize: 24, color: NU.white, textAlign: 'center' }}
                    />
                    <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 24, color: NU.white }}> {t('units.gramsShort')}</Text>
                  </View>
                )}
                sub={preview ? `${Math.round(preview.kcal)} ${t('units.kcal')}` : null}
                onMinus={() => setGramsText(String(Math.max(0, Number(gramsText.replace(',', '.')) - 10)))}
                onPlus={() => setGramsText(String(Number(gramsText.replace(',', '.')) + 10))}
              />
              {preview ? (
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, textAlign: 'center' }}>
                  {`${Math.round(preview.kcal)} ${t('units.kcal')} · ${preview.proteinG.toFixed(1)} g ${t('registerMeal.proteinShort')}`}
                </Text>
              ) : null}
              <NuButton onPress={confirmAddIngredient} disabled={!gramsValid}>
                {t('diary.save')}
              </NuButton>
            </ScrollView>
          ) : null}
        </NuPanel>
        {Platform.OS === 'ios' && gramsStep ? (
          <InputAccessoryView nativeID="create-recipe-quantity-done">
            <View style={{ backgroundColor: NU.panel, alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 10 }}>
              <Pressable onPress={Keyboard.dismiss} accessibilityRole="button" accessibilityLabel={tCommon('actions.done')} hitSlop={8}>
                <Icon name="check" size={24} color={NU.blueHi} />
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  detailsPanel: { backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline, borderRadius: 16, padding: 14, gap: 12 },
  detailsTitle: { fontSize: 14 },
  detailsFieldGroup: { gap: 5 },
  sectionTitle: { fontFamily: 'Archivo_600SemiBold', fontSize: 16, color: NU.white },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldGroup: { gap: 8 },
  fieldLabel: { fontFamily: 'Archivo_500Medium', fontSize: 13, color: NU.secondary },
  input: { minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: NU.hairline, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: NU.surfaceSubtleStrong, fontFamily: 'Archivo_400Regular', fontSize: 15, color: NU.white },
  inputFocused: { borderColor: NU.blueHi },
  descriptionInput: { minHeight: 60, lineHeight: 20 },
  countBadge: { minWidth: 26, minHeight: 26, borderRadius: 13, backgroundColor: NU.surfaceSubtleStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  countText: { fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: NU.blueHi },
  ingredientsCard: { backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline, borderRadius: 14, marginTop: 12, paddingHorizontal: 12 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  ingredientDivider: { borderTopWidth: 1, borderTopColor: NU.hairline },
  ingredientName: { flex: 1, minWidth: 0, fontFamily: 'Archivo_400Regular', fontSize: 14, lineHeight: 20, color: NU.white },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  quantityLabel: { fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.secondary },
  gramsField: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: 'transparent', borderRadius: 8, backgroundColor: NU.surfaceSubtleStrong, paddingHorizontal: 8 },
  gramsInput: { width: 52, minHeight: 44, paddingVertical: 10, fontFamily: 'Archivo_500Medium', fontSize: 14, color: NU.white },
  yieldPanel: { marginTop: 28, padding: 16, gap: 18, borderRadius: 20, borderWidth: 1, borderColor: NU.hairline, backgroundColor: NU.surfaceSubtle },
  servingsField: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderWidth: 1, borderColor: NU.hairline, borderRadius: 12, paddingHorizontal: 14, backgroundColor: NU.surfaceSubtleStrong },
  servingsInput: { flex: 1, minHeight: 52, paddingVertical: 14, fontFamily: 'Archivo_600SemiBold', fontSize: 17, color: NU.white },
  servingSummary: { alignItems: 'center', paddingTop: 20, borderTopWidth: 1, borderTopColor: NU.hairline },
  servingMacros: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 16, gap: 8 },
  servingMacro: { flex: 1, alignItems: 'center', gap: 5 },
  macroValue: { fontFamily: 'Archivo_600SemiBold', fontSize: 15, color: NU.white },
  macroLabel: { fontFamily: 'Archivo_400Regular', fontSize: 11, color: NU.secondary },
});
