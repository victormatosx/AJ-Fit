import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NU, NuButton, NuCap, NuIconButton } from './NuKit';
import { Pill } from './NutritionPrimitives';
import { planItemKcal } from '../../nutrition/ui/planView';
import type { NutritionMealOption } from '../../types/nutrition';

/**
 * One meal option's card — shared by `MealDetailsScreen` (a plan's options)
 * and the meal-alternative result view, since both show the exact same
 * shape (`components.md` — "MealOptionCard"). Register/favorite/swap are
 * no-ops unless a handler is passed, so a read-only (historical plan)
 * context can reuse this with zero behavior changes.
 */
export function MealOptionCard({
  option, recommended, onRegister, registering, onFavorite, favoriting, favorited, onSwap, showRecommendedBadge = true, showSummaryBox = true,
}: {
  option: NutritionMealOption;
  recommended: boolean;
  onRegister?: () => void;
  registering?: boolean;
  onFavorite?: () => void;
  favoriting?: boolean;
  favorited?: boolean;
  /**
   * Square "swap meal" icon button rendered next to Register instead of the
   * favorite star. Only passed by `MealDetailsScreen` (one swap action per
   * meal, never per-option) — `MealAlternativeResultScreen` never passes
   * this and keeps the star unchanged.
   */
  onSwap?: () => void;
  /**
   * `MealDetailsScreen` no longer shows the "Recomendada" badge (it still
   * passes `recommended` for the register button's gradient-vs-ghost
   * styling). `MealAlternativeResultScreen` never sets this, so its badge
   * is unaffected.
   */
  showRecommendedBadge?: boolean;
  /**
   * `MealDetailsScreen` no longer shows the kcal/macros/food-count summary
   * box — it duplicates the totals already shown at the top of that screen.
   * `MealAlternativeResultScreen` has no such top summary, so it still
   * needs this box and never sets this prop.
   */
  showSummaryBox?: boolean;
}) {
  const { t } = useTranslation('nutrition');
  const gramsShort = t('units.gramsShort');
  return (
    <View>
      {/* No "dish name" exists on `NutritionMealOption` (diet-quality-v3:
          free-form AI items, never a named recipe) — the recommended badge
          plus totals carry the heading instead, as this card did before. */}
      {showSummaryBox ? (
        <View
          style={{
            borderRadius: 16, borderWidth: 1, padding: 16,
            borderColor: recommended ? 'rgba(11,112,249,0.35)' : NU.hairline,
            backgroundColor: recommended ? 'rgba(11,112,249,0.08)' : NU.surfaceSubtle,
          }}
        >
          {recommended && showRecommendedBadge ? (
            <View style={{ marginBottom: 8, alignSelf: 'flex-start' }}>
              <Pill tone="accent" label={t('mealDetails.recommendedBadge')} />
            </View>
          ) : null}
          <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, color: NU.white }}>
            {Math.round(option.totals.kcal)} {t('units.kcal')} · P {Math.round(option.totals.proteinG)}{gramsShort} ·
            {' '}C {Math.round(option.totals.carbsG)}{gramsShort} · G {Math.round(option.totals.fatG)}{gramsShort}
          </Text>
          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, marginTop: 4 }}>
            {t('mealDetails.foodCount', { count: option.foods.length })}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: showSummaryBox ? 20 : 0 }}>
        <NuCap style={{ marginBottom: 10 }}>{t('mealDetails.foods')}</NuCap>
        {option.foods.map((item, index) => (
          <FoodItemRow key={`${item.name}-${index}`} name={item.catalogBinding?.brandName ? `${item.name} (${item.catalogBinding.brandName})` : item.name} quantity={item.quantity} unit={item.unit} kcal={planItemKcal(item)} marginTop={index ? 8 : 0} />
        ))}
      </View>

      {(onRegister || onFavorite || onSwap) ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {onRegister ? (
            <View style={{ flex: 1 }}>
              <NuButton ghost={!recommended} onPress={onRegister} disabled={registering}>
                {registering ? <ActivityIndicator size="small" color={recommended ? '#fff' : NU.white} /> : t('mealDetails.register')}
              </NuButton>
            </View>
          ) : null}
          {onSwap ? (
            <NuIconButton icon="swap" accessibilityLabel={t('mealDetails.swap')} onPress={onSwap} />
          ) : onFavorite ? (
            <NuIconButton
              icon="star"
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

/** One food-item row — name/quantity on the left, kcal right-aligned, in its own discreet card. */
function FoodItemRow({
  name, quantity, unit, kcal, marginTop,
}: {
  name: string;
  quantity: number;
  unit: string;
  kcal: number | null;
  marginTop: number;
}) {
  const { t } = useTranslation('nutrition');
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14,
        backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline,
        marginTop,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, color: NU.white }} numberOfLines={1}>{name}</Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, marginTop: 3 }}>
          {quantity} {unit}
        </Text>
      </View>
      {kcal != null ? (
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: NU.strong, flexShrink: 0 }}>
          {Math.round(kcal)} {t('units.kcal')}
        </Text>
      ) : null}
    </View>
  );
}
