import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NU, NuButton, NuPanel, NuSelectPill } from '../../components/nutrition/NuKit';
import { recipePortionToGrams } from '../../nutrition/catalog/math';
import { isPositiveGrams } from '../../nutrition/ui/diaryModel';
import type { NutritionRecipe } from '../../types/nutrition';

/**
 * Round brief §9: logging a recipe to the diary by GRAMS or, when the
 * recipe has `servings`, by PORTION instead — `recipePortionToGrams`
 * converts a portion count to grams (honoring `finalWeightG` when
 * present), then the caller logs that resolved gram amount through the
 * SAME `addDiaryFood` every other diary entry already uses.
 *
 * Renders as a plain absolutely-positioned overlay, not its own
 * `<Modal>` — picking a recipe inside `FoodSearchScreen` opens this
 * WHILE `FoodSearchScreen`'s own `pageSheet` Modal is still `visible`
 * (`diaryFoodTarget` intentionally stays set so the slot survives until
 * the quantity is confirmed). Two independent native `<Modal>`s both
 * `visible` at once is unreliable (same class of bug fixed for
 * `MealDetailsScreen` + `MealFeedbackSheet`) — hosted as a plain View
 * inside `FoodSearchScreen`'s `overlay` slot instead, there is nothing
 * left to stack. `NuPanel` (src/components/nutrition/NuKit.tsx) is this
 * redesign's own version of that same plain-View overlay chrome.
 */
export function RecipeQuantityModal({
  visible, recipeName, recipe, onClose, onConfirm, saving = false,
}: {
  visible: boolean;
  saving?: boolean;
  recipeName: string;
  /** `null` while the recipe doc is still loading, or for a recipe with no `servings` at all. */
  recipe: Pick<NutritionRecipe, 'ingredients' | 'finalWeightG' | 'servings'> | null;
  onClose: () => void;
  onConfirm: (grams: number) => void;
}) {
  const { t } = useTranslation('nutrition');
  const hasServings = typeof recipe?.servings === 'number' && recipe.servings > 0;
  const [mode, setMode] = useState<'grams' | 'portions'>('grams');
  const [text, setText] = useState('100');

  useEffect(() => {
    if (visible) { setMode('grams'); setText('100'); }
  }, [visible]);

  const amount = Number(text.replace(',', '.'));
  const grams = mode === 'grams' ? amount : (recipe ? recipePortionToGrams(recipe, amount) : null);
  const valid = grams != null && isPositiveGrams(grams);

  return (
    <NuPanel visible={visible} onClose={onClose} avoidKeyboard>
      <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{recipeName}</Text>

      {hasServings ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
          <NuSelectPill on={mode === 'grams'} onPress={() => { setMode('grams'); setText('100'); }}>
            {t('recipe.quantityByGrams')}
          </NuSelectPill>
          <NuSelectPill on={mode === 'portions'} onPress={() => { setMode('portions'); setText('1'); }}>
            {t('recipe.quantityByPortion')}
          </NuSelectPill>
        </View>
      ) : null}

      <TextInput
        value={text} onChangeText={setText} keyboardType="decimal-pad" autoFocus
        style={{
          marginTop: 20, height: 52, borderRadius: 12, paddingHorizontal: 16,
          backgroundColor: NU.surfaceSubtleStrong, fontFamily: 'Archivo_600SemiBold', fontSize: 16, color: NU.white,
        }}
      />
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, marginTop: 10 }}>
        {mode === 'grams' ? t('recipe.gramsHint') : t('recipe.portionsHint')}
      </Text>

      <NuButton onPress={() => { if (valid && grams != null) onConfirm(grams); }} disabled={!valid || saving} style={{ marginTop: 22 }}>
        {t('diary.save')}
      </NuButton>
    </NuPanel>
  );
}
