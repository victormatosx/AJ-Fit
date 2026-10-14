import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MealOptionCard } from '../../components/nutrition/MealOptionCard';
import { NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { NU, NuCap, NuSheetHeader } from '../../components/nutrition/NuKit';
import type { NutritionMealOption } from '../../types/nutrition';
import { MealAlternativeLoading } from './MealDetailsScreen';

export type MealAlternativeViewState =
  | { kind: 'loading' }
  | { kind: 'error'; retryable: boolean; copyKey: 'error' | 'cooldown' }
  | { kind: 'result'; options: NutritionMealOption[]; recommendedOptionId: string };

/**
 * Renders as a plain absolutely-positioned overlay, not its own `<Modal>`
 * — see the identical note on `MealFeedbackSheet`. Stacked on top of
 * `MealDetailsScreen`'s single Modal, same as the feedback sheet; the two
 * never show at once in practice (`handleRequestAlternative` flips
 * `feedbackVisible` off in the same tick it turns this on), but both are
 * plain views now, so even if that ever changed it couldn't trigger the
 * native multi-Modal stacking bug.
 */
export function MealAlternativeResultScreen({
  visible, state, registeringOptionId, favoritingOptionId, favoritedOptionIds = [],
  onClose, onRetry, onRegister, onFavorite,
}: {
  visible: boolean;
  state: MealAlternativeViewState | null;
  registeringOptionId?: string | null;
  favoritingOptionId?: string | null;
  favoritedOptionIds?: readonly string[];
  onClose: () => void;
  onRetry: () => void;
  onRegister: (option: NutritionMealOption) => void;
  onFavorite: (option: NutritionMealOption) => void;
}) {
  const { t } = useTranslation('nutrition');

  if (!visible) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50, backgroundColor: NU.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <NuSheetHeader title={t('alternative.title')} onBack={onClose} />

        {state?.kind === 'loading' ? <MealAlternativeLoading /> : null}

        {state?.kind === 'error' ? (
          <View style={{ paddingTop: 20 }}>
            <NutritionErrorState
              title={t(`alternative.${state.copyKey}.title`)}
              body={t(`alternative.${state.copyKey}.body`)}
              retryLabel={state.retryable ? t('alternative.error.retry') : undefined}
              onRetry={state.retryable ? onRetry : undefined}
              backLabel={t('alternative.backToPlan')}
              onBack={onClose}
            />
          </View>
        ) : null}

        {state?.kind === 'result' ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 18, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <NuCap style={{ marginBottom: 10 }}>{t('mealDetails.options')}</NuCap>
            {state.options.map((option, index) => (
              <View key={option.id} style={{ marginTop: index ? 28 : 0 }}>
                <MealOptionCard
                  option={option}
                  recommended={option.id === state.recommendedOptionId}
                  onRegister={() => onRegister(option)}
                  registering={registeringOptionId === option.id}
                  onFavorite={() => onFavorite(option)}
                  favoriting={favoritingOptionId === option.id}
                  favorited={favoritedOptionIds.includes(option.id)}
                />
              </View>
            ))}
            <Text
              onPress={onClose}
              accessibilityRole="button"
              style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13.5, color: NU.secondary, textAlign: 'center', marginTop: 26 }}
            >
              {t('alternative.backToPlan')}
            </Text>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </View>
  );
}
