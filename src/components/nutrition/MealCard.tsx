import React, { useState } from 'react';
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
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const option = recommendedOption(meal);
  const expansionKey = `${meal.slot}:${option.id}`;
  const expanded = expandedOptionId === expansionKey;
  const slotLabel = t(`mealSlots.${meal.slot}`);

  if (variant === 'next') {
    const visibleFoods = expanded ? option.foods : option.foods.slice(0, 2);
    const gramsShort = t('units.gramsShort');
    const cols: [string, string][] = [
      [`${Math.round(option.totals.kcal)}`, t('units.kcal')],
      [`${Math.round(option.totals.proteinG)}${gramsShort}`, t('home.summary.protein')],
      [`${Math.round(option.totals.carbsG)}${gramsShort}`, t('home.summary.carbs')],
      [`${Math.round(option.totals.fatG)}${gramsShort}`, t('home.summary.fat')],
    ];
    return (
      <View style={{ marginTop: 24, marginHorizontal: 22, padding: 18, borderRadius: 20, backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline }}>
        {option.foods.length > 2 ? (
          <Pressable
            onPress={() => setExpandedOptionId(expanded ? null : expansionKey)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? t('home.nextMeal.collapseFoods') : t('home.nextMeal.showAllFoods', { count: option.foods.length - 2 })}
            accessibilityState={{ expanded }}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20 }}
          />
        ) : null}
        <View pointerEvents="box-none" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View pointerEvents="none"><NuCap>{t('home.nextMeal.title')}</NuCap></View>
          <View onStartShouldSetResponder={() => true} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: NU.surfaceSubtleStrong, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', flexShrink: 1, maxWidth: '55%' }}>
            <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: NU.secondary }} numberOfLines={1}>{slotLabel}</Text>
            <Icon name="chevron-right" size={11} color={NU.faint} />
          </View>
        </View>
        <View pointerEvents="none" style={{ marginTop: 14, gap: 8 }}>
          {visibleFoods.map((food, index) => (
            <View key={`${index}-${food.name}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: NU.secondary, marginTop: 9 }} />
              <Text style={{ flex: 1, minWidth: 0, fontFamily: 'Archivo_600SemiBold', fontSize: 15, lineHeight: 22, color: NU.white }}>
                <Text>{food.name}</Text>
                {!expanded && option.foods.length > 2 && index === visibleFoods.length - 1 ? (
                  <Text style={{ color: NU.secondary }}>{` (+${option.foods.length - 2})`}</Text>
                ) : null}
              </Text>
              {option.foods.length > 2 && index === visibleFoods.length - 1 ? (
                <View style={{ minWidth: 24, minHeight: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
                  <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
                    <Icon name="chevron-down" size={14} color={NU.faint} />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </View>
        <View pointerEvents="none" style={{ flexDirection: 'row', marginTop: option.foods.length > 2 ? 4 : 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: NU.hairline }}>
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
