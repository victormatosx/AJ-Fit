import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
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
import { listCustomFoods } from '../../services/nutritionFoods';
import { createLocalFoodLogSearchProvider } from '../../services/foodLogCatalog';
import { nutrientsForGrams } from '../../nutrition/catalog/math';
import { emptyTotals, foodPickOriginToDiarySource, isPositiveGrams } from '../../nutrition/ui/diaryModel';
import { countBucket, durationBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';
import {
  NUTRITION_MEAL_SLOTS, type FoodLogEntry, type FoodLogSourceType, type NutritionCustomFood, type NutritionFoodNutritionValues,
  type NutritionLoggedFoodItem, type NutritionLoggedFoodSource, type NutritionMealSlot, type NutritionPlanFoodItem,
} from '../../types/nutrition';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';

const DEBOUNCE_MS = 350;
const localFoodLogSearchProvider = createLocalFoodLogSearchProvider();

interface FoodPick {
  foodId: string;
  name: string;
  origin: 'food_log' | 'custom';
  nutritionPer100g: NutritionFoodNutritionValues;
  sourceType?: FoodLogSourceType;
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
  visible, day, initialSlot, referenceItems, onClose, onAddFood, onEditGrams, onRemove, favoriteFoodIds, recentFoodIds, onToggleFavoriteFood,
}: {
  visible: boolean;
  day: NutritionDailyLogDoc | null;
  /** Pre-selects the meal slot when opened from a recommended option/alternative/favorite ("Registrar esta opção"). */
  initialSlot?: NutritionMealSlot | null;
  /** The recommended option's items, shown read-only — diet-quality-v3: never persisted as-is, only a reference while the user adds the real catalog foods they ate. */
  referenceItems?: readonly NutritionPlanFoodItem[] | null;
  onClose: () => void;
  onAddFood: (slot: NutritionMealSlot, source: NutritionLoggedFoodSource, foodId: string, grams: number) => Promise<void>;
  onEditGrams: (slot: NutritionMealSlot, item: NutritionLoggedFoodItem, grams: number) => Promise<void>;
  onRemove: (slot: NutritionMealSlot, itemId: string) => Promise<void>;
  favoriteFoodIds?: readonly string[];
  recentFoodIds?: readonly string[];
  onToggleFavoriteFood?: (foodId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();

  const [slot, setSlot] = useState<NutritionMealSlot>(initialSlot ?? NUTRITION_MEAL_SLOTS[0]);
  const [slotMenuOpen, setSlotMenuOpen] = useState(false);

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSlot(NUTRITION_MEAL_SLOTS[0]); setSlotMenuOpen(false); setSearchText(''); setCatalogResults([]); setCursor(null);
      setGramsStep(null); setBusy(false);
      return;
    }
    setSlot(initialSlot ?? NUTRITION_MEAL_SLOTS[0]);
    if (user) listCustomFoods(user.uid).then(setCustomFoods).catch(() => setCustomFoods([]));
  }, [visible, user, initialSlot]);

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

  const openAddGrams = (food: FoodPick) => {
    trackNutritionEvent({ name: 'nutrition_catalog_item_selected',
      properties: { catalogMode: 'logging', origin: food.origin, ...(food.sourceType ? { source: food.sourceType } : {}) } });
    setGramsStep({ mode: 'add', food }); setGramsText('100');
  };
  const openEditGrams = (item: NutritionLoggedFoodItem) => { setGramsStep({ mode: 'edit', item }); setGramsText(String(item.grams)); };

  const confirmGrams = async () => {
    if (!gramsStep || !gramsValid || busy) return;
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
              <Display size={20}>{t('registerMeal.title')}</Display>
              <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={onClose} style={{ padding: 6 }}>
                <Icon name="x" size={20} color={theme.colors.textFaint} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 22, marginTop: 10 }}>
              <Pressable
                onPress={() => setSlotMenuOpen((open) => !open)}
                accessibilityRole="button" accessibilityLabel={t('registerMeal.selectSlot')}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48,
                  paddingHorizontal: 14, borderRadius: theme.radii.lg, backgroundColor: theme.colors.inputBackground,
                  borderWidth: 1, borderColor: theme.colors.inputBorder }}
              >
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary }}>
                  {t(`mealSlots.${slot}`)}
                </Text>
                <Icon name="chevron-down" size={16} color={theme.colors.textFaint} />
              </Pressable>
              {slotMenuOpen ? (
                <View style={{ marginTop: 6, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceElevated,
                  borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
                  {NUTRITION_MEAL_SLOTS.map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => { setSlot(option); setSlotMenuOpen(false); }}
                      accessibilityRole="button" accessibilityLabel={t(`mealSlots.${option}`)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        paddingHorizontal: 14, paddingVertical: 12 }}
                    >
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textPrimary }}>
                        {t(`mealSlots.${option}`)}
                      </Text>
                      {option === slot ? <Icon name="check" size={15} color={theme.colors.primaryEmphasis} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 22, marginTop: 14 }}>
              {[
                { key: 'kcal', value: String(Math.round(totals.kcal)), label: t('units.kcal') },
                { key: 'proteinG', value: totals.proteinG.toFixed(1), label: t('home.summary.protein') },
                { key: 'carbsG', value: totals.carbsG.toFixed(1), label: t('home.summary.carbs') },
                { key: 'fatG', value: totals.fatG.toFixed(1), label: t('home.summary.fat') },
                { key: 'fiberG', value: totals.fiberG.toFixed(1), label: t('home.summary.fiber') },
              ].map((entry) => (
                <View key={entry.key} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: theme.radii.md,
                  backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
                  <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.textPrimary }}>{entry.value}</Text>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textFaint, marginTop: 1 }}>
                    {entry.label.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 40, gap: 10 }}>
              {showReference ? (
                <View style={{ padding: 14, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted, gap: 8 }}>
                  <MonoLabel color={theme.colors.textFaint}>{t('registerMeal.referenceTitle')}</MonoLabel>
                  {referenceItems!.map((food, index) => (
                    <Text key={`${food.name}-${index}`} style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted }}>
                      {`${food.name} — ${food.quantity} ${food.unit}`}
                    </Text>
                  ))}
                </View>
              ) : null}

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
                ) : matchingCustom.length === 0 && catalogResults.length === 0 ? (
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
                        onPress={() => openAddGrams({ foodId: food.id, name: food.name, origin: 'custom', nutritionPer100g: food.nutritionPer100g })} />
                    ))}
                    {catalogResults.map((food) => (
                      <FoodRow key={food.id} name={food.name} brandName={food.brand?.name} origin="food_log"
                        kcal={food.nutritionPer100g.kcal} proteinG={food.nutritionPer100g.proteinG} per100g
                        favorited={favoriteFoodIds?.includes(food.id)}
                        onToggleFavorite={onToggleFavoriteFood ? () => onToggleFavoriteFood(food.id) : undefined}
                        onPress={() => openAddGrams({ foodId: food.id, name: food.name, origin: 'food_log', nutritionPer100g: food.nutritionPer100g, sourceType: food.source.type })} />
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

              <MonoLabel color={theme.colors.textFaint} style={{ marginTop: 8 }}>{t('registerMeal.itemsTitle')}</MonoLabel>
              {items.length === 0 ? (
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>
                  {t('registerMeal.noFoodsYet')}
                </Text>
              ) : items.map((item) => (
                <FoodRow
                  key={item.id} name={item.snapshot.name} grams={item.grams} kcal={item.snapshot.kcal}
                  trailing={(
                    <View style={{ flexDirection: 'row', gap: 14 }}>
                      <Pressable onPress={() => openEditGrams(item)} accessibilityRole="button" accessibilityLabel={t('diary.editGrams')}>
                        <Icon name="settings" size={15} color={theme.colors.textFaint} />
                      </Pressable>
                      <Pressable onPress={() => confirmRemove(item)} accessibilityRole="button" accessibilityLabel={t('diary.remove')}>
                        <Icon name="trash" size={15} color={theme.colors.textFaint} />
                      </Pressable>
                    </View>
                  )}
                />
              ))}
            </ScrollView>

            <View style={{ padding: 22 }}>
              <CtaButton onPress={onClose}>{t('registerMeal.close')}</CtaButton>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ScreenBg>

      {gramsStep ? (
        // A second nested <Modal> here (rather than this plain absolute
        // overlay) is unreliable on top of the outer `pageSheet` Modal —
        // the dimming background sometimes fails to paint, leaving this
        // card's text overlapping the screen content behind it with no
        // backdrop. An absolutely-positioned View inside the SAME Modal
        // has no such native modal-stacking ambiguity. `zIndex`/`elevation`
        // are set explicitly so this always wins over any sibling that
        // happens to carry its own `elevation` (Android resolves stacking
        // by elevation first, not just render order).
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.loadingOverlay,
            alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 50, elevation: 50 }}
        >
          {/*
            `surfaceElevated` is a SUBTLE elevation tint meant to sit on an
            already-opaque screen background — in the dark theme it's only
            5% white (`alpha.white05`), which is what made this card read
            as "no background" with the food list bleeding through its
            text. `sheetBackground` is the token actually meant for an
            opaque sheet/card floating over arbitrary content (solid white
            in light, solid ink in dark) — see `lightTokens.ts`/`tokens.ts`.
          */}
          <View style={{ width: '100%', borderRadius: theme.radii.xl, backgroundColor: theme.colors.sheetBackground,
            borderWidth: 1, borderColor: theme.colors.border, padding: 22, gap: 16 }}>
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.textPrimary }}>
              {formatFoodDisplayName(gramsStep.mode === 'add' ? gramsStep.food.name : gramsStep.item.snapshot.name)}
            </Text>
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>{t('registerMeal.gramsLabel')}</Text>
              <TextInput
                value={gramsText} onChangeText={setGramsText} keyboardType="decimal-pad" autoFocus
                style={{ height: 48, borderRadius: theme.radii.lg, paddingHorizontal: 14, backgroundColor: theme.colors.inputBackground,
                  borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 16, color: theme.colors.inputText }}
              />
            </View>
            {preview ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted }}>
                {`${Math.round(preview.kcal)} ${t('units.kcal')} · ${preview.proteinG.toFixed(1)} g ${t('registerMeal.proteinShort')}`}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <CtaButton ghost onPress={() => setGramsStep(null)} disabled={busy} style={{ flex: 1 }}>{t('diary.cancel')}</CtaButton>
              <CtaButton onPress={() => { void confirmGrams(); }} disabled={!gramsValid || busy} style={{ flex: 1 }}>
                {busy ? <ActivityIndicator color={theme.colors.primaryForeground} /> : t('diary.save')}
              </CtaButton>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
