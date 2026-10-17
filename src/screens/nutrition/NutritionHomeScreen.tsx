import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ProfileAvatar } from '../../components/ui/ProfileAvatar';
import { useAuth } from '../../state/AuthContext';
import { useIsScreenActive } from '../../state/ScreenActivity';
import { DailyNutritionSummary } from '../../components/nutrition/MacroProgress';
import { MealCard } from '../../components/nutrition/MealCard';
import { EmptyNutritionState, NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { WeeklySummaryCard } from '../../components/nutrition/WeeklySummaryCard';
import { NU, NuCap, NuRing } from '../../components/nutrition/NuKit';
import { nextPlanMeal } from '../../nutrition/ui/planView';
import { diaryFollowedCount, diarySlotSummary } from '../../nutrition/ui/diaryModel';
import { isFutureLocalDate, todayLocalDate } from '../../nutrition/ui/localDate';
import { isGenerationRequestErrorRetryable, type GenerationRequestErrorKey } from '../../nutrition/ui/generationStage';
import { NUTRITION_MEAL_SLOTS, type NutritionMealSlot, type NutritionTotals } from '../../types/nutrition';
import type { NutritionPlanDoc } from '../../services/nutritionPlans';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';
import { displayLineHeight } from '../../theme/tokens';
import type { NutritionWeeklySummary, NutritionWeeklyWeightSummary } from '../../nutrition/weekly';

export type NutritionHomeRequestErrorKey = GenerationRequestErrorKey;

export type NutritionHomeState =
  | { kind: 'disabled' }
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'requestError'; copyKey: NutritionHomeRequestErrorKey; onRetry: () => void; onBack: () => void }
  | { kind: 'noProfile'; onCreateProfile: () => void }
  | { kind: 'noPlan'; onCreatePlan: () => void; onEditProfile: () => void }
  | { kind: 'generating'; onOpenGenerating: () => void }
  | {
    kind: 'plan'; plan: NutritionPlanDoc; todayDiary: NutritionDailyLogDoc | null;
    weeklySummary: NutritionWeeklySummary | null; weeklyWeight: NutritionWeeklyWeightSummary | null; weeklyLoading: boolean;
    onOpenMeal: (slot: NutritionMealSlot) => void; onOpenFullPlan: () => void; onOpenDiarySlot: (slot: NutritionMealSlot) => void;
    onOpenDiary: () => void; onOpenHistory: () => void; onOpenFavorites: () => void; onOpenMealFavorites: () => void;
    onOpenWeekly: () => void;
    onRegisterMeal: () => void;
  };

/**
 * `08_frontend/screens.md` §1 — hierarchy is kcal/macros -> next meal ->
 * today's meals -> weekly summary. Every number
 * shown comes from the active plan's own persisted snapshot/totals — the
 * Diary doesn't exist yet, so this never fabricates real consumption.
 */
export function NutritionHomeScreen({
  state, onCreateCustomFood, onCreateRecipe,
}: {
  state: NutritionHomeState;
  onCreateCustomFood: () => void;
  onCreateRecipe: () => void;
}) {
  const { t, i18n } = useTranslation('nutrition');
  const { t: tHome } = useTranslation('home');
  // Same avatar as Home's header (`src/screens/HomeScreen.tsx`) — real
  // photo/initials, never a fixed placeholder.
  const { user, profile } = useAuth();
  const displayName = profile?.profile.name || user?.displayName || '';

  if (state.kind === 'disabled') {
    return (
      <Centered>
        <EmptyNutritionState icon="apple" title={t('home.disabled.title')} body={t('home.disabled.body')} />
      </Centered>
    );
  }

  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ padding: 22, gap: 12 }}>
            <SkeletonBlock height={28} style={{ width: '50%' }} />
            <SkeletonBlock height={120} />
            <SkeletonBlock height={90} />
            <SkeletonBlock height={70} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <Centered>
        <NutritionErrorState title={t('home.errorState.title')} retryLabel={t('home.errorState.cta')} onRetry={state.onRetry} />
      </Centered>
    );
  }

  if (state.kind === 'requestError') {
    const retryable = isGenerationRequestErrorRetryable(state.copyKey);
    return (
      <Centered>
        <NutritionErrorState
          title={t(`generating.${state.copyKey}.title`)}
          body={t(`generating.${state.copyKey}.body`)}
          retryLabel={retryable ? t('generating.failed.retry') : undefined}
          onRetry={retryable ? state.onRetry : undefined}
          backLabel={t('generating.failed.back')}
          onBack={state.onBack}
        />
      </Centered>
    );
  }

  if (state.kind === 'noProfile') {
    return (
      <Centered>
        <EmptyNutritionState
          icon="apple" title={t('home.noProfile.title')} body={t('home.noProfile.body')}
          ctaLabel={t('home.noProfile.cta')} onPress={state.onCreateProfile}
        />
      </Centered>
    );
  }

  if (state.kind === 'noPlan') {
    return (
      <Centered>
        <EmptyNutritionState
          icon="apple" title={t('home.noPlan.title')} body={t('home.noPlan.body')}
          ctaLabel={t('home.noPlan.cta')}
          onPress={state.onCreatePlan}
        />
        <Pressable onPress={state.onEditProfile} accessibilityRole="button" style={{ marginTop: 16 }}>
          <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: NU.secondary }}>{t('home.noPlan.editProfile')}</Text>
        </Pressable>
      </Centered>
    );
  }

  if (state.kind === 'generating') {
    return (
      <Centered>
        <EmptyNutritionState
          icon="sparkles" title={t('home.generating.title')} body={t('home.generating.body')}
          ctaLabel={t('home.generating.cta')} onPress={state.onOpenGenerating}
        />
      </Centered>
    );
  }

  const { plan, todayDiary } = state;
  const goals: NutritionTotals = {
    kcal: plan.engineSnapshot.output.energy.targetKcal,
    proteinG: plan.engineSnapshot.output.macros.proteinG,
    carbsG: plan.engineSnapshot.output.macros.carbsG,
    fatG: plan.engineSnapshot.output.macros.fatG,
    fiberG: plan.engineSnapshot.output.macros.fiberG,
  };
  // The summary bar is real consumption vs. goal (round brief §5/§22) — never
  // the plan's own totals, which are only a recommendation.
  const consumed: NutritionTotals = todayDiary?.totals ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  const next = nextPlanMeal(plan);
  const today = todayLocalDate();
  // Same "{weekday} · {day} {month}" template Home's own header uses
  // (`home:meta.todayLine`) — standardized across Home/Treino/Dieta instead
  // of each screen formatting the date with its own raw `Intl` call.
  const eyebrowLocale = i18n.resolvedLanguage ?? i18n.language;
  const eyebrowDate = new Date(`${today}T12:00:00Z`);
  const eyebrow = tHome('meta.todayLine', {
    weekday: new Intl.DateTimeFormat(eyebrowLocale, { weekday: 'short', timeZone: 'UTC' }).format(eyebrowDate),
    day: new Intl.DateTimeFormat(eyebrowLocale, { day: '2-digit', timeZone: 'UTC' }).format(eyebrowDate),
    month: new Intl.DateTimeFormat(eyebrowLocale, { month: 'short', timeZone: 'UTC' }).format(eyebrowDate),
  }).toUpperCase();
  const followed = diaryFollowedCount(todayDiary);
  const loggedMealCount = plan.meals.filter((meal) => diarySlotSummary(todayDiary, meal.slot) != null).length;

  return (
    <View style={{ flex: 1, backgroundColor: NU.bg }}>
      {/*
        `edges={['top']}` only — this screen's content area is a flex
        SIBLING of AppShell's tab bar (same column, tab bar sized by its own
        content, this view sized by `flex:1` to exactly what's left above
        it), not rendered behind it. A `'bottom'` edge here would reserve
        the device's home-indicator inset a second time — it's already
        spent once inside the tab bar's own `SafeAreaView edges={['bottom']}`
        — which is what was pushing this screen's content away from the tab
        bar with dead empty space. Mirrors the already-correct
        `src/screens/HomeScreen.tsx` (the real Home tab), which only ever
        used `edges={['top']}` here.
      */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          // 96, not an arbitrary "clear the tab bar" guess — the ScrollView
          // is already correctly bounded by `flex: 1` above, so this is
          // purely clearance for the floating "+" button (56px tall, sits
          // 20px off the bottom, +20px breathing room) so it never overlaps
          // the last scrolled item.
          contentContainerStyle={{ paddingBottom: 96 }}
          showsVerticalScrollIndicator={false}
        >
          {/* §3.1 — header. Same geometry as Home's/Treino's (22px gutter,
              50px total top offset, 12px bottom gap) so every tab's
              header/ticker block lines up at an identical height. */}
          <View style={{ paddingHorizontal: 22, paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 2, color: NU.legend, textTransform: 'uppercase' }}>
                {eyebrow}
              </Text>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 34, lineHeight: displayLineHeight(34), color: NU.white, marginTop: 8, textTransform: 'uppercase', transform: [{ skewX: '-8deg' }] }}>
                {t('home.title')}.
              </Text>
            </View>
            <ProfileAvatar
              displayName={displayName}
              photoURL={profile?.profile.photoURL}
              photoVersion={profile?.profile.photoVersion}
              size={46}
            />
          </View>

          {/* §3.2 — scrolling ticker. Same wrapper margins as Home's/Treino's. */}
          <View style={{ marginTop: 4, marginBottom: 18 }}>
            <NutritionTicker
              goalKcal={goals.kcal}
              consumedKcal={consumed.kcal}
              protein={consumed.proteinG}
              proteinGoal={goals.proteinG}
              loggedMeals={loggedMealCount}
              totalMeals={plan.meals.length}
              followed={followed.followed}
              followedOf={followed.logged}
              weeklySummary={state.weeklySummary}
            />
          </View>

          {/* §3.3/§3.4 — hero kcal ring + 4 macro rings. */}
          <View style={{ paddingHorizontal: 22, paddingBottom: next ? 0 : 20 }}>
            <DailyNutritionSummary totals={consumed} goals={goals} />
          </View>

          {next ? <MealCard variant="next" meal={next} onPress={() => state.onOpenMeal(next.slot)} /> : null}

          {/* §3.6 — today's meals. */}
          <View style={{ marginTop: 40, paddingHorizontal: 22 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 2 }}>
              <NuCap>{t('home.mealsToday.title')}</NuCap>
              <Pressable onPress={state.onOpenDiary} accessibilityRole="button" accessibilityLabel={t('home.mealsToday.openDiaryCta')} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: NU.secondary }}>{t('home.mealsToday.openDiaryCta')}</Text>
                <Icon name="chevron-right" size={12} color={NU.secondary} />
              </Pressable>
            </View>
            {[...plan.meals].sort((a, b) => NUTRITION_MEAL_SLOTS.indexOf(a.slot) - NUTRITION_MEAL_SLOTS.indexOf(b.slot)).map((meal, index) => {
              const summary = diarySlotSummary(todayDiary, meal.slot);
              const isNext = !summary && next?.slot === meal.slot;
              const secondaryLabel = summary
                ? t('home.mealsToday.itemCount', { count: summary.itemCount })
                : isNext ? t('home.mealsToday.nextMeal') : t('home.mealsToday.empty');
              return (
                <Pressable
                  key={meal.slot}
                  onPress={() => state.onOpenDiarySlot(meal.slot)}
                  accessibilityRole="button"
                  accessibilityLabel={t(`mealSlots.${meal.slot}`)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, paddingVertical: 12, borderTopWidth: index ? 1 : 0, borderTopColor: NU.hairline }}
                >
                  <View
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      width: 22, height: 22, borderRadius: 11, flexShrink: 0,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: summary ? NU.blue : 'transparent',
                      borderWidth: summary ? 0 : 1.5, borderColor: isNext ? NU.blueHi : NU.faint,
                    }}
                  >
                    {summary ? <Icon name="check" size={14} color={NU.white} stroke={2.2} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, lineHeight: 20, color: NU.white }}>
                      {t(`mealSlots.${meal.slot}`)}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                      {isNext ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: NU.blueHi, flexShrink: 0 }} /> : null}
                      <Text style={{ flexShrink: 1, fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 17, color: isNext ? NU.blueHi : NU.faint }}>
                        {secondaryLabel}
                      </Text>
                    </View>
                  </View>
                  <View style={{ minWidth: 40, alignItems: 'flex-end', flexShrink: 0 }}>
                    <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 17, lineHeight: displayLineHeight(17), color: summary ? NU.white : NU.faint }}>
                      {summary ? Math.round(summary.kcal) : '—'}
                    </Text>
                    <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 11, lineHeight: 16, color: NU.faint }}>
                      {t('units.kcal')}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={15} color={NU.faintest} />
                </Pressable>
              );
            })}
            <Pressable
              onPress={state.onOpenFullPlan}
              accessibilityRole="button"
              accessibilityLabel={t('home.mealsToday.openPlanCta')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingVertical: 14, borderTopWidth: 1, borderTopColor: NU.hairline }}
            >
              <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12.5, color: NU.secondary }}>{t('home.mealsToday.openPlanCta')}</Text>
              <Icon name="chevron-right" size={12} color={NU.secondary} />
            </Pressable>
          </View>

          {/* §3.7 — week ring row. */}
          <NutritionWeekRow summary={state.weeklySummary} loading={state.weeklyLoading} today={today} onOpenWeekly={state.onOpenWeekly} />

          <View style={{ marginHorizontal: 22, marginTop: 24 }}>
            <WeeklySummaryCard
              summary={state.weeklySummary}
              weight={state.weeklyWeight}
              loading={state.weeklyLoading}
              onPress={state.onOpenWeekly}
            />
          </View>

          {/* §3.8 — shortcuts. */}
          <View style={{ marginTop: 24, paddingHorizontal: 22 }}>
            <NuCap style={{ marginBottom: 10 }}>{t('home.quickAccess.title')}</NuCap>
            <View style={{ gap: 8 }}>
              <QuickAccessRow icon="plus" label={t('home.quickAccess.customFood')} description={t('home.quickAccess.customFoodDescription')} onPress={onCreateCustomFood} />
              <QuickAccessRow icon="utensils" label={t('home.quickAccess.recipe')} description={t('home.quickAccess.recipeDescription')} onPress={onCreateRecipe} />
              <QuickAccessRow icon="heart" label={t('home.quickAccess.favorites')} description={t('home.quickAccess.favoritesDescription')} onPress={state.onOpenFavorites} />
              <QuickAccessRow icon="star" label={t('home.quickAccess.savedMeals')} description={t('home.quickAccess.savedMealsDescription')} onPress={state.onOpenMealFavorites} />
              <QuickAccessRow icon="file-text" label={t('home.quickAccess.history')} description={t('home.quickAccess.historyDescription')} onPress={state.onOpenHistory} />
            </View>
          </View>
        </ScrollView>

        {/* §3.9 — floating "+" button. Fixed, not inside the ScrollView
            above, so it stays put while the page scrolls — positioned within
            the SafeAreaView's own bottom inset, so it never overlaps the tab
            bar rendered by the navigator outside this screen. */}
        <Pressable
          onPress={state.onRegisterMeal}
          accessibilityRole="button"
          accessibilityLabel={t('registerMeal.fab')}
          style={{ position: 'absolute', bottom: 20, right: 20 }}
        >
          <LinearGradient
            colors={[NU.blueHi, NU.blue]}
            style={{
              width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
              shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 22, elevation: 10,
            }}
          >
            <Icon name="plus" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

// Exactly the shape of `src/components/evolution/EvolutionTicker.tsx` (used
// by Treino) — same border/gap/duration/colors, so every tab's scrolling
// info strip reads as one consistent surface. Not a shared import: that
// component takes an `EvolutionViewModel`, not Nutrition's data, and rule 9
// says build Nutrição's own version rather than reshape a shared one.
const TICKER_GUTTER = 22;
const TICKER_ITEM_GAP = 36;
const TICKER_LOOP_DURATION_MS = 18000;
const TICKER_BORDER = 'rgba(255,255,255,0.06)';
const TICKER_LABEL_COLOR = 'rgba(255,255,255,0.32)';

interface TickerItem { label: string; value: string }

/** §3.2 — infinite horizontal marquee. Two copies of the same content sit side by side inside one `Animated.View`; once it has slid left by exactly one copy's width (measured via `onLayout`, since RN has no CSS `%`-of-content translate), the loop resets to 0 — the second copy is already sitting where the first started, so the reset is invisible. Any item without real data is simply omitted (rule: never fabricate a number). */
function NutritionTicker({
  goalKcal, consumedKcal, protein, proteinGoal, loggedMeals, totalMeals, followed, followedOf, weeklySummary,
}: {
  goalKcal: number; consumedKcal: number; protein: number; proteinGoal: number;
  loggedMeals: number; totalMeals: number; followed: number; followedOf: number;
  weeklySummary: NutritionWeeklySummary | null;
}) {
  const { t } = useTranslation('nutrition');
  const items = useMemo<TickerItem[]>(() => {
    const parts: TickerItem[] = [
      { label: t('home.ticker.goal'), value: `${Math.round(goalKcal)} ${t('units.kcal')}` },
      { label: t('home.ticker.consumed'), value: `${Math.round(consumedKcal)} ${t('units.kcal')}` },
      { label: t('home.summary.protein'), value: `${Math.round(protein)}/${Math.round(proteinGoal)}${t('units.gramsShort')}` },
      { label: t('home.ticker.meals'), value: `${loggedMeals}/${totalMeals}` },
    ];
    if (followedOf > 0) parts.push({ label: t('home.ticker.followedPlan'), value: `${followed}/${followedOf}` });
    if (weeklySummary) {
      parts.push({ label: t('home.week.title'), value: `${weeklySummary.recordedDays}/7 ${t('weekly.days')}` });
      if (weeklySummary.averageConsumed) {
        parts.push({ label: t('weekly.average'), value: `${Math.round(weeklySummary.averageConsumed.kcal)} ${t('units.kcal')}` });
      }
    }
    return parts;
  }, [goalKcal, consumedKcal, protein, proteinGoal, loggedMeals, totalMeals, followed, followedOf, weeklySummary, t]);

  const translateX = useRef(new Animated.Value(0)).current;
  const [cycleWidth, setCycleWidth] = useState(0);
  // Nutrição stays mounted (not unmounted) while another tab is active, same
  // as Home — without this guard the native-driven loop below would keep
  // running forever on an invisible screen (see `EvolutionTicker.tsx`).
  const isActive = useIsScreenActive();

  useEffect(() => {
    if (!cycleWidth || !isActive) return;
    translateX.setValue(0);
    const loop = Animated.loop(
      Animated.timing(translateX, {
        toValue: -(cycleWidth + TICKER_ITEM_GAP),
        duration: TICKER_LOOP_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [cycleWidth, isActive, translateX]);

  const renderItems = (keyPrefix: string, measure: boolean) => (
    <View
      style={{ flexDirection: 'row', gap: TICKER_ITEM_GAP, paddingRight: TICKER_ITEM_GAP }}
      onLayout={measure ? (e) => setCycleWidth(e.nativeEvent.layout.width) : undefined}
    >
      {items.map(({ label, value }, index) => (
        <Text key={`${keyPrefix}-${index}`} style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 2, color: TICKER_LABEL_COLOR }}>
          {label.toUpperCase()}{' '}
          <Text style={{ color: NU.blueHi, fontFamily: 'JetBrainsMono_700Bold' }}>{value.toUpperCase()}</Text>
        </Text>
      ))}
    </View>
  );

  return (
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: TICKER_BORDER, paddingVertical: 8, overflow: 'hidden' }}>
      <Animated.View style={{ flexDirection: 'row', paddingLeft: TICKER_GUTTER, transform: [{ translateX }] }}>
        {renderItems('a', true)}
        {renderItems('b', false)}
      </Animated.View>
    </View>
  );
}

/** §3.7 — 7 small rings, one per day of the active week. Reuses the same `NutritionWeeklyDay` shape and `hasLog`/future-date rules already established by `NutritionWeeklySummaryScreen`'s own day chart — no new data, just a different visual (rings instead of bars). */
function NutritionWeekRow({
  summary, loading, today, onOpenWeekly,
}: {
  summary: NutritionWeeklySummary | null;
  loading: boolean;
  today: string;
  onOpenWeekly: () => void;
}) {
  const { t } = useTranslation('nutrition');
  const weekdayLabels = t('weekly.weekdays', { returnObjects: true }) as unknown as string[];
  if (loading) {
    return (
      <View style={{ marginTop: 40, paddingHorizontal: 22 }}>
        <NuCap style={{ marginBottom: 10 }}>{t('home.week.title')}</NuCap>
        <SkeletonBlock height={64} />
      </View>
    );
  }
  if (!summary) return null;
  const goal = summary.averageTarget?.kcal ?? summary.days.find((day) => day.target)?.target?.kcal ?? 0;
  return (
    <View style={{ marginTop: 40, paddingHorizontal: 22 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <NuCap>{t('home.week.title')}</NuCap>
        <Pressable onPress={onOpenWeekly} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: NU.secondary }}>{t('home.week.summaryCta')}</Text>
          <Icon name="chevron-right" size={12} color={NU.secondary} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {summary.days.map((day, index) => {
          const isToday = day.localDate === today;
          const future = isFutureLocalDate(day.localDate);
          const pct = goal > 0 && day.totals ? (day.totals.kcal / goal) * 100 : 0;
          return (
            <View key={day.localDate} style={{ alignItems: 'center', gap: 8 }}>
              <NuRing size={36} stroke={3.5} pct={pct} color={isToday ? NU.blueHi : NU.strong} dashed={!day.hasLog && !future} faint={future}>
                <View />
              </NuRing>
              <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 8.5, letterSpacing: 0.8, color: isToday ? NU.white : NU.faint }}>
                {weekdayLabels?.[index] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function QuickAccessRow({ icon, label, description, onPress }: { icon: IconName; label: string; description: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      style={({ pressed }) => ({
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16,
        backgroundColor: pressed ? NU.surfaceSubtleStrong : NU.surfaceSubtle,
        borderWidth: 1, borderColor: NU.hairline,
        flexDirection: 'row', alignItems: 'center', gap: 16,
      })}
    >
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 22, alignItems: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={22} color={NU.secondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 16, lineHeight: 22, color: NU.white }}>{label}</Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, lineHeight: 18, color: NU.secondary, marginTop: 3 }}>{description}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={NU.secondary} />
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: NU.bg }}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }} edges={['top']}>
        {children}
      </SafeAreaView>
    </View>
  );
}
