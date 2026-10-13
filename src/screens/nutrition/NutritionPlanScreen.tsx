import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { DailyNutritionSummary } from '../../components/nutrition/MacroProgress';
import { MealCard } from '../../components/nutrition/MealCard';
import { useTheme } from '../../theme';
import type { NutritionMealSlot } from '../../types/nutrition';
import type { NutritionPlanDoc } from '../../services/nutritionPlans';

export function NutritionPlanScreen({
  plan, onOpenMeal, onBack, historical,
}: {
  plan: NutritionPlanDoc; onOpenMeal: (slot: NutritionMealSlot) => void; onBack: () => void; historical?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const goals = {
    kcal: plan.engineSnapshot.output.energy.targetKcal,
    proteinG: plan.engineSnapshot.output.macros.proteinG,
    carbsG: plan.engineSnapshot.output.macros.carbsG,
    fatG: plan.engineSnapshot.output.macros.fatG,
    fiberG: plan.engineSnapshot.output.macros.fiberG,
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 8, gap: 12 }}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('plan.back')} hitSlop={10} style={{ padding: 4 }}>
            <Icon name="arrow-left" size={20} color={theme.colors.textPrimary} />
          </Pressable>
          <Display size={22} style={{ flex: 1 }}>{t('plan.title')}</Display>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {historical ? (
            <View style={{ marginHorizontal: 22, marginTop: 10, padding: 12, borderRadius: theme.radii.lg,
              backgroundColor: theme.colors.feedbackInfoBackground, borderWidth: 1, borderColor: theme.colors.feedbackInfoBorder }}>
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12.5, color: theme.colors.textSecondary }}>
                {t('history.readOnlyBanner')}
              </Text>
            </View>
          ) : null}

          <View style={{ paddingHorizontal: 22, marginTop: 16, marginBottom: 20 }}>
            <MonoLabel color={theme.colors.textFaint} style={{ marginBottom: 10 }}>{t('plan.dailyGoal')}</MonoLabel>
            <DailyNutritionSummary totals={plan.dailyTotals} goals={goals} />
          </View>

          <MonoLabel color={theme.colors.textFaint} style={{ marginHorizontal: 22, marginBottom: 10 }}>
            {t('home.mealsToday.title')}
          </MonoLabel>
          {plan.meals.map((meal) => (
            <MealCard key={meal.slot} meal={meal} onPress={() => onOpenMeal(meal.slot)} />
          ))}

          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint, textAlign: 'center', marginTop: 16, paddingHorizontal: 32 }}>
            {t('plan.disclaimer')}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
