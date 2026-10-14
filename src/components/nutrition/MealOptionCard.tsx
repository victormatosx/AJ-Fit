import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FoodRow } from './FoodRow';
import { NU, NuButton, NuIconButton } from './NuKit';
import { Pill } from './NutritionPrimitives';
import { planItemKcal } from '../../nutrition/ui/planView';
import type { NutritionMealOption } from '../../types/nutrition';

/**
 * One meal option's card — shared by `MealDetailsScreen` (a plan's options)
 * and the meal-alternative result view, since both show the exact same
 * shape (`components.md` — "MealOptionCard"). Register/favorite are no-ops
 * unless a handler is passed, so a read-only (historical plan) context can
 * reuse this with zero behavior changes.
 */
export function MealOptionCard({
  option, recommended, onRegister, registering, onFavorite, favoriting, favorited,
}: {
  option: NutritionMealOption;
  recommended: boolean;
  onRegister?: () => void;
  registering?: boolean;
  onFavorite?: () => void;
  favoriting?: boolean;
  favorited?: boolean;
}) {
  const { t } = useTranslation('nutrition');
  return (
    <View>
      {/* No "dish name" exists on `NutritionMealOption` (diet-quality-v3:
          free-form AI items, never a named recipe) — the recommended badge
          plus totals carry the heading instead, as this card did before. */}
      {recommended ? (
        <View style={{ marginBottom: 6 }}>
          <Pill tone="accent" label={t('mealDetails.recommendedBadge')} />
        </View>
      ) : null}
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint }}>
        {Math.round(option.totals.kcal)} {t('units.kcal')} · P {Math.round(option.totals.proteinG)}{t('units.gramsShort')} ·
        {' '}C {Math.round(option.totals.carbsG)}{t('units.gramsShort')} · G {Math.round(option.totals.fatG)}{t('units.gramsShort')}
      </Text>
      <View style={{ marginTop: 14 }}>
        {option.foods.map((item, index) => (
          <View key={`${item.name}-${index}`} style={{ borderTopWidth: 1, borderTopColor: NU.hairline }}>
            <FoodRow
              name={`${item.name} — ${item.quantity} ${item.unit}`}
              raw
              kcal={planItemKcal(item)}
            />
          </View>
        ))}
      </View>
      {(onRegister || onFavorite) ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {onRegister ? (
            <View style={{ flex: 1 }}>
              <NuButton ghost={!recommended} onPress={onRegister} disabled={registering}>
                {registering ? <ActivityIndicator size="small" color={recommended ? '#fff' : NU.white} /> : t('mealDetails.register')}
              </NuButton>
            </View>
          ) : null}
          {onFavorite ? (
            <NuIconButton
              icon={favorited ? 'star' : 'star'}
              active={favorited}
              accessibilityLabel={t('mealDetails.favorite')}
              onPress={onFavorite}
            />
          ) : null}
        </View>
      ) : null}
      {favoriting ? <ActivityIndicator size="small" color={NU.faint} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}
