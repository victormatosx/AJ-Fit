import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { MealOptionCard } from '../../components/nutrition/MealOptionCard';
import { useTheme } from '../../theme';
import type { NutritionMeal, NutritionMealOption } from '../../types/nutrition';

export function MealDetailsScreen({
  meal, readOnly, registeringOptionId, favoritedOptionIds = [], favoritingOptionId, registerError, favoriteError,
  onClose, onRegister, onFavorite, onSwap, overlay,
}: {
  meal: NutritionMeal | null;
  readOnly?: boolean;
  registeringOptionId?: string | null;
  favoritedOptionIds?: readonly string[];
  favoritingOptionId?: string | null;
  registerError?: string | null;
  favoriteError?: string | null;
  onClose: () => void;
  onRegister?: (option: NutritionMealOption) => void;
  onFavorite?: (option: NutritionMealOption) => void;
  onSwap?: () => void;
  /**
   * The swap feedback sheet and the alternative-result screen render here,
   * as plain absolutely-positioned overlays inside this single `Modal`,
   * instead of each owning its own `<Modal>`. Two independent native
   * `<Modal>`s stacked on top of each other (this screen's `pageSheet`
   * plus a second one presented over it) is unreliable: dismissing the
   * inner one can leave this screen's own presentation/touch-responder
   * chain corrupted — it looks "frozen" to the next tap — and a later,
   * unrelated re-render (e.g. switching tabs) can flush that stale native
   * state and pop the "already closed" inner modal back open on its own.
   */
  overlay?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Local confirmation text belongs to one open session of this screen —
  // without this, closing (meal -> null) and reopening the same or a
  // different slot showed the PREVIOUS session's leftover "Registrado..."
  // / "Adicionado aos favoritos." text immediately, because this
  // component never unmounts (it's a permanent sibling in NutritionShell)
  // so `confirmation` survived across opens.
  useEffect(() => {
    setConfirmation(null);
  }, [meal?.slot]);

  return (
    <Modal visible={meal != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{meal ? t(`mealSlots.${meal.slot}`) : t('mealDetails.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={onClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>

          {meal ? (
            <ScrollView contentContainerStyle={{ padding: 22, gap: 20 }}>
              {!readOnly && onSwap ? (
                <Pressable
                  onPress={onSwap} accessibilityRole="button" accessibilityLabel={t('mealDetails.swap')}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    paddingVertical: 12, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.cardBorder }}
                >
                  <Icon name="swap" size={15} color={theme.colors.primaryEmphasis} />
                  <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.primaryEmphasis }}>
                    {t('mealDetails.swap')}
                  </Text>
                </Pressable>
              ) : null}

              <MonoLabel color={theme.colors.textFaint}>{t('mealDetails.options')}</MonoLabel>
              {meal.options.map((option) => (
                <MealOptionCard
                  key={option.id}
                  option={option}
                  recommended={option.id === meal.recommendedOptionId}
                  onRegister={readOnly || !onRegister ? undefined : () => {
                    onRegister(option);
                    setConfirmation(t('mealDetails.registered'));
                  }}
                  registering={registeringOptionId === option.id}
                  onFavorite={readOnly || !onFavorite ? undefined : () => {
                    onFavorite(option);
                    setConfirmation(t('mealDetails.favorited'));
                  }}
                  favoriting={favoritingOptionId === option.id}
                  favorited={favoritedOptionIds.includes(option.id)}
                />
              ))}

              {confirmation ? (
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.statusSuccessText, textAlign: 'center' }}>
                  {confirmation}
                </Text>
              ) : null}
              {registerError ? (
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.formErrorText, textAlign: 'center' }}>
                  {registerError}
                </Text>
              ) : null}
              {favoriteError ? (
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.formErrorText, textAlign: 'center' }}>
                  {favoriteError}
                </Text>
              ) : null}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </ScreenBg>
      {overlay}
    </Modal>
  );
}

/** Thin loading placeholder reused while a meal alternative is being generated. */
export function MealAlternativeLoading() {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 14 }}>
      <ActivityIndicator color={theme.colors.primaryEmphasis} />
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13.5, color: theme.colors.textMuted }}>{t('alternative.loading')}</Text>
    </View>
  );
}
