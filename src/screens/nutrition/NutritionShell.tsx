import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { useAuth } from '../../state/AuthContext';
import { loadNutritionRolloutConfig, nutritionFlagEnabled } from '../../nutrition/rollout';
import { resolveNutritionPhysicalContext } from '../../services/nutritionContext';
import { loadNutritionProfile, createNutritionProfile, updateNutritionProfile, type NutritionProfileAnswers } from '../../services/nutritionProfile';
import {
  requestNutritionPlanGeneration, subscribeToActiveNutritionGenerationJob, subscribeToNutritionGenerationJob,
  type NutritionGenerationJobDoc,
} from '../../services/nutritionGeneration';
import {
  restoreNutritionPlan, subscribeToActiveNutritionPlan, subscribeToNutritionPlans, type NutritionPlanDoc,
} from '../../services/nutritionPlans';
import {
  addDiaryFood, moveDiaryEntry, removeDiaryEntry, subscribeToDiaryDay, subscribeToDiaryWeek, updateDiaryEntryGrams,
  type NutritionDailyLogDoc,
} from '../../services/nutritionDiary';
import {
  addFavoriteMealOption, loadNutritionPreferences, removeFavoriteMealOption,
  toggleFavoriteFoodId, toggleFavoriteRecipeId, type NutritionPreferencesDoc,
} from '../../services/nutritionFavorites';
import { requestNutritionMealAlternative } from '../../services/nutritionMealAlternative';
import { loadNutritionRecipe } from '../../services/nutritionRecipes';
import type {
  NutritionGoal, NutritionLoggedFoodItem, NutritionLoggedFoodSource, NutritionMealOption, NutritionMealSlot,
  NutritionPlanFoodItem, NutritionProfile as NutritionProfileType, NutritionRecipe,
} from '../../types/nutrition';
import { isSafetyBlocked, type ProfileDraft } from '../../nutrition/ui/profileSteps';
import { foodPickOriginToDiarySource } from '../../nutrition/ui/diaryModel';
import { mapGenerationRequestError, type GenerationRequestErrorKey } from '../../nutrition/ui/generationStage';
import { endOfLocalWeek, todayLocalDate, shiftLocalDate, isFutureLocalDate, startOfLocalWeek } from '../../nutrition/ui/localDate';
import {
  buildNutritionWeeklySummary, buildNutritionWeeklyWeightSummary, nextNutritionWeek, previousNutritionWeek,
} from '../../nutrition/weekly';
import { useAssessments } from '../../hooks/useAssessments';
import { NutritionHomeScreen, type NutritionHomeState } from './NutritionHomeScreen';
import { NutritionProfileScreen } from './NutritionProfileScreen';
import { NutritionGeneratingScreen } from './NutritionGeneratingScreen';
import { NutritionPlanScreen } from './NutritionPlanScreen';
import { MealDetailsScreen } from './MealDetailsScreen';
import { MealFeedbackSheet, type MealSwapFeedback } from './MealFeedbackSheet';
import { MealAlternativeResultScreen, type MealAlternativeViewState } from './MealAlternativeResultScreen';
import { NutritionDiaryScreen } from './NutritionDiaryScreen';
import { RegisterMealScreen } from './RegisterMealScreen';
import { NutritionPlanHistoryScreen } from './NutritionPlanHistoryScreen';
import { NutritionFavoritesScreen } from './NutritionFavoritesScreen';
import { NutritionFoodFavoritesScreen } from './NutritionFoodFavoritesScreen';
import { CreateCustomFoodScreen } from './CreateCustomFoodScreen';
import { CreateRecipeScreen } from './CreateRecipeScreen';
import { FoodSearchScreen, type NutritionFoodPick } from './FoodSearchScreen';
import { RecipeQuantityModal } from './RecipeQuantityModal';
import { FoodQuantityModal } from './FoodQuantityModal';
import { NutritionWeeklySummaryScreen } from './NutritionWeeklySummaryScreen';
import { useScreenFocusEffect } from '../../state/ScreenActivity';
import { countBucket, trackNutritionEvent } from '../../nutrition/analytics';
import { recentFoodLogIds } from '../../nutrition/foodLog/recent';

type Route =
  | { name: 'home' } | { name: 'profile'; mode: 'create' | 'edit' } | { name: 'generating' } | { name: 'plan' }
  | { name: 'historicalPlan'; plan: NutritionPlanDoc } | { name: 'weekly'; weekStartLocalDate: string };

/**
 * Owns Nutrition's internal routing — mirrors AppShell's `SupportRoute`
 * pattern (a local discriminated-union route plus `PersistentScreen`
 * siblings) instead of a second navigator, per `08_frontend/navigation.md`.
 * Mounted once by AppShell inside `<PersistentScreen active={tab ===
 * 'nutrition'}>`; everything below is local state, not a new router.
 */
export function NutritionShell({ navigationRequest, onOpenProgress }: {
  navigationRequest?: { destination: 'plan' | 'diary' | 'weekly'; nonce: number } | null;
  onOpenProgress?: () => void;
} = {}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { t } = useTranslation('nutrition');

  const [generationEnabled, setGenerationEnabled] = useState(false);
  const [profile, setProfile] = useState<NutritionProfileType<Timestamp> | null>(null);
  const [goal, setGoal] = useState<NutritionGoal | null>(null);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [baseError, setBaseError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [plan, setPlan] = useState<NutritionPlanDoc | null>(null);
  const [planLoaded, setPlanLoaded] = useState(false);

  const [activeJob, setActiveJob] = useState<NutritionGenerationJobDoc | null>(null);
  const [activeJobLoaded, setActiveJobLoaded] = useState(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [job, setJob] = useState<NutritionGenerationJobDoc | null>(null);

  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<GenerationRequestErrorKey | null>(null);
  const [mealDetailsSlot, setMealDetailsSlot] = useState<NutritionMealSlot | null>(null);
  const [creatingCustomFood, setCreatingCustomFood] = useState(false);
  const [creatingRecipe, setCreatingRecipe] = useState(false);

  // Diary.
  const [diaryVisible, setDiaryVisible] = useState(false);
  const [diaryDate, setDiaryDate] = useState(() => todayLocalDate());
  const [todayDiary, setTodayDiary] = useState<NutritionDailyLogDoc | null>(null);
  const [diaryDay, setDiaryDay] = useState<NutritionDailyLogDoc | null>(null);
  const [diaryLoaded, setDiaryLoaded] = useState(false);
  const [diaryFoodTarget, setDiaryFoodTarget] = useState<NutritionMealSlot | null>(null);
  const [registeringMealVisible, setRegisteringMealVisible] = useState(false);
  const [registeringMealSlot, setRegisteringMealSlot] = useState<NutritionMealSlot | null>(null);
  const [registeringMealReference, setRegisteringMealReference] = useState<readonly NutritionPlanFoodItem[] | null>(null);
  const [recipeQuantityPick, setRecipeQuantityPick] = useState<NutritionFoodPick | null>(null);
  const [recipeQuantityRecipe, setRecipeQuantityRecipe] = useState<NutritionRecipe<Timestamp> | null>(null);
  /** Fase C8 — mirrors `recipeQuantityPick`'s role, but for a catalog/custom food: resolves grams/serving-unit BEFORE the `addDiaryFood` call, instead of writing immediately on selection. */
  const [foodQuantityPick, setFoodQuantityPick] = useState<NutritionFoodPick | null>(null);

  // Weekly summary: one bounded Monday-Sunday diary listener and the existing plan/assessment sources.
  const [weeklyLogs, setWeeklyLogs] = useState<NutritionDailyLogDoc[]>([]);
  const [weeklyLoaded, setWeeklyLoaded] = useState(false);
  const [weeklyError, setWeeklyError] = useState(false);
  const [weeklyRetryKey, setWeeklyRetryKey] = useState(0);

  // Register/favorite feedback from MealDetails/alternative.
  const [registeringOptionId, setRegisteringOptionId] = useState<string | null>(null);
  const [favoritingOptionId, setFavoritingOptionId] = useState<string | null>(null);
  const [favoritedOptionIds, setFavoritedOptionIds] = useState<string[]>([]);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  // Swap/feedback/alternative.
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [alternativeVisible, setAlternativeVisible] = useState(false);
  const [alternativeState, setAlternativeState] = useState<MealAlternativeViewState | null>(null);
  const [lastFeedback, setLastFeedback] = useState<MealSwapFeedback | null>(null);

  // History.
  const [historyVisible, setHistoryVisible] = useState(false);
  const [plans, setPlans] = useState<NutritionPlanDoc[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [restoringPlanId, setRestoringPlanId] = useState<string | null>(null);

  // Three intentionally separate concepts: food ids, recipe ids and
  // snapshot-backed meal-option favorites.
  const [favoriteItemsVisible, setFavoriteItemsVisible] = useState(false);
  const [mealFavoritesVisible, setMealFavoritesVisible] = useState(false);
  const [preferences, setPreferences] = useState<NutritionPreferencesDoc | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [favoriteFoodIds, setFavoriteFoodIds] = useState<string[]>([]);
  const [favoriteRecipeIds, setFavoriteRecipeIds] = useState<string[]>([]);
  const favoriteFoodIdsRef = useRef<string[]>([]);
  const favoriteRecipeIdsRef = useRef<string[]>([]);
  const favoriteFoodMutationVersions = useRef<Record<string, number>>({});
  const favoriteRecipeMutationVersions = useRef<Record<string, number>>({});
  const favoriteMutationRevision = useRef(0);
  const favoriteOwnerUidRef = useRef<string | null>(uid);
  favoriteOwnerUidRef.current = uid;
  const [removingFavoriteId, setRemovingFavoriteId] = useState<string | null>(null);
  const [usingFavoriteId, setUsingFavoriteId] = useState<string | null>(null);

  const {
    assessments, loading: assessmentsLoading, error: assessmentsError, refresh: refreshAssessments,
  } = useAssessments(uid);
  const currentWeekStart = startOfLocalWeek();
  const selectedWeekStart = route.name === 'weekly' ? route.weekStartLocalDate : currentWeekStart;
  const selectedWeekEnd = endOfLocalWeek(selectedWeekStart);

  useEffect(() => {
    if (!navigationRequest) return;
    if (navigationRequest.destination === 'plan') {
      setRoute({ name: 'plan' });
      return;
    }
    if (navigationRequest.destination === 'weekly') {
      setRoute({ name: 'weekly', weekStartLocalDate: startOfLocalWeek() });
      return;
    }
    setDiaryDate(todayLocalDate());
    setDiaryVisible(true);
    setRoute({ name: 'home' });
  }, [navigationRequest]);

  useScreenFocusEffect(useCallback(() => {
    trackNutritionEvent({ name: 'nutrition_opened', properties: { source: 'tab' } });
  }, []));

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setBaseError(false);
    Promise.all([loadNutritionRolloutConfig(), loadNutritionProfile(uid), resolveNutritionPhysicalContext(uid)])
      .then(([config, loadedProfile, physical]) => {
        if (cancelled) return;
        setGenerationEnabled(nutritionFlagEnabled(uid, 'nutritionPlanGenerationEnabled', config));
        setProfile(loadedProfile);
        setGoal(physical?.goal ?? null);
        setBaseLoaded(true);
      })
      .catch(() => { if (!cancelled) { setBaseError(true); setBaseLoaded(true); } });
    return () => { cancelled = true; };
  }, [uid, reloadKey]);

  useEffect(() => {
    if (!uid) {
      setPreferences(null);
      favoriteFoodIdsRef.current = [];
      favoriteRecipeIdsRef.current = [];
      setFavoriteFoodIds([]);
      setFavoriteRecipeIds([]);
      return;
    }
    let cancelled = false;
    const revisionAtStart = favoriteMutationRevision.current;
    setPreferencesLoading(true);
    loadNutritionPreferences(uid)
      .then((loaded) => {
        if (cancelled) return;
        setPreferences(loaded);
        if (favoriteMutationRevision.current !== revisionAtStart) return;
        const foods = loaded?.favoriteFoodIds ?? [];
        const recipes = loaded?.favoriteRecipeIds ?? [];
        favoriteFoodIdsRef.current = foods;
        favoriteRecipeIdsRef.current = recipes;
        setFavoriteFoodIds(foods);
        setFavoriteRecipeIds(recipes);
      })
      .catch(() => { /* Keep the last optimistic/local state; a later open retries. */ })
      .finally(() => { if (!cancelled) setPreferencesLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    setPlansLoading(true);
    return subscribeToNutritionPlans(
      uid,
      (next) => { setPlans(next); setPlansLoading(false); },
      () => setPlansLoading(false),
    );
  }, [uid, reloadKey]);

  useEffect(() => {
    if (!uid) return;
    setPlanLoaded(false);
    return subscribeToActiveNutritionPlan(uid, (next) => { setPlan(next); setPlanLoaded(true); }, () => setPlanLoaded(true));
  }, [uid, reloadKey]);

  // Resumes tracking an in-flight generation across navigation/app restarts
  // — backend single-flight guarantees at most one active job per user.
  useEffect(() => {
    if (!uid) return;
    return subscribeToActiveNutritionGenerationJob(uid, (next) => {
      setActiveJob(next);
      setActiveJobLoaded(true);
      if (next) {
        setGenerationId(next.generationId);
        setRoute((current) => (current.name === 'generating' ? current : { name: 'generating' }));
      }
    }, () => setActiveJobLoaded(true));
  }, [uid]);

  useEffect(() => {
    if (!uid || !generationId) { setJob(null); return; }
    return subscribeToNutritionGenerationJob(uid, generationId, setJob);
  }, [uid, generationId]);

  useEffect(() => {
    if (job?.status === 'completed') { setGenerationId(null); setRoute({ name: 'home' }); }
  }, [job?.status]);

  // Today's diary — drives NutritionHome's real consumption summary.
  useEffect(() => {
    if (!uid) return;
    const today = todayLocalDate();
    return subscribeToDiaryDay(uid, today, setTodayDiary);
  }, [uid]);

  // The diary modal's own (possibly past) date.
  useEffect(() => {
    if (!uid || !diaryVisible) return;
    setDiaryLoaded(false);
    return subscribeToDiaryDay(uid, diaryDate, (day) => { setDiaryDay(day); setDiaryLoaded(true); });
  }, [uid, diaryVisible, diaryDate]);

  useEffect(() => {
    if (!uid) return;
    setWeeklyLoaded(false);
    setWeeklyError(false);
    return subscribeToDiaryWeek(
      uid, selectedWeekStart, selectedWeekEnd,
      (days) => { setWeeklyLogs(days); setWeeklyLoaded(true); },
      () => { setWeeklyError(true); setWeeklyLoaded(true); },
    );
  }, [uid, selectedWeekStart, selectedWeekEnd, weeklyRetryKey]);

  const weeklySummary = useMemo(() => buildNutritionWeeklySummary({
    weekStartLocalDate: selectedWeekStart,
    logs: weeklyLogs,
    plans: plans.length > 0 ? plans : plan ? [plan] : [],
  }), [plan, plans, selectedWeekStart, weeklyLogs]);
  // Reuse the already-subscribed bounded week: personalization adds no
  // diary reads to the per-keystroke catalog hot path.
  const recentFoodIds = useMemo(() => recentFoodLogIds(weeklyLogs, 20), [weeklyLogs]);

  const weeklyWeight = useMemo(() => buildNutritionWeeklyWeightSummary({
    weekEndLocalDate: selectedWeekEnd,
    assessments,
    targetWeightKg: profile?.targetWeightKg,
  }), [assessments, profile?.targetWeightKg, selectedWeekEnd]);

  useEffect(() => {
    if (route.name === 'profile') {
      trackNutritionEvent({ name: 'nutrition_profile_started', properties: { mode: route.mode } });
    } else if (route.name === 'plan' || route.name === 'historicalPlan') {
      trackNutritionEvent({ name: 'nutrition_plan_viewed', properties: {
        source: route.name === 'plan' ? 'home' : 'history',
      } });
    } else if (route.name === 'weekly') {
      trackNutritionEvent({ name: 'nutrition_weekly_summary_viewed', properties: {
        source: 'home', loggedDaysBucket: countBucket(weeklySummary.recordedDays),
        hasWeightTrend: weeklyWeight.trendDirection !== 'insufficient',
      } });
    }
  }, [route.name]);

  const handleRequestGeneration = useCallback(async (): Promise<boolean> => {
    if (requesting) return false;
    setRequesting(true);
    setRequestError(null);
    try {
      trackNutritionEvent({ name: 'nutrition_generation_requested', properties: { source: 'home' } });
      const { generationId: id } = await requestNutritionPlanGeneration();
      setGenerationId(id);
      setRoute({ name: 'generating' });
      return true;
    } catch (error) {
      setRequestError(mapGenerationRequestError(error));
      return false;
    } finally {
      setRequesting(false);
    }
  }, [requesting]);

  const handleSubmitProfile = useCallback(async (draft: ProfileDraft) => {
    if (!uid) return;
    setSaving(true);
    setSaveError(null);
    const isFirstCreation = !profile;
    try {
      const answers = draft as NutritionProfileAnswers;
      if (profile) await updateNutritionProfile(uid, answers);
      else await createNutritionProfile(uid, answers);
      trackNutritionEvent({ name: 'nutrition_profile_completed', properties: {
        mode: profile ? 'edit' : 'create', mealSlotCountBucket: countBucket(draft.mealSlots?.length ?? 0),
      } });
      setReloadKey((key) => key + 1);
      if (isFirstCreation && !isSafetyBlocked(draft)) {
        // `handleRequestGeneration` never throws — it catches its own
        // errors into `requestError` state and returns false. Without
        // checking that return value, a failed request left `route`
        // stuck at 'profile' (the only successful path's `setRoute` is
        // inside `handleRequestGeneration` itself), so `requestError` —
        // only rendered in the 'home' branch below — never became
        // visible: the button just went back to normal with no feedback.
        const started = await handleRequestGeneration();
        if (!started) setRoute({ name: 'home' });
      } else setRoute({ name: 'home' });
    } catch {
      setSaveError('saveFailed');
    } finally {
      setSaving(false);
    }
  }, [uid, profile, handleRequestGeneration]);

  // --- Diary actions -------------------------------------------------------
  // `slot` is accepted (and passed by `onOpenDiarySlot`) only to keep that
  // call site distinct from the plain "ver diário" entry point — it must
  // NEVER feed `diaryFoodTarget`: that state is what makes `FoodSearchScreen`
  // visible (see its `visible={diaryFoodTarget != null}` below), so setting
  // it here opened a second native Modal (FoodSearchScreen, "Buscar
  // Alimento") stacked directly on top of NutritionDiaryScreen's own Modal
  // as soon as a meal row was tapped on Home — the exact stacked-Modal
  // freeze/ghost-reopen-on-tab-switch bug already fixed elsewhere in this
  // file (see mealSwapFlowRegression/stackedModalAuditRegression tests).
  const openDiary = (_slot?: NutritionMealSlot) => {
    setDiaryDate(todayLocalDate());
    setDiaryVisible(true);
    trackNutritionEvent({ name: 'nutrition_diary_day_viewed', properties: { source: 'home' } });
  };

  // --- Register Meal (single-screen manual logging, always "today") -------
  // Every call below is the SAME `addDiaryFood`/`updateDiaryEntryGrams`/
  // `removeDiaryEntry` the per-slot Diary "+" already uses — no second
  // diary-write path. `addDiaryFood` -> `replaceMealItemsOnMeal` always
  // defaults `followedRecommendedOptionId` to `null` for a manual add, so
  // `recommendedPlan != actualIntake` holds with no extra logic here.
  // `RegisterMealScreen` holds no client-side copy of the meal's items —
  // it reads straight from `todayDiary` (already a live subscription), so
  // every write below reflects back into the open screen automatically.
  const handleRegisterMealAdd = useCallback(async (
    slot: NutritionMealSlot, source: NutritionLoggedFoodSource, foodId: string, grams: number,
  ) => {
    if (!uid) return;
    await addDiaryFood(uid, todayLocalDate(), slot, source, foodId, grams);
    trackNutritionEvent({ name: 'nutrition_diary_item_added', properties: { mealSlot: slot, operation: source } });
  }, [uid]);
  const handleRegisterMealEditGrams = useCallback(async (slot: NutritionMealSlot, item: NutritionLoggedFoodItem, grams: number) => {
    if (!uid) return;
    await updateDiaryEntryGrams(uid, todayLocalDate(), slot, item.id, item.source, item.foodId, grams);
  }, [uid]);
  const handleRegisterMealRemove = useCallback(async (slot: NutritionMealSlot, itemId: string) => {
    if (!uid) return;
    await removeDiaryEntry(uid, todayLocalDate(), slot, itemId);
  }, [uid]);

  /**
   * Diet-quality-v3: a recommended option is never persisted as-is into the
   * diary (it has no catalog identity). "Registrar esta opção" instead opens
   * `RegisterMealScreen` with the slot pre-selected and the option's items
   * shown read-only for reference — the user searches/adds the real foods
   * they ate from the catalog.
   *
   * Regression: this is reachable while `MealDetailsScreen` (own `pageSheet`
   * Modal) is still open — the "Registrar esta opção" button lives inside
   * it, and so does the "Registrar" CTA on its `MealAlternativeResultScreen`
   * overlay. Without closing it first, `RegisterMealScreen`'s own Modal
   * opened STACKED on top of MealDetailsScreen's — two independent native
   * `<Modal>`s visible at once, the same class of bug already fixed for
   * `MealDetailsScreen` + `MealFeedbackSheet`: dismissing the inner one
   * (RegisterMealScreen's back/X) corrupted the outer one's native
   * presentation/touch chain ("Registrado..." shows, then back-arrow
   * freezes the screen, then switching tabs pops RegisterMealScreen back
   * open on its own). Closing the meal-details state here first — mirroring
   * what `NutritionFavoritesScreen`'s `onUse` already did — guarantees at
   * most one of those two Modals is ever visible.
   */
  const openRegisterMealForOption = useCallback((slot: NutritionMealSlot, option: NutritionMealOption) => {
    setMealDetailsSlot(null);
    setFeedbackVisible(false);
    setAlternativeVisible(false);
    setAlternativeState(null);
    setRegisteringMealSlot(slot);
    setRegisteringMealReference(option.foods);
    setRegisteringMealVisible(true);
  }, []);

  const handleRegisterOption = useCallback((option: NutritionMealOption) => {
    if (!plan) return;
    const slot = plan.meals.find((meal) => meal.options.some((item) => item.id === option.id))?.slot;
    if (!slot) return;
    openRegisterMealForOption(slot, option);
  }, [plan, openRegisterMealForOption]);

  const handleFavoriteOption = useCallback((option: NutritionMealOption, slot: NutritionMealSlot, source: 'plan' | 'alternative', refId: string) => {
    if (!uid) return;
    setFavoritingOptionId(option.id);
    setFavoriteError(null);
    addFavoriteMealOption(uid, {
      source, ...(source === 'plan' ? { planId: refId } : { alternativeId: refId }),
      slot, foods: option.foods, totals: option.totals,
    })
      .then(() => {
        setFavoritedOptionIds((prev) => [...prev, option.id]);
        trackNutritionEvent({ name: 'nutrition_favorite_added', properties: { mealSlot: slot, source } });
      })
      .catch(() => setFavoriteError(t('mealDetails.favoriteError')))
      .finally(() => setFavoritingOptionId(null));
  }, [uid, t]);

  // --- Swap / feedback / alternative ---------------------------------------
  const alternativeIdRef = useRef<string | null>(null);
  const handleRequestAlternative = useCallback((feedback?: MealSwapFeedback) => {
    if (!uid || !plan || !mealDetailsSlot) return;
    setLastFeedback(feedback ?? null);
    setAlternativeVisible(true);
    setAlternativeState({ kind: 'loading' });
    trackNutritionEvent({ name: 'nutrition_meal_alternative_requested', properties: {
      mealSlot: mealDetailsSlot, reasonCategory: feedback?.reason ?? 'none',
    } });
    requestNutritionMealAlternative({ planId: plan.planId, slot: mealDetailsSlot, feedback })
      .then((result) => {
        alternativeIdRef.current = result.alternativeId;
        setAlternativeState({ kind: 'result', options: result.options as NutritionMealOption[],
          recommendedOptionId: result.recommendedOptionId });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        setAlternativeState({ kind: 'error', retryable: message !== 'MEAL_ALTERNATIVE_COOLDOWN', copyKey: message === 'MEAL_ALTERNATIVE_COOLDOWN' ? 'cooldown' : 'error' });
      });
  }, [uid, plan, mealDetailsSlot]);

  // --- Favorites / history loaders -----------------------------------------
  const handleToggleFavoriteFood = useCallback((foodId: string) => {
    if (!uid) return;
    const previous = favoriteFoodIdsRef.current;
    const wasFavorite = previous.includes(foodId);
    const next = wasFavorite ? previous.filter((id) => id !== foodId) : [...previous, foodId];
    const version = (favoriteFoodMutationVersions.current[foodId] ?? 0) + 1;
    favoriteFoodMutationVersions.current[foodId] = version;
    favoriteMutationRevision.current += 1;
    favoriteFoodIdsRef.current = next;
    setFavoriteFoodIds(next);
    void toggleFavoriteFoodId(uid, foodId).catch(() => {
      if (favoriteOwnerUidRef.current !== uid || favoriteFoodMutationVersions.current[foodId] !== version) return;
      const current = favoriteFoodIdsRef.current;
      const rolledBack = wasFavorite
        ? (current.includes(foodId) ? current : [...current, foodId])
        : current.filter((id) => id !== foodId);
      favoriteFoodIdsRef.current = rolledBack;
      setFavoriteFoodIds(rolledBack);
      Alert.alert(t('favoriteItems.updateErrorTitle'), t('favoriteItems.updateErrorBody'));
    });
  }, [uid, t]);

  const handleToggleFavoriteRecipe = useCallback((recipeId: string) => {
    if (!uid) return;
    const previous = favoriteRecipeIdsRef.current;
    const wasFavorite = previous.includes(recipeId);
    const next = wasFavorite ? previous.filter((id) => id !== recipeId) : [...previous, recipeId];
    const version = (favoriteRecipeMutationVersions.current[recipeId] ?? 0) + 1;
    favoriteRecipeMutationVersions.current[recipeId] = version;
    favoriteMutationRevision.current += 1;
    favoriteRecipeIdsRef.current = next;
    setFavoriteRecipeIds(next);
    void toggleFavoriteRecipeId(uid, recipeId).catch(() => {
      if (favoriteOwnerUidRef.current !== uid || favoriteRecipeMutationVersions.current[recipeId] !== version) return;
      const current = favoriteRecipeIdsRef.current;
      const rolledBack = wasFavorite
        ? (current.includes(recipeId) ? current : [...current, recipeId])
        : current.filter((id) => id !== recipeId);
      favoriteRecipeIdsRef.current = rolledBack;
      setFavoriteRecipeIds(rolledBack);
      Alert.alert(t('favoriteItems.updateErrorTitle'), t('favoriteItems.updateErrorBody'));
    });
  }, [uid, t]);

  const openFavoriteItems = () => {
    setFavoriteItemsVisible(true);
  };
  const openMealFavorites = () => {
    if (!uid) return;
    setMealFavoritesVisible(true);
    setPreferencesLoading(true);
    loadNutritionPreferences(uid)
      .then(setPreferences)
      .catch(() => setPreferences(null))
      .finally(() => setPreferencesLoading(false));
  };
  const openHistory = () => {
    setHistoryVisible(true);
  };

  if (!uid || !baseLoaded || !activeJobLoaded) {
    return <NutritionHomeScreen state={{ kind: 'loading' }} onCreateCustomFood={() => {}} onCreateRecipe={() => {}} />;
  }

  if (baseError) {
    return (
      <NutritionHomeScreen
        state={{ kind: 'error', onRetry: () => { setBaseLoaded(false); setReloadKey((key) => key + 1); } }}
        onCreateCustomFood={() => {}} onCreateRecipe={() => {}}
      />
    );
  }

  const safetyBlocked = profile ? isSafetyBlocked(profile) : false;

  // Every route branch below renders only the route-specific screen as
  // `routeContent` — it never `return`s directly. All overlay modals
  // (meal details/feedback/alternative, register meal, diary, food
  // search, recipe quantity, create food/recipe, history, favorites) are
  // assembled once, further down, and rendered as siblings of
  // `routeContent` on every route. Routing used to `return` a
  // route-specific tree straight away, which unmounted whichever modals
  // live outside that branch's JSX without ever calling their `onClose`
  // — the modal's own `visible` flag in this component's state stayed
  // `true`, so the moment the user navigated back to a branch that does
  // render that modal, React Native's `Modal` mounted already-open,
  // popping up a screen the user never tapped to open (reported as the
  // feedback sheet or "Registrar alimento" appearing unprompted after the
  // app felt "stuck").
  let routeContent: React.ReactNode;

  if (route.name === 'profile') {
    routeContent = (
      <NutritionProfileScreen
        profile={profile}
        inheritedGoal={goal ?? 'health'}
        mode={route.mode}
        onCancel={() => setRoute({ name: 'home' })}
        saving={saving}
        saveError={saveError}
        onSubmit={handleSubmitProfile}
        favoriteFoodIds={favoriteFoodIds}
        onToggleFavoriteFood={handleToggleFavoriteFood}
      />
    );
  } else if (route.name === 'generating') {
    routeContent = (
      <NutritionGeneratingScreen
        job={job ?? activeJob}
        retrying={requesting}
        onRetry={() => { void handleRequestGeneration(); }}
        onBack={() => setRoute({ name: 'home' })}
      />
    );
  } else if (route.name === 'historicalPlan') {
    routeContent = (
      <NutritionPlanScreen
        plan={route.plan} historical onOpenMeal={() => {}}
        onBack={() => { setRoute({ name: 'home' }); setHistoryVisible(true); }}
      />
    );
  } else if (route.name === 'weekly') {
    routeContent = (
      <NutritionWeeklySummaryScreen
        summary={weeklySummary}
        weight={weeklyWeight}
        loading={!weeklyLoaded || plansLoading}
        weightLoading={assessmentsLoading}
        error={weeklyError}
        canGoNext={nextNutritionWeek(selectedWeekStart) <= currentWeekStart}
        onBack={() => setRoute({ name: 'home' })}
        onPreviousWeek={() => setRoute({ name: 'weekly', weekStartLocalDate: previousNutritionWeek(selectedWeekStart) })}
        onNextWeek={() => setRoute({ name: 'weekly', weekStartLocalDate: nextNutritionWeek(selectedWeekStart) })}
        onRetry={() => {
          setWeeklyRetryKey((key) => key + 1);
          if (assessmentsError) void refreshAssessments();
        }}
        onOpenProgress={() => {
          setRoute({ name: 'home' });
          onOpenProgress?.();
        }}
      />
    );
  }

  const currentMeal = plan?.meals.find((meal) => meal.slot === mealDetailsSlot) ?? null;

  // Both overlays below render as plain absolutely-positioned views (no
  // `<Modal>` of their own) inside MealDetailsScreen's single `overlay`
  // slot — see the comment on that prop for why stacking independent
  // native Modals here caused the "frozen screen, sheet reopens on tab
  // switch" bug.
  const mealDetailsAndModals = plan ? (
    <MealDetailsScreen
      meal={currentMeal}
      registeringOptionId={registeringOptionId}
      favoritingOptionId={favoritingOptionId}
      favoritedOptionIds={favoritedOptionIds}
      registerError={registerError}
      favoriteError={favoriteError}
      onClose={() => setMealDetailsSlot(null)}
      onRegister={handleRegisterOption}
      onFavorite={(option) => { if (mealDetailsSlot) handleFavoriteOption(option, mealDetailsSlot, 'plan', plan.planId); }}
      onSwap={() => setFeedbackVisible(true)}
      overlay={(
        <>
          <MealFeedbackSheet
            visible={feedbackVisible}
            currentOption={currentMeal ? currentMeal.options.find((option) => option.id === currentMeal.recommendedOptionId) ?? null : null}
            onClose={() => setFeedbackVisible(false)}
            onSubmit={(feedback) => { setFeedbackVisible(false); handleRequestAlternative(feedback); }}
          />
          <MealAlternativeResultScreen
            visible={alternativeVisible}
            state={alternativeState}
            registeringOptionId={registeringOptionId}
            favoritingOptionId={favoritingOptionId}
            favoritedOptionIds={favoritedOptionIds}
            onClose={() => { setAlternativeVisible(false); setAlternativeState(null); }}
            onRetry={() => handleRequestAlternative(lastFeedback ?? undefined)}
            onRegister={(option) => {
              if (!mealDetailsSlot) return;
              openRegisterMealForOption(mealDetailsSlot, option);
            }}
            onFavorite={(option) => {
              if (!mealDetailsSlot) return;
              handleFavoriteOption(option, mealDetailsSlot, 'alternative', alternativeIdRef.current ?? '');
            }}
          />
        </>
      )}
    />
  ) : null;

  if (route.name === 'plan' && plan) {
    routeContent = (
      <NutritionPlanScreen plan={plan} onOpenMeal={setMealDetailsSlot} onBack={() => setRoute({ name: 'home' })} />
    );
  }

  const homeState: NutritionHomeState = requestError
    ? { kind: 'requestError', copyKey: requestError, onRetry: () => { void handleRequestGeneration(); }, onBack: () => setRequestError(null) }
    : !profile
      ? { kind: 'noProfile', onCreateProfile: () => setRoute({ name: 'profile', mode: 'create' }) }
      : !plan
        ? (!planLoaded
          ? { kind: 'loading' }
          : {
            kind: 'noPlan', safetyBlocked,
            onCreatePlan: generationEnabled ? () => { void handleRequestGeneration(); } : () => {},
            onEditProfile: () => setRoute({ name: 'profile', mode: 'edit' }),
          })
        : {
          kind: 'plan', plan, todayDiary,
          weeklySummary, weeklyWeight, weeklyLoading: !weeklyLoaded || plansLoading || assessmentsLoading,
          onOpenMeal: setMealDetailsSlot, onOpenFullPlan: () => setRoute({ name: 'plan' }),
          onOpenDiarySlot: (slot) => openDiary(slot), onOpenDiary: () => openDiary(), onOpenHistory: openHistory,
          onOpenFavorites: openFavoriteItems, onOpenMealFavorites: openMealFavorites,
          onOpenWeekly: () => setRoute({ name: 'weekly', weekStartLocalDate: currentWeekStart }),
          onRegisterMeal: () => setRegisteringMealVisible(true),
        };

  // Falls through here for `route.name === 'home'` and for `'plan'`
  // without a loaded `plan` yet (same as the pre-refactor behavior,
  // which rendered the home screen in both cases).
  if (routeContent === undefined) {
    routeContent = (
      <NutritionHomeScreen
        state={homeState}
        onCreateCustomFood={() => setCreatingCustomFood(true)}
        onCreateRecipe={() => setCreatingRecipe(true)}
      />
    );
  }

  return (
    <>
      {routeContent}
      {mealDetailsAndModals}
      <Modal
        visible={creatingCustomFood}
        animationType="slide"
        onRequestClose={() => setCreatingCustomFood(false)}
        presentationStyle="pageSheet"
      >
        <CreateCustomFoodScreen visible onClose={() => setCreatingCustomFood(false)} onCreated={() => setCreatingCustomFood(false)} />
      </Modal>
      <CreateRecipeScreen
        visible={creatingRecipe}
        onClose={() => setCreatingRecipe(false)}
        onCreated={() => setCreatingRecipe(false)}
        favoriteFoodIds={favoriteFoodIds}
        recentFoodIds={recentFoodIds}
        onToggleFavoriteFood={handleToggleFavoriteFood}
      />

      <NutritionDiaryScreen
        visible={diaryVisible}
        localDate={diaryDate}
        day={diaryDay}
        dayLoaded={diaryLoaded}
        goals={plan ? {
          kcal: plan.engineSnapshot.output.energy.targetKcal, proteinG: plan.engineSnapshot.output.macros.proteinG,
          carbsG: plan.engineSnapshot.output.macros.carbsG, fatG: plan.engineSnapshot.output.macros.fatG,
          fiberG: plan.engineSnapshot.output.macros.fiberG,
        } : null}
        mealSlots={profile?.mealSlots ?? []}
        onClose={() => setDiaryVisible(false)}
        onPrevDay={() => setDiaryDate((date) => shiftLocalDate(date, -1))}
        onNextDay={() => setDiaryDate((date) => (isFutureLocalDate(shiftLocalDate(date, 1)) ? date : shiftLocalDate(date, 1)))}
        onAddFood={(slot) => { setDiaryFoodTarget(slot); }}
        onEditGrams={(slot, item, grams) => {
          if (!uid) return;
          void updateDiaryEntryGrams(uid, diaryDate, slot, item.id, item.source, item.foodId, grams);
        }}
        onRemove={(slot, itemId) => { if (uid) void removeDiaryEntry(uid, diaryDate, slot, itemId); }}
        onMove={(slot, itemId, toSlot) => { if (uid) void moveDiaryEntry(uid, diaryDate, slot, toSlot, itemId); }}
      />
      <FoodSearchScreen
        visible={diaryFoodTarget != null}
        variant="nutrition"
        includeRecipes
        catalog="logging"
        favoriteFoodIds={favoriteFoodIds}
        recentFoodIds={recentFoodIds}
        favoriteRecipeIds={favoriteRecipeIds}
        onToggleFavoriteFood={handleToggleFavoriteFood}
        onToggleFavoriteRecipe={handleToggleFavoriteRecipe}
        onClose={() => setDiaryFoodTarget(null)}
        onSelect={(food) => {
          if (food.origin === 'recipe') {
            // Round brief §9 — a recipe can be logged by grams OR, when it
            // has `servings`, by portion; `RecipeQuantityModal` resolves
            // the actual gram amount before the normal addDiaryFood below
            // ever runs. `diaryFoodTarget` stays set (not cleared here) so
            // the slot survives until the quantity is confirmed.
            setRecipeQuantityPick(food);
            if (uid) void loadNutritionRecipe(uid, food.foodId).then(setRecipeQuantityRecipe);
            return;
          }
          // Fase C8 — same deferred-write pattern as the recipe branch
          // above: `FoodQuantityModal` resolves the food's natural unit
          // (ovo -> "1 unidade (50 g)") or a plain editable grams amount
          // BEFORE `addDiaryFood` runs, instead of writing 100 g
          // immediately on selection. `diaryFoodTarget` stays set until
          // the quantity is confirmed, same as the recipe branch.
          setFoodQuantityPick(food);
        }}
        overlay={(
          <>
            <RecipeQuantityModal
              visible={recipeQuantityPick != null}
              recipeName={recipeQuantityPick?.name ?? ''}
              recipe={recipeQuantityRecipe}
              onClose={() => { setRecipeQuantityPick(null); setRecipeQuantityRecipe(null); setDiaryFoodTarget(null); }}
              onConfirm={(grams) => {
                if (uid && diaryFoodTarget && recipeQuantityPick) {
                  void addDiaryFood(uid, diaryDate, diaryFoodTarget, 'recipe', recipeQuantityPick.foodId, grams)
                    .then(() => trackNutritionEvent({ name: 'nutrition_diary_item_added', properties: {
                      mealSlot: diaryFoodTarget, operation: 'recipe',
                    } }));
                }
                setRecipeQuantityPick(null); setRecipeQuantityRecipe(null); setDiaryFoodTarget(null);
              }}
            />
            <FoodQuantityModal
              visible={foodQuantityPick != null}
              pick={foodQuantityPick}
              onClose={() => { setFoodQuantityPick(null); setDiaryFoodTarget(null); }}
              onConfirm={(grams) => {
                if (uid && diaryFoodTarget && foodQuantityPick) {
                  const source = foodPickOriginToDiarySource(foodQuantityPick.origin as 'catalog' | 'custom' | 'food_log');
                  void addDiaryFood(uid, diaryDate, diaryFoodTarget, source, foodQuantityPick.foodId, grams)
                    .then(() => trackNutritionEvent({ name: 'nutrition_diary_item_added', properties: {
                      mealSlot: diaryFoodTarget, operation: source,
                    } }));
                }
                setFoodQuantityPick(null); setDiaryFoodTarget(null);
              }}
            />
          </>
        )}
      />

      <RegisterMealScreen
        visible={registeringMealVisible}
        day={todayDiary}
        initialSlot={registeringMealSlot}
        referenceItems={registeringMealReference}
        mealSlots={profile?.mealSlots ?? []}
        onClose={() => { setRegisteringMealVisible(false); setRegisteringMealSlot(null); setRegisteringMealReference(null); }}
        onAddFood={handleRegisterMealAdd}
        onEditGrams={handleRegisterMealEditGrams}
        onRemove={handleRegisterMealRemove}
        favoriteFoodIds={favoriteFoodIds}
        recentFoodIds={recentFoodIds}
        onToggleFavoriteFood={handleToggleFavoriteFood}
      />

      <NutritionPlanHistoryScreen
        visible={historyVisible}
        plans={plans}
        loading={plansLoading}
        restoringId={restoringPlanId}
        onClose={() => setHistoryVisible(false)}
        onOpen={(selected) => { setHistoryVisible(false); setRoute({ name: 'historicalPlan', plan: selected }); }}
        onRestore={(planId) => {
          setRestoringPlanId(planId);
          restoreNutritionPlan(planId)
            .then(() => {
              setReloadKey((key) => key + 1);
              setHistoryVisible(false);
              trackNutritionEvent({ name: 'nutrition_plan_restored', properties: { source: 'history' } });
            })
            .finally(() => setRestoringPlanId(null));
        }}
      />
      <NutritionFoodFavoritesScreen
        visible={favoriteItemsVisible}
        favoriteFoodIds={favoriteFoodIds}
        favoriteRecipeIds={favoriteRecipeIds}
        onClose={() => setFavoriteItemsVisible(false)}
        onToggleFavoriteFood={handleToggleFavoriteFood}
        onToggleFavoriteRecipe={handleToggleFavoriteRecipe}
      />
      <NutritionFavoritesScreen
        visible={mealFavoritesVisible}
        favorites={preferences?.favoriteMealOptions ?? []}
        loading={preferencesLoading}
        removingId={removingFavoriteId}
        usingId={usingFavoriteId}
        onClose={() => setMealFavoritesVisible(false)}
        onRemove={(favoriteId) => {
          if (!uid) return;
          setRemovingFavoriteId(favoriteId);
          removeFavoriteMealOption(uid, favoriteId)
            .then(() => setPreferences((prev) => (prev ? { ...prev, favoriteMealOptions: (prev.favoriteMealOptions ?? []).filter((item) => item.id !== favoriteId) } : prev)))
            .finally(() => setRemovingFavoriteId(null));
        }}
        onUse={(favorite) => {
          setMealFavoritesVisible(false);
          openRegisterMealForOption(favorite.slot, { id: favorite.id, foods: favorite.foods, totals: favorite.totals });
        }}
      />
    </>
  );
}
