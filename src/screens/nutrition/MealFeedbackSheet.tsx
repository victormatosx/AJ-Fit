import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NU, NuButton, NuPanel, NuSelectPill } from '../../components/nutrition/NuKit';
import { NUTRITION_MEAL_FEEDBACK_REASONS, type NutritionMealFeedbackReason, type NutritionMealOption } from '../../types/nutrition';

export interface MealSwapFeedback { reason: NutritionMealFeedbackReason; dislikedFoodIds?: string[] }

/**
 * Structured reasons only (round brief §13) — never free text. The
 * disliked-foods sub-step only appears for `dislike_foods`, and only
 * flags foods for review; it never excludes anything by itself (round
 * brief §14 — "quero variar" must never read as "odeio esses alimentos").
 *
 * Renders via `NuPanel` (a plain absolutely-positioned backdrop + sliding
 * sheet, matching spec §4.4's "painel") — the caller (`MealDetailsScreen`)
 * hosts this inside its single `pageSheet` Modal. Stacking a second
 * independent native `<Modal>` on top of that one is unreliable (same
 * class of bug already worked around in `RegisterMealScreen`'s grams
 * step): dismissing the inner Modal can leave the outer one's native
 * presentation/touch-responder chain corrupted — the screen behind looks
 * "frozen", and an unrelated later re-render (e.g. switching tabs) can
 * flush the stale native state and pop the "already closed" sheet back
 * open on its own. `NuPanel` returning `null` while `!visible` (rather
 * than keeping a Modal mounted with `visible={false}`) also fully
 * unmounts `reason`/`dislikedFoodIds` on close, so every reopen starts
 * from clean state with no manual reset.
 *
 * `NutritionPrimitives.tsx`'s `SelectableRow`/`SelectableChip` are also
 * used by the nutrition-profile wizard (`NutritionProfileScreen.tsx`,
 * outside this redesign's scope) — this sheet uses its own local
 * `ReasonRow`/`FoodChip` below instead of restyling those shared ones.
 */
export function MealFeedbackSheet({
  visible, currentOption, onClose, onSubmit,
}: {
  visible: boolean;
  currentOption: NutritionMealOption | null;
  onClose: () => void;
  onSubmit: (feedback: MealSwapFeedback) => void;
}) {
  const { t } = useTranslation('nutrition');
  const [reason, setReason] = useState<NutritionMealFeedbackReason | null>(null);
  const [dislikedFoodIds, setDislikedFoodIds] = useState<string[]>([]);

  const toggleDisliked = (foodId: string) => setDislikedFoodIds((prev) =>
    (prev.includes(foodId) ? prev.filter((id) => id !== foodId) : [...prev, foodId]));

  // Returning null (not just hiding children) fully unmounts this
  // component instance while closed, so `reason`/`dislikedFoodIds` reset
  // on every reopen with no manual cleanup — `NuPanel`'s own internal
  // `visible` check alone isn't enough, since the `useState` calls above
  // it would otherwise keep running (and keep their value) regardless.
  if (!visible) return null;

  return (
    <NuPanel visible={visible} onClose={onClose}>
      <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{t('feedback.title')}</Text>
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint, marginTop: 4 }}>{t('feedback.subtitle')}</Text>

      <View style={{ marginTop: 18 }}>
        {NUTRITION_MEAL_FEEDBACK_REASONS.map((option, index) => (
          <ReasonRow
            key={option}
            label={t(`feedback.reasons.${option}`)}
            selected={reason === option}
            onPress={() => setReason(option)}
            last={index === NUTRITION_MEAL_FEEDBACK_REASONS.length - 1}
          />
        ))}
      </View>

      {reason === 'dislike_foods' && currentOption ? (
        <View style={{ marginTop: 18 }}>
          <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: NU.secondary, marginBottom: 10 }}>
            {t('feedback.dislikedFoodsPrompt')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {currentOption.foods.map((food) => (
              <FoodChip
                key={food.name}
                label={food.name}
                selected={dislikedFoodIds.includes(food.name)}
                onPress={() => toggleDisliked(food.name)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <NuButton
        onPress={() => {
          if (!reason) return;
          onSubmit({ reason, ...(dislikedFoodIds.length > 0 ? { dislikedFoodIds } : {}) });
        }}
        disabled={!reason}
        style={{ marginTop: 22 }}
      >
        {t('feedback.confirm')}
      </NuButton>
      <Pressable onPress={onClose} accessibilityRole="button" style={{ marginTop: 14, alignSelf: 'center' }}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: NU.secondary }}>{t('feedback.cancel')}</Text>
      </Pressable>
    </NuPanel>
  );
}

/** A single radio row — filled 20px circle when selected, matching spec §4.4's reason picker. Local to this sheet (see file-level note on why it doesn't reuse `SelectableRow`). */
function ReasonRow({ label, selected, onPress, last }: { label: string; selected: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderBottomWidth: last ? 0 : 1, borderBottomColor: NU.hairline }}
    >
      <View style={{
        width: 20, height: 20, borderRadius: 10, flexShrink: 0,
        borderWidth: selected ? 6 : 1, borderColor: selected ? NU.white : 'rgba(255,255,255,0.3)',
      }} />
      <Text style={{ fontFamily: selected ? 'Archivo_600SemiBold' : 'Archivo_400Regular', fontSize: 14.5, color: NU.white }}>{label}</Text>
    </Pressable>
  );
}

/** Pill-style multi-select chip for the disliked-foods sub-step — reuses `NuSelectPill`'s visual, used here in a multi-select (checkbox) context rather than its usual single-select one. */
function FoodChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <NuSelectPill on={selected} onPress={onPress}>{label}</NuSelectPill>;
}
