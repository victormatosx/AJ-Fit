import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, InputAccessoryView, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { NU, NuButton, NuCap, NuHairline, NuPanel, NuSelectPill, NuStepper } from '../../components/nutrition/NuKit';
import { useAuth } from '../../state/AuthContext';
import { listCustomFoods } from '../../services/nutritionFoods';
import { createLocalFoodLogSearchProvider, ensureFoodLogEntryMaterialized } from '../../services/foodLogCatalog';
import { createFatSecretSearchProvider } from '../../nutrition/foodLog/fatsecretProvider';
import { createFederatedFoodLogSearchProvider } from '../../nutrition/foodLog/federatedSearchProvider';
import { nutrientsForGrams } from '../../nutrition/catalog/math';
import { nutrientsForServing, resolveDefaultServingUnit, servingGrams } from '../../nutrition/catalog/servings';
import { emptyTotals, foodPickOriginToDiarySource, isPositiveGrams } from '../../nutrition/ui/diaryModel';
import { countBucket, durationBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { CreateCustomFoodScreen } from './CreateCustomFoodScreen';
import {
  NUTRITION_MEAL_SLOTS, type FoodLogEntry, type FoodLogServingUnit, type FoodLogSourceType, type NutritionCustomFood,
  type NutritionFoodNutritionValues, type NutritionLoggedFoodItem, type NutritionLoggedFoodSource,
  type NutritionMealSlot, type NutritionPlanFoodItem,
} from '../../types/nutrition';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';

const DEBOUNCE_MS = 350;
/** Fase C5 — local-first federated provider (local + FatSecret fallback); same `FoodSearchProvider` interface `localFoodLogSearchProvider` had. */
const localFoodLogSearchProvider = createFederatedFoodLogSearchProvider({
  localProvider: createLocalFoodLogSearchProvider(), externalProvider: createFatSecretSearchProvider(),
});

interface FoodPick {
  foodId: string;
  name: string;
  origin: 'food_log' | 'custom';
  nutritionPer100g: NutritionFoodNutritionValues;
  sourceType?: FoodLogSourceType;
  /** Fase C6 ("serving units") — absent for custom foods/anything with no confidently-sourced natural unit; grams stays the only input then. */
  servings?: FoodLogServingUnit[];
  defaultServingId?: string | null;
}

type GramsStep = { mode: 'add'; food: FoodPick } | { mode: 'edit'; item: NutritionLoggedFoodItem };

/**
 * ONE screen for "Nutrição → registrar refeição manualmente" (round brief
 * part 3): meal-slot dropdown, a live-updating totals summary for whatever
 * slot is selected, an embedded search (no navigation to
 * `FoodSearchScreen`), and the slot's already-logged items — all on one
 * surface, no wizard steps.
 *
 * Every mutation (add/edit/remove) is delegated to `NutritionShell`, which
 * calls the EXISTING `addDiaryFood`/`updateDiaryEntryGrams`/
 * `removeDiaryEntry` (same functions the per-slot Diary "+" already uses —
 * no second diary-write path). `day` is the live `todayDiary` subscription
 * already running in `NutritionShell` for Home's own summary, so every
 * write reflects back here immediately without this screen holding any
 * client-side copy of the meal's items/totals — nothing to go stale.
 *
 * `addDiaryFood` -> `replaceMealItemsOnMeal` always defaults
 * `followedRecommendedOptionId` to `null` for a manual add, so
 * `recommendedPlan != actualIntake` holds with no extra logic here.
 */
export function RegisterMealScreen({
  visible, day, initialSlot, referenceItems, mealSlots, onClose, onAddFood, onEditGrams, onRemove, favoriteFoodIds, recentFoodIds, onToggleFavoriteFood,
}: {
  visible: boolean;
  day: NutritionDailyLogDoc | null;
  /** Pre-selects the meal slot when opened from a recommended option/alternative/favorite ("Registrar esta opção"). */
  initialSlot?: NutritionMealSlot | null;
  /** The recommended option's items, shown read-only — diet-quality-v3: never persisted as-is, only a reference while the user adds the real catalog foods they ate. */
  referenceItems?: readonly NutritionPlanFoodItem[] | null;
  /** The slots the user actually picked in the questionnaire (`NutritionProfile.mealSlots`) — only these render as chips, never the full `NUTRITION_MEAL_SLOTS` set. Falls back to `NUTRITION_MEAL_SLOTS` only if this arrives empty (profile not loaded yet), so the picker is never blank. */
  mealSlots: readonly NutritionMealSlot[];
  onClose: () => void;
  onAddFood: (slot: NutritionMealSlot, source: NutritionLoggedFoodSource, foodId: string, grams: number) => Promise<void>;
  onEditGrams: (slot: NutritionMealSlot, item: NutritionLoggedFoodItem, grams: number) => Promise<void>;
  onRemove: (slot: NutritionMealSlot, itemId: string) => Promise<void>;
  favoriteFoodIds?: readonly string[];
  recentFoodIds?: readonly string[];
  onToggleFavoriteFood?: (foodId: string) => void;
}) {
  const { t } = useTranslation('nutrition');
  const { t: tCommon } = useTranslation('common');
  const { user } = useAuth();

  const slots = mealSlots.length > 0 ? mealSlots : NUTRITION_MEAL_SLOTS;
  const [slot, setSlot] = useState<NutritionMealSlot>(initialSlot ?? slots[0]);

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

  const [gramsStep, setGramsStep] = useState<GramsStep | null>(null);
  const [gramsText, setGramsText] = useState('100');
  const gramsInputRef = useRef<TextInput>(null);
  /** Fase C6 — which natural unit (if any) is driving `gramsText`; `null` means manual/plain grams. Selecting a unit recomputes `gramsText`, but it stays a normal editable number afterward. */
  const [selectedServingId, setSelectedServingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Fase C5 — a fresh FatSecret result isn't a real `foodLogCatalog` doc yet; brief inline wait while `ensureFoodLogEntryMaterialized` upserts it before grams entry opens. */
  const [materializingId, setMaterializingId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [creatingFoodFromScan, setCreatingFoodFromScan] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSlot(slots[0]); setSearchText(''); setCatalogResults([]); setCursor(null);
      setGramsStep(null); setBusy(false); setSelectedServingId(null);
      setScannerOpen(false); setCreatingFoodFromScan(false);
      return;
    }
    setSlot(initialSlot ?? slots[0]);
    if (user) listCustomFoods(user.uid).then(setCustomFoods).catch(() => setCustomFoods([]));
  }, [visible, user, initialSlot, slots]);

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

  const query = searchText.trim().toLocaleLowerCase('pt-BR');
  const matchingCustom = query.length < 2 ? [] : customFoods.filter((food) => food.name.toLocaleLowerCase('pt-BR').includes(query));

  const meal = day?.meals.find((item) => item.slot === slot);
  const items = meal?.items ?? [];
  const totals = meal?.totals ?? emptyTotals();
  const showReference = !!referenceItems && referenceItems.length > 0 && slot === initialSlot;

  const gramsValue = Number(gramsText.replace(',', '.'));
  const gramsValid = isPositiveGrams(gramsValue);
  const stepNutritionPer100g = gramsStep?.mode === 'add' ? gramsStep.food.nutritionPer100g
    : gramsStep?.mode === 'edit' ? { kcal: gramsStep.item.snapshot.kcal / (gramsStep.item.grams / 100),
      proteinG: gramsStep.item.snapshot.proteinG / (gramsStep.item.grams / 100),
      carbsG: gramsStep.item.snapshot.carbsG / (gramsStep.item.grams / 100),
      fatG: gramsStep.item.snapshot.fatG / (gramsStep.item.grams / 100),
      fiberG: gramsStep.item.snapshot.fiberG == null ? null : gramsStep.item.snapshot.fiberG / (gramsStep.item.grams / 100) } : null;
  const preview = stepNutritionPer100g && gramsValid ? nutrientsForGrams(stepNutritionPer100g, gramsValue) : null;
  /** Fase C6 — only units with a confident gram basis are selectable; absent/ml-only units never appear here (grams stays the only input for them). */
  const servableUnits = gramsStep?.mode === 'add' ? (gramsStep.food.servings ?? []).filter((unit) => servingGrams(unit) != null) : [];
  const selectServingUnit = (unit: FoodLogServingUnit | null) => {
    setSelectedServingId(unit?.id ?? null);
    if (unit) { const grams = servingGrams(unit); if (grams != null) setGramsText(String(grams)); }
  };

  const openAddGrams = (food: FoodPick) => {
    Keyboard.dismiss();
    trackNutritionEvent({ name: 'nutrition_catalog_item_selected',
      properties: { catalogMode: 'logging', origin: food.origin, ...(food.sourceType ? { source: food.sourceType } : {}) } });
    // Fase C6 — defaults to the food's natural unit when it has one; `gramsText` is always a plain editable number either way.
    const defaultUnit = resolveDefaultServingUnit(food.servings, food.defaultServingId);
    const defaultGrams = defaultUnit ? servingGrams(defaultUnit) : null;
    setGramsStep({ mode: 'add', food });
    setSelectedServingId(defaultUnit?.id ?? null);
    setGramsText(defaultGrams != null ? String(defaultGrams) : '100');
  };

  /** Barcode scan already resolved AND materialized this entry server-side (`resolveFoodByBarcode`) — opens the SAME grams/serving-unit confirmation step a text-search selection would, never a second confirmation UI. */
  const handleBarcodeResolved = (entry: FoodLogEntry<Timestamp>) => {
    setScannerOpen(false);
    openAddGrams({
      foodId: entry.id, name: entry.name, origin: 'food_log', nutritionPer100g: entry.nutritionPer100g,
      sourceType: entry.source.type, servings: entry.servings, defaultServingId: entry.defaultServingId,
    });
  };

  const openEditGrams = (item: NutritionLoggedFoodItem) => {
    setGramsStep({ mode: 'edit', item }); setSelectedServingId(null); setGramsText(String(item.grams));
  };

  /** Materializes a possibly-fresh external (`fatsecret`) result into `foodLogCatalog` before grams entry opens — a no-op read for every local-sourced result. */
  const selectCatalogFood = async (food: FoodLogEntry<Timestamp>) => {
    setMaterializingId(food.id);
    try {
      const materialized = await ensureFoodLogEntryMaterialized(food);
      openAddGrams({ foodId: materialized.id, name: materialized.name, origin: 'food_log',
        nutritionPer100g: materialized.nutritionPer100g, sourceType: materialized.source.type,
        servings: materialized.servings, defaultServingId: materialized.defaultServingId });
    } finally {
      setMaterializingId(null);
    }
  };

  const confirmGrams = async () => {
    if (!gramsStep || !gramsValid || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    try {
      if (gramsStep.mode === 'add') {
        await onAddFood(slot, foodPickOriginToDiarySource(gramsStep.food.origin), gramsStep.food.foodId, gramsValue);
        setSearchText('');
      } else {
        await onEditGrams(slot, gramsStep.item, gramsValue);
      }
      setGramsStep(null);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (item: NutritionLoggedFoodItem) => {
    Alert.alert(t('diary.removeConfirm'), undefined, [
      { text: t('diary.cancel'), style: 'cancel' },
      { text: t('diary.remove'), style: 'destructive', onPress: () => { void onRemove(slot, item.id); } },
    ]);
  };

  const totalChips: [string, string, string][] = [
    ['kcal', String(Math.round(totals.kcal)), t('units.kcal')],
    ['proteinG', totals.proteinG.toFixed(1), t('home.summary.protein')],
    ['carbsG', totals.carbsG.toFixed(1), t('home.summary.carbs')],
    ['fatG', totals.fatG.toFixed(1), t('home.summary.fat')],
    ['fiberG', totals.fiberG.toFixed(1), t('home.summary.fiber')],
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 16, paddingBottom: 2 }}>
              <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 19, letterSpacing: -0.3, color: NU.white }}>{t('registerMeal.title')}</Text>
              <Pressable
                accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={onClose}
                style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: NU.surfaceSubtleStrong }}
              >
                <Icon name="x" size={17} color={NU.secondary} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 22, marginTop: 18 }}>
              <NuCap style={{ marginBottom: 10 }}>{t('registerMeal.selectSlot')}</NuCap>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {slots.map((option) => (
                  <NuSelectPill key={option} on={slot === option} onPress={() => setSlot(option)}>
                    {t(`mealSlots.${option}`)}
                  </NuSelectPill>
                ))}
              </ScrollView>
            </View>

            <View style={{ paddingHorizontal: 22, marginTop: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1,
                borderColor: NU.hairline, backgroundColor: NU.surfaceSubtle, paddingVertical: 13 }}>
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
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 20, paddingBottom: 40, gap: 10 }}>
              {showReference ? (
                <View style={{ padding: 14, borderRadius: 12, backgroundColor: NU.surfaceSubtle, gap: 8 }}>
                  <NuCap>{t('registerMeal.referenceTitle')}</NuCap>
                  {referenceItems!.map((food, index) => (
                    <Text key={`${food.name}-${index}`} style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint }}>
                      {`${food.name} — ${food.quantity} ${food.unit}`}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 50,
                    borderRadius: 12, backgroundColor: NU.surfaceSubtleStrong }}
                >
                  <Icon name="search" size={16} color={NU.faint} />
                  <TextInput
                    value={searchText} onChangeText={setSearchText} placeholder={t('foodSearch.placeholder')}
                    placeholderTextColor={NU.faint} returnKeyType="search"
                    style={{ flex: 1, fontFamily: 'Archivo_400Regular', fontSize: 15, color: NU.white }}
                  />
                </View>
                <Pressable
                  onPress={() => setScannerOpen(true)} accessibilityRole="button" accessibilityLabel={t('barcodeScan.scanButtonLabel')}
                  style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12,
                    backgroundColor: NU.surfaceSubtleStrong }}
                >
                  <Icon name="barcode" size={18} color={NU.secondary} />
                </Pressable>
              </View>

              {searchText.trim().length >= 2 ? (
                searchLoading ? (
                  <View style={{ gap: 8 }}><SkeletonBlock height={52} /><SkeletonBlock height={52} /></View>
                ) : searchError ? (
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.danger }}>
                    {t('foodSearch.error')}
                  </Text>
                ) : matchingCustom.length === 0 && catalogResults.length === 0 ? (
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
                        onPress={() => openAddGrams({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g })} />
                    ))}
                    {catalogResults.map((food) => {
                      // Fase C7 — shows the food's default natural unit instead of always "por 100 g", when one exists.
                      const defaultUnit = resolveDefaultServingUnit(food.servings, food.defaultServingId);
                      const servingNutrients = defaultUnit ? nutrientsForServing(food.nutritionPer100g, defaultUnit) : null;
                      return (
                        <FoodRow key={food.id} name={food.name} brandName={food.brand?.name} origin="food_log"
                          kcal={servingNutrients?.kcal ?? food.nutritionPer100g.kcal} proteinG={servingNutrients?.proteinG ?? food.nutritionPer100g.proteinG}
                          per100g={!servingNutrients} servingLabel={defaultUnit?.label}
                          favorited={favoriteFoodIds?.includes(food.id)}
                          onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                          trailing={materializingId === food.id ? <ActivityIndicator size="small" color={NU.faint} /> : undefined}
                          onPress={() => { void selectCatalogFood(food); }} />
                      );
                    })}
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

              <NuCap style={{ marginTop: 8 }}>{t('registerMeal.itemsTitle')}</NuCap>
              {items.length === 0 ? (
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint, paddingVertical: 2 }}>
                  {t('registerMeal.noFoodsYet')}
                </Text>
              ) : (
                <View style={{ borderRadius: 14, borderWidth: 1, borderColor: NU.hairline, backgroundColor: NU.surfaceSubtle, paddingHorizontal: 14 }}>
                  {items.map((item, index) => (
                    <View key={item.id}>
                      {index > 0 ? <NuHairline /> : null}
                      <FoodRow
                        name={item.snapshot.name} grams={item.grams} kcal={item.snapshot.kcal}
                        trailing={(
                          <View style={{ flexDirection: 'row', gap: 14 }}>
                            <Pressable onPress={() => openEditGrams(item)} accessibilityRole="button" accessibilityLabel={t('diary.editGrams')}>
                              <Icon name="more-vertical" size={16} color={NU.faint} />
                            </Pressable>
                            <Pressable onPress={() => confirmRemove(item)} accessibilityRole="button" accessibilityLabel={t('diary.remove')}>
                              <Icon name="trash" size={15} color={NU.faint} />
                            </Pressable>
                          </View>
                        )}
                      />
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            <View style={{ padding: 22, borderTopWidth: 1, borderTopColor: NU.hairline }}>
              <NuButton onPress={onClose}>{t('registerMeal.close')}</NuButton>
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
                  {formatFoodDisplayName(gramsStep.mode === 'add' ? gramsStep.food.name : gramsStep.item.snapshot.name)}
                </Text>
                {onToggleFavoriteFood ? (() => {
                  const stepFoodId = gramsStep.mode === 'add' ? gramsStep.food.foodId : gramsStep.item.foodId;
                  const stepFavorited = favoriteFoodIds?.includes(stepFoodId);
                  return (
                    <Pressable
                      onPress={() => onToggleFavoriteFood(stepFoodId)} accessibilityRole="button" hitSlop={8}
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
                      inputAccessoryViewID={Platform.OS === 'ios' ? 'register-meal-quantity-done' : undefined}
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
              <NuButton onPress={() => { void confirmGrams(); }} disabled={!gramsValid || busy}>
                {busy ? <ActivityIndicator color="#fff" /> : t('diary.save')}
              </NuButton>
            </ScrollView>
          ) : null}
        </NuPanel>
        {Platform.OS === 'ios' && gramsStep ? (
          <InputAccessoryView nativeID="register-meal-quantity-done">
            <View style={{ backgroundColor: NU.panel, alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 10 }}>
              <Pressable onPress={Keyboard.dismiss} accessibilityRole="button" accessibilityLabel={tCommon('actions.done')} hitSlop={8}>
                <Icon name="check" size={24} color={NU.blueHi} />
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </View>

      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onResolved={handleBarcodeResolved}
        onNotFound={() => setCreatingFoodFromScan(true)}
      />
      <CreateCustomFoodScreen
        visible={creatingFoodFromScan}
        onClose={() => setCreatingFoodFromScan(false)}
        onCreated={(food) => {
          setCreatingFoodFromScan(false);
          setCustomFoods((prev) => [...prev, food]);
          trackNutritionEvent({ name: 'nutrition_custom_item_created_after_search', properties: { catalogMode: 'logging', afterZeroResults: true } });
          openAddGrams({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g });
        }}
      />
    </Modal>
  );
}
