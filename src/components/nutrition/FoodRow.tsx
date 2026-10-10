import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { Pill } from './NutritionPrimitives';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';

/** Used by FoodSearch, MealDetails and Recipe ingredient rows (`components.md` §7). */
export function FoodRow({
  name: rawName, brandName, grams, kcal, proteinG, per100g, servingLabel, origin, raw, onPress, trailing, favorited, onToggleFavorite,
}: {
  /** Canonical catalog name — formatted for display here only; never mutated for storage/search. */
  name: string;
  /**
   * Skips `formatFoodDisplayName` — for a free-form AI diet-plan item name
   * (diet-quality-v3), never resolved against the catalog. That formatter's
   * TACO/TBCA comma-chain reordering only makes sense for canonical catalog
   * names; applying it to the AI's own natural-language name would be
   * incorrect, not just redundant.
   */
  raw?: boolean;
  brandName?: string | null;
  grams?: number | null;
  kcal?: number | null;
  /** Only ever shown together with `per100g` — a specific logged serving's protein isn't surfaced here today. */
  proteinG?: number | null;
  /**
   * `kcal`/`proteinG` here are per-100g catalog/custom-food values, not a
   * specific serving — appends "por 100 g" so search/listing rows never
   * read as if they were the grams the user is about to log (round brief:
   * "mostrar claramente que os valores exibidos são 'por 100 g'"). Only
   * meaningful when `grams` is absent; a row already showing a concrete
   * `grams` amount is unambiguous without it.
   */
  per100g?: boolean;
  /**
   * Fase C7 ("serving units" UI) — when the caller already resolved a
   * food's default natural unit, `kcal`/`proteinG` are the macros FOR
   * THAT SERVING (not per-100g), and this is the unit's own label (e.g.
   * "1 unidade (50 g)") shown instead of "por 100 g". Takes priority over
   * `per100g` when both are given; a food with no natural unit keeps the
   * existing `per100g` behavior unchanged.
   */
  servingLabel?: string | null;
  origin?: 'catalog' | 'custom' | 'recipe' | 'food_log';
  onPress?: () => void;
  trailing?: React.ReactNode;
  /** Current favorite state — only rendered as a heart toggle when `onToggleFavorite` is also given. */
  favorited?: boolean;
  /** A sibling action to the row button, so tapping it can never trigger `onPress`. */
  onToggleFavorite?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const name = raw ? rawName : formatFoodDisplayName(rawName, brandName ? { name: brandName } : null);
  const heart = onToggleFavorite ? (
    <Pressable
      onPress={onToggleFavorite} accessibilityRole="button" hitSlop={8} style={{ padding: 2 }}
      accessibilityLabel={favorited ? t('favorites.remove') : t('favorites.add')}
      accessibilityState={{ selected: Boolean(favorited) }}
    >
      <Icon name="heart" filled={Boolean(favorited)} size={18} color={favorited ? theme.colors.danger : theme.colors.textFaint} />
    </Pressable>
  ) : null;
  const details = (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }} numberOfLines={1}>
          {name}
        </Text>
        {origin ? (
          <Pill tone={origin === 'catalog' || origin === 'food_log' ? 'default' : 'accent'}
            label={origin === 'custom' ? t('foodSearch.customBadge')
              : origin === 'recipe' ? t('foodSearch.recipeBadge') : t('foodSearch.catalogBadge')} />
        ) : null}
      </View>
      {(brandName || grams != null || kcal != null) ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted, marginTop: 2 }}>
          {[brandName, grams != null ? `${grams}${t('units.gramsShort')}` : null,
            kcal != null ? `${Math.round(kcal)} ${t('units.kcal')}` : null,
            grams == null && proteinG != null ? `${proteinG} ${t('units.gramsShort')} ${t('registerMeal.proteinShort')}` : null,
            grams == null && (servingLabel ?? (per100g ? t('registerMeal.per100g') : null))].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 }}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={name}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.72 : 1, borderRadius: theme.radii.md })}
        >
          {details}
        </Pressable>
      ) : details}
      {(heart || trailing || onPress) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {heart}
          {trailing ?? (onPress ? <Icon name="chevron-right" size={16} color={theme.colors.textFaint} /> : null)}
        </View>
      ) : null}
    </View>
  );
}
