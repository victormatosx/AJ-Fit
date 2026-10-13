import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
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
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const option = recommendedOption(meal);
  const slotLabel = t(`mealSlots.${meal.slot}`);

  if (variant === 'next') {
    return (
      <Card style={{ marginHorizontal: 22, padding: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <MonoLabel color={theme.colors.primaryEmphasis}>{t('home.nextMeal.title')}</MonoLabel>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.5, color: theme.colors.textFaint }}>
            {Math.round(option.totals.kcal)} {t('units.kcal')}
          </Text>
        </View>
        <Text style={{ fontFamily: theme.fonts.display, fontSize: 22, color: theme.colors.textPrimary, marginTop: 8 }}>
          {slotLabel.toUpperCase()}
        </Text>
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13.5, color: theme.colors.textSecondary, marginTop: 4 }} numberOfLines={2}>
          {foodNames(meal)}
        </Text>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t('home.nextMeal.openCta')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}
        >
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13, color: theme.colors.primaryEmphasis }}>
            {t('home.nextMeal.openCta')}
          </Text>
          <Icon name="arrow-right" size={14} color={theme.colors.primaryEmphasis} />
        </Pressable>
      </Card>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={slotLabel}
      style={{
        marginHorizontal: 22,
        marginBottom: 10,
        padding: 14,
        borderRadius: theme.radii.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14.5, color: theme.colors.textPrimary }}>
          {slotLabel}
        </Text>
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted, marginTop: 2 }} numberOfLines={1}>
          {foodNames(meal)}
        </Text>
      </View>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.textFaint }}>
        {Math.round(option.totals.kcal)} {t('units.kcal')}
      </Text>
      <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
    </Pressable>
  );
}
