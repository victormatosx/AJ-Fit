import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon, type IconName } from '../../components/ui/Icon';
import { DailyNutritionSummary } from '../../components/nutrition/MacroProgress';
import { MealCard } from '../../components/nutrition/MealCard';
import { EmptyNutritionState, NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { WeeklySummaryCard } from '../../components/nutrition/WeeklySummaryCard';
import { useTheme } from '../../theme';
import { nextPlanMeal } from '../../nutrition/ui/planView';
import { diarySlotSummary } from '../../nutrition/ui/diaryModel';
import { isGenerationRequestErrorRetryable, type GenerationRequestErrorKey } from '../../nutrition/ui/generationStage';
import type { NutritionMealSlot, NutritionTotals } from '../../types/nutrition';
import type { NutritionPlanDoc } from '../../services/nutritionPlans';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';
import type { NutritionWeeklySummary, NutritionWeeklyWeightSummary } from '../../nutrition/weekly';

export type NutritionHomeRequestErrorKey = GenerationRequestErrorKey;

export type NutritionHomeState =
  | { kind: 'disabled' }
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'requestError'; copyKey: NutritionHomeRequestErrorKey; onRetry: () => void; onBack: () => void }
  | { kind: 'noProfile'; onCreateProfile: () => void }
  | { kind: 'noPlan'; safetyBlocked: boolean; onCreatePlan: () => void; onEditProfile: () => void }
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
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');

  if (state.kind === 'disabled') {
    return (
      <Centered>
        <EmptyNutritionState icon="apple" title={t('home.disabled.title')} body={t('home.disabled.body')} />
      </Centered>
    );
  }

  if (state.kind === 'loading') {
    return (
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ padding: 22, gap: 12 }}>
            <SkeletonBlock height={28} style={{ width: '50%' }} />
            <SkeletonBlock height={120} />
            <SkeletonBlock height={90} />
            <SkeletonBlock height={70} />
          </View>
        </SafeAreaView>
      </ScreenBg>
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
        {state.safetyBlocked ? (
          <View style={{
            padding: 16, borderRadius: theme.radii.lg, backgroundColor: theme.colors.feedbackCriticalBackground,
            borderWidth: 1, borderColor: theme.colors.feedbackCriticalBorder, marginBottom: 18, width: '100%',
          }}>
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.feedbackCriticalText }}>
              {t('home.pregnancyBlock.title')}
            </Text>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.feedbackCriticalText, marginTop: 6, lineHeight: 19 }}>
              {t('home.pregnancyBlock.body')}
            </Text>
          </View>
        ) : null}
        <EmptyNutritionState
          icon="apple" title={t('home.noPlan.title')} body={t('home.noPlan.body')}
          ctaLabel={state.safetyBlocked ? undefined : t('home.noPlan.cta')}
          onPress={state.safetyBlocked ? undefined : state.onCreatePlan}
        />
        <CtaButton ghost onPress={state.onEditProfile} style={{ width: '100%', marginTop: -4 }}>
          {t('home.noPlan.editProfile')}
        </CtaButton>
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

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={24}>{t('home.title')}</Display>
            <CtaButton ghost onPress={state.onOpenFullPlan} style={{ width: 'auto', height: 36, paddingHorizontal: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12.5, color: theme.colors.primaryEmphasis }}>
                  {t('plan.title')}
                </Text>
                <Icon name="chevron-right" size={13} color={theme.colors.primaryEmphasis} />
              </View>
            </CtaButton>
          </View>

          <View style={{ paddingHorizontal: 22, marginTop: 16, marginBottom: 20 }}>
            <DailyNutritionSummary totals={consumed} goals={goals} />
          </View>

          {next ? (
            <View style={{ marginBottom: 20 }}>
              <MealCard variant="next" meal={next} onPress={() => state.onOpenMeal(next.slot)} />
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 22, marginBottom: 10 }}>
            <MonoLabel color={theme.colors.textFaint}>{t('home.mealsToday.title')}</MonoLabel>
            <Pressable onPress={state.onOpenDiary} accessibilityRole="button" accessibilityLabel={t('home.mealsToday.openDiaryCta')}>
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12, color: theme.colors.primaryEmphasis }}>
                {t('home.mealsToday.openDiaryCta')}
              </Text>
            </Pressable>
          </View>
          {plan.meals.map((meal) => {
            const summary = diarySlotSummary(todayDiary, meal.slot);
            return (
              <Pressable
                key={meal.slot}
                onPress={() => state.onOpenDiarySlot(meal.slot)}
                accessibilityRole="button"
                accessibilityLabel={t(`mealSlots.${meal.slot}`)}
                style={{
                  marginHorizontal: 22, marginBottom: 10, padding: 14, borderRadius: theme.radii.lg,
                  backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14.5, color: theme.colors.textPrimary }}>
                    {t(`mealSlots.${meal.slot}`)}
                  </Text>
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted, marginTop: 2 }}>
                    {summary ? `${Math.round(summary.kcal)} ${t('units.kcal')} · ${t('home.mealsToday.itemCount', { count: summary.itemCount })}`
                      : t('home.mealsToday.empty')}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
              </Pressable>
            );
          })}

          <View style={{ marginHorizontal: 22, marginTop: 12, marginBottom: 20 }}>
            <WeeklySummaryCard
              summary={state.weeklySummary}
              weight={state.weeklyWeight}
              loading={state.weeklyLoading}
              onPress={state.onOpenWeekly}
            />
          </View>

          <MonoLabel color={theme.colors.textFaint} style={{ marginHorizontal: 22, marginTop: 10, marginBottom: 10 }}>
            {t('home.quickAccess.title')}
          </MonoLabel>
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 22 }}>
            <QuickAccessButton icon="plus" label={t('home.quickAccess.customFood')} onPress={onCreateCustomFood} />
            <QuickAccessButton icon="plus" label={t('home.quickAccess.recipe')} onPress={onCreateRecipe} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 22, marginTop: 10 }}>
            <QuickAccessButton icon="heart" label={t('home.quickAccess.favorites')} onPress={state.onOpenFavorites} />
            <QuickAccessButton icon="star" label={t('home.quickAccess.savedMeals')} onPress={state.onOpenMealFavorites} />
          </View>
          <View style={{ marginHorizontal: 22, marginTop: 10 }}>
            <QuickAccessButton icon="file-text" label={t('home.quickAccess.history')} onPress={state.onOpenHistory} />
          </View>
        </ScrollView>

        {/* Fixed, not inside the ScrollView above, so it stays put while the
            page scrolls — positioned within the SafeAreaView's own bottom
            inset, so it never overlaps the tab bar rendered by the
            navigator outside this screen. */}
        <Pressable
          onPress={state.onRegisterMeal}
          accessibilityRole="button"
          accessibilityLabel={t('registerMeal.fab')}
          style={{
            position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center',
            ...theme.shadows.accent,
          }}
        >
          <Icon name="plus" size={24} color={theme.colors.primaryForeground} />
        </Pressable>
      </SafeAreaView>
    </ScreenBg>
  );
}

function QuickAccessButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <CtaButton ghost onPress={onPress} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        <Icon name={icon} size={14} color={theme.colors.primaryEmphasis} />
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.primaryEmphasis }}>{label}</Text>
      </View>
    </CtaButton>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }} edges={['top', 'bottom']}>
        {children}
      </SafeAreaView>
    </ScreenBg>
  );
}
