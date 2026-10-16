import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { NU, NuButton, NuCap } from './NuKit';
import { foodNames, recommendedOption } from '../../nutrition/ui/planView';
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
    const gramsShort = t('units.gramsShort');
    const cols: [string, string][] = [
      [`${Math.round(option.totals.kcal)}`, t('units.kcal')],
      [`${Math.round(option.totals.proteinG)}${gramsShort}`, t('home.summary.protein')],
      [`${Math.round(option.totals.carbsG)}${gramsShort}`, t('home.summary.carbs')],
      [`${Math.round(option.totals.fatG)}${gramsShort}`, t('home.summary.fat')],
    ];
    return (
      <View style={{ marginTop: 24, marginHorizontal: 22, padding: 18, borderRadius: 20, backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <NuCap>{t('home.nextMeal.title')}</NuCap>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: NU.surfaceSubtleStrong, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', flexShrink: 1, maxWidth: '55%' }}>
            <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: NU.secondary }} numberOfLines={1}>{slotLabel}</Text>
            <Icon name="chevron-right" size={11} color={NU.faint} />
          </View>
        </View>
        {/* The design shows a composed "dish name" here (e.g. "Panqueca de
            banana com whey") — `NutritionMealOption` has no such field, only
            `foods[]`/`totals` (diet-quality-v3: free-form AI items, never a
            named dish). Showing the food list as the headline instead,
            exactly what this card showed before the redesign (the slot name
            already sits in the chip above). */}
        <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 19, color: NU.white, marginTop: 14, lineHeight: 25 }} numberOfLines={3}>
          {foodNames(meal)}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: NU.hairline }}>
          {cols.map(([value, label], i) => (
            <React.Fragment key={label}>
              {i > 0 ? <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: NU.hairline }} /> : null}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 16, color: NU.white }}>{value}</Text>
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 10.5, color: NU.faint, marginTop: 3 }} numberOfLines={1}>{label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
        <NuButton ghost icon="plus" onPress={onPress} style={{ marginTop: 18, width: '100%' }} accessibilityLabel={t('home.nextMeal.openCta')}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, color: NU.white }}>{t('home.nextMeal.openCta')}</Text>
            <Icon name="chevron-right" size={14} color={NU.faint} />
          </View>
        </NuButton>
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
