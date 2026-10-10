import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { SelectableChip, SelectableRow } from '../../components/nutrition/NutritionPrimitives';
import { useTheme } from '../../theme';
import { NUTRITION_MEAL_FEEDBACK_REASONS, type NutritionMealFeedbackReason, type NutritionMealOption } from '../../types/nutrition';

export interface MealSwapFeedback { reason: NutritionMealFeedbackReason; dislikedFoodIds?: string[] }

/**
 * Structured reasons only (round brief §13) — never free text. The
 * disliked-foods sub-step only appears for `dislike_foods`, and only
 * flags foods for review; it never excludes anything by itself (round
 * brief §14 — "quero variar" must never read as "odeio esses alimentos").
 */
export function MealFeedbackSheet({
  visible, currentOption, onClose, onSubmit,
}: {
  visible: boolean;
  currentOption: NutritionMealOption | null;
  onClose: () => void;
  onSubmit: (feedback: MealSwapFeedback) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const [reason, setReason] = useState<NutritionMealFeedbackReason | null>(null);
  const [dislikedFoodIds, setDislikedFoodIds] = useState<string[]>([]);

  const reset = () => { setReason(null); setDislikedFoodIds([]); };
  const toggleDisliked = (foodId: string) => setDislikedFoodIds((prev) =>
    (prev.includes(foodId) ? prev.filter((id) => id !== foodId) : [...prev, foodId]));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { reset(); onClose(); }} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={18}>{t('feedback.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('feedback.cancel')} onPress={() => { reset(); onClose(); }} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 22, gap: 16 }}>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13.5, color: theme.colors.textMuted }}>{t('feedback.subtitle')}</Text>
            <View style={{ gap: 10 }}>
              {NUTRITION_MEAL_FEEDBACK_REASONS.map((option) => (
                <SelectableRow key={option} label={t(`feedback.reasons.${option}`)}
                  selected={reason === option} onPress={() => setReason(option)} />
              ))}
            </View>

            {reason === 'dislike_foods' && currentOption ? (
              <View style={{ gap: 10 }}>
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textSecondary }}>
                  {t('feedback.dislikedFoodsPrompt')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {currentOption.foods.map((food) => (
                    <SelectableChip key={food.name} label={food.name}
                      selected={dislikedFoodIds.includes(food.name)} onPress={() => toggleDisliked(food.name)} />
                  ))}
                </View>
              </View>
            ) : null}

            <CtaButton
              onPress={() => {
                if (!reason) return;
                onSubmit({ reason, ...(dislikedFoodIds.length > 0 ? { dislikedFoodIds } : {}) });
                reset();
              }}
              disabled={!reason}
              style={{ marginTop: 8 }}
            >
              {t('feedback.confirm')}
            </CtaButton>
          </ScrollView>
        </SafeAreaView>
      </ScreenBg>
    </Modal>
  );
}
