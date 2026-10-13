import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Pill } from './NutritionPrimitives';
import { FoodRow } from './FoodRow';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
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
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  return (
    <View
      style={{
        borderRadius: theme.radii.xl, borderWidth: 1,
        borderColor: recommended ? theme.colors.primaryBorder : theme.colors.cardBorder,
        backgroundColor: recommended ? theme.colors.primarySurfaceSubtle : theme.colors.surface,
        padding: 14, gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        {recommended ? <Pill tone="accent" label={t('mealDetails.recommendedBadge')} /> : <View />}
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.textFaint }}>
          {Math.round(option.totals.kcal)} {t('units.kcal')}
        </Text>
      </View>
      {option.foods.map((item, index) => (
        <FoodRow
          key={`${item.name}-${index}`}
          name={`${item.name} — ${item.quantity} ${item.unit}`}
          raw
          kcal={planItemKcal(item)}
        />
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 9, letterSpacing: 1, color: theme.colors.textFaint }}>
          {t('mealDetails.totals')}
        </Text>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12.5, color: theme.colors.textSecondary }}>
          {Math.round(option.totals.kcal)} {t('units.kcal')} · P {Math.round(option.totals.proteinG)}{t('units.gramsShort')} ·
          {' '}C {Math.round(option.totals.carbsG)}{t('units.gramsShort')} · G {Math.round(option.totals.fatG)}{t('units.gramsShort')}
        </Text>
      </View>
      {(onRegister || onFavorite) ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          {onFavorite ? (
            <Pressable
              onPress={onFavorite} disabled={favoriting || favorited} accessibilityRole="button"
              accessibilityLabel={t('mealDetails.favorite')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12,
                borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.cardBorder }}
            >
              {favoriting ? <ActivityIndicator size="small" color={theme.colors.textFaint} /> : (
                <Icon name="star" size={14} color={favorited ? theme.colors.primaryEmphasis : theme.colors.textFaint} />
              )}
            </Pressable>
          ) : null}
          {onRegister ? (
            <Pressable
              onPress={onRegister} disabled={registering} accessibilityRole="button"
              accessibilityLabel={t('mealDetails.register')}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
                borderRadius: theme.radii.md, backgroundColor: theme.colors.primaryEmphasis, opacity: registering ? 0.6 : 1 }}
            >
              {registering ? <ActivityIndicator size="small" color={theme.colors.primaryForeground} /> : (
                <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13, color: theme.colors.primaryForeground }}>
                  {t('mealDetails.register')}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
