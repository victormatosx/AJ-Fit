import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MealOptionCard } from '../../components/nutrition/MealOptionCard';
import { NU, NuButton, NuCap, NuSheetHeader } from '../../components/nutrition/NuKit';
import { recommendedOption } from '../../nutrition/ui/planView';
import { displayLineHeight } from '../../theme/tokens';
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

  // `NutritionMealOption` carries no per-slot min/max kcal range (only a
  // single fixed `totals` per option) — "META DA REFEIÇÃO" below shows the
  // recommended option's own kcal as one value instead of a fabricated range.
  const goalKcal = meal ? Math.round(recommendedOption(meal).totals.kcal) : null;

  return (
    <Modal visible={meal != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <NuSheetHeader title={meal ? t(`mealSlots.${meal.slot}`) : t('mealDetails.title')} onBack={onClose} />

          {meal ? (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: 'center', marginTop: 18 }}>
                <NuCap>{t('mealDetails.totals')}</NuCap>
                {goalKcal != null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10 }}>
                    <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 40, lineHeight: displayLineHeight(40), color: NU.white, textTransform: 'uppercase' }}>{goalKcal}</Text>
                    <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: NU.faint }}> {t('units.kcal')}</Text>
                  </View>
                ) : null}
              </View>

              <View style={{ marginTop: 34 }}>
                <NuCap style={{ marginBottom: 10 }}>{t('mealDetails.options')}</NuCap>
                {meal.options.map((option, index) => (
                  <View key={option.id} style={{ marginTop: index ? 28 : 0 }}>
                    <MealOptionCard
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
                  </View>
                ))}
              </View>

              {!readOnly && onSwap ? (
                <NuButton ghost icon="swap" onPress={onSwap} style={{ marginTop: 20 }}>
                  {t('mealDetails.swap')}
                </NuButton>
              ) : null}

              {confirmation ? (
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.blueHi, textAlign: 'center', marginTop: 16 }}>
                  {confirmation}
                </Text>
              ) : null}
              {registerError ? (
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.danger, textAlign: 'center', marginTop: 16 }}>
                  {registerError}
                </Text>
              ) : null}
              {favoriteError ? (
                <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.danger, textAlign: 'center', marginTop: 16 }}>
                  {favoriteError}
                </Text>
              ) : null}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
      {overlay}
    </Modal>
  );
}

/** Thin loading placeholder reused while a meal alternative is being generated. */
export function MealAlternativeLoading() {
  const { t } = useTranslation('nutrition');
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 14 }}>
      <ActivityIndicator color={NU.blueHi} />
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13.5, color: NU.faint }}>{t('alternative.loading')}</Text>
    </View>
  );
}
