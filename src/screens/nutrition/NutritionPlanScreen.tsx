import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { DailyNutritionSummary } from '../../components/nutrition/MacroProgress';
import { MealCard } from '../../components/nutrition/MealCard';
import { NU, NuCap, NuSheetHeader } from '../../components/nutrition/NuKit';
import type { NutritionMealSlot } from '../../types/nutrition';
import type { NutritionPlanDoc } from '../../services/nutritionPlans';

export function NutritionPlanScreen({
  plan, onOpenMeal, onBack, historical,
}: {
  plan: NutritionPlanDoc; onOpenMeal: (slot: NutritionMealSlot) => void; onBack: () => void; historical?: boolean;
}) {
  const { t } = useTranslation('nutrition');
  const goals = {
    kcal: plan.engineSnapshot.output.energy.targetKcal,
    proteinG: plan.engineSnapshot.output.macros.proteinG,
    carbsG: plan.engineSnapshot.output.macros.carbsG,
    fatG: plan.engineSnapshot.output.macros.fatG,
    fiberG: plan.engineSnapshot.output.macros.fiberG,
  };

  return (
    <View style={{ flex: 1, backgroundColor: NU.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <NuSheetHeader title={historical ? t('history.title') : t('plan.title')} onBack={onBack} />

        {/* 120, not 40 — this screen renders full-bleed behind AppShell's
            floating tab bar (`FULL_BLEED.tab` in AppShell.tsx), same as
            `NutritionHomeScreen`/`NutritionWeeklySummaryScreen`, so content
            has to leave room for it itself or the last section ends up
            hidden behind the nav bar. */}
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {historical ? (
            <View style={{ marginHorizontal: 24, marginTop: 10, padding: 13, borderRadius: 12, backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="lock" size={14} color={NU.faint} />
              <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.secondary, flex: 1 }}>
                {t('history.readOnlyBanner')}
              </Text>
            </View>
          ) : null}

          <View style={{ alignItems: 'center', marginTop: 24 }}>
            <NuCap style={{ marginBottom: 6 }}>{t('plan.dailyGoal')}</NuCap>
          </View>
          <View style={{ paddingHorizontal: 24 }}>
            <DailyNutritionSummary totals={plan.dailyTotals} goals={goals} />
          </View>

          <View style={{ marginTop: 36, paddingHorizontal: 24 }}>
            <NuCap style={{ marginBottom: 2 }}>{t('home.mealsToday.title')}</NuCap>
            {plan.meals.map((meal, index) => (
              <View key={meal.slot} style={index ? { borderTopWidth: 1, borderTopColor: NU.hairline } : undefined}>
                <MealCard meal={meal} onPress={() => onOpenMeal(meal.slot)} />
              </View>
            ))}
          </View>

          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faintest, textAlign: 'center', marginTop: 28, paddingHorizontal: 32, lineHeight: 17 }}>
            {t('plan.disclaimer')}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
