import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { NU, NuButton, NuCap } from './NuKit';
import { foodNames, recommendedOption } from '../../nutrition/ui/planView';
import { displayLineHeight } from '../../theme/tokens';
import type { NutritionMeal } from '../../types/nutrition';

/**
 * `NextMealCard` (highlighted) and `MealCard` (list row) share this one
 * component with a `variant` prop — both show the same recommended-option
 * projection (`components.md` §3/§4), never real consumption (no Diary yet).
 */
export function MealCard({
  meal, variant = 'list', onPress,
}: {
  meal: NutritionMeal;
  variant?: 'next' | 'list';
  onPress: () => void;
}) {
  const { t } = useTranslation('nutrition');
  const option = recommendedOption(meal);
  const slotLabel = t(`mealSlots.${meal.slot}`);

  if (variant === 'next') {
    const cols: [string, number, string][] = [
      [t('units.kcal'), Math.round(option.totals.kcal), ''],
      [t('home.summary.protein'), Math.round(option.totals.proteinG), 'g'],
      [t('home.summary.carbs'), Math.round(option.totals.carbsG), 'g'],
      [t('home.summary.fat'), Math.round(option.totals.fatG), 'g'],
    ];
    return (
      <View style={{ marginTop: 36, paddingTop: 24, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: NU.hairline }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <NuCap>{t('home.nextMeal.title')}</NuCap>
          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint }}>{slotLabel}</Text>
        </View>
        {/* The design shows a composed "dish name" here (e.g. "Panqueca de
            banana com whey") — `NutritionMealOption` has no such field, only
            `foods[]`/`totals` (diet-quality-v3: free-form AI items, never a
            named dish). Showing the food list as the headline instead,
            exactly what this card showed before the redesign (the slot name
            already sits in the row above). */}
        <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white, marginTop: 12, lineHeight: 24 }} numberOfLines={2}>
          {foodNames(meal)}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 20, paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: NU.hairline }}>
          {cols.map(([label, value, unit], i) => (
            <View key={label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: NU.hairline }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 20, lineHeight: displayLineHeight(20), color: NU.white, textTransform: 'uppercase' }}>{value}</Text>
                {unit ? <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint }}>{unit}</Text> : null}
              </View>
              <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 11.5, color: NU.faint, marginTop: 5 }}>{label}</Text>
            </View>
          ))}
        </View>
        <NuButton icon="plus" onPress={onPress} style={{ marginTop: 20 }}>{t('home.nextMeal.openCta')}</NuButton>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={slotLabel}
      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, color: NU.white }}>{slotLabel}</Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, marginTop: 3 }} numberOfLines={1}>
          {foodNames(meal)}
        </Text>
      </View>
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: NU.strong }}>
        {Math.round(option.totals.kcal)} {t('units.kcal')}
      </Text>
      <Icon name="chevron-right" size={15} color={NU.faintest} />
    </Pressable>
  );
}
