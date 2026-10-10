import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CtaButton } from '../../components/ui/CtaButton';
import { useTheme } from '../../theme';
import { recipePortionToGrams } from '../../nutrition/catalog/math';
import { isPositiveGrams } from '../../nutrition/ui/diaryModel';
import type { NutritionRecipe } from '../../types/nutrition';

/**
 * Round brief §9: logging a recipe to the diary by GRAMS or, when the
 * recipe has `servings`, by PORTION instead — `recipePortionToGrams`
 * converts a portion count to grams (honoring `finalWeightG` when
 * present), then the caller logs that resolved gram amount through the
 * SAME `addDiaryFood` every other diary entry already uses.
 */
export function RecipeQuantityModal({
  visible, recipeName, recipe, onClose, onConfirm,
}: {
  visible: boolean;
  recipeName: string;
  /** `null` while the recipe doc is still loading, or for a recipe with no `servings` at all. */
  recipe: Pick<NutritionRecipe, 'ingredients' | 'finalWeightG' | 'servings'> | null;
  onClose: () => void;
  onConfirm: (grams: number) => void;
}) {
  const { theme } = useTheme();
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
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.loadingOverlay, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View style={{ width: '100%', borderRadius: theme.radii.xl, backgroundColor: theme.colors.sheetBackground,
          borderWidth: 1, borderColor: theme.colors.border, padding: 22, gap: 16 }}>
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.textPrimary }}>{recipeName}</Text>

          {hasServings ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => { setMode('grams'); setText('100'); }}
                accessibilityRole="button" accessibilityLabel={t('recipe.quantityByGrams')}
                style={{ flex: 1, paddingVertical: 10, borderRadius: theme.radii.control, alignItems: 'center',
                  backgroundColor: mode === 'grams' ? theme.colors.choiceSelectedBackground : theme.colors.choiceBackground }}
              >
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>{t('recipe.quantityByGrams')}</Text>
              </Pressable>
              <Pressable
                onPress={() => { setMode('portions'); setText('1'); }}
                accessibilityRole="button" accessibilityLabel={t('recipe.quantityByPortion')}
                style={{ flex: 1, paddingVertical: 10, borderRadius: theme.radii.control, alignItems: 'center',
                  backgroundColor: mode === 'portions' ? theme.colors.choiceSelectedBackground : theme.colors.choiceBackground }}
              >
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>{t('recipe.quantityByPortion')}</Text>
              </Pressable>
            </View>
          ) : null}

          <TextInput
            value={text} onChangeText={setText} keyboardType="decimal-pad" autoFocus
            style={{ height: 48, borderRadius: theme.radii.lg, paddingHorizontal: 14, backgroundColor: theme.colors.inputBackground,
              borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 16, color: theme.colors.inputText }}
          />
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted }}>
            {mode === 'grams' ? t('recipe.gramsHint') : t('recipe.portionsHint')}
          </Text>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <CtaButton ghost onPress={onClose} style={{ flex: 1 }}>{t('diary.cancel')}</CtaButton>
            <CtaButton onPress={() => { if (valid && grams != null) onConfirm(grams); }} disabled={!valid} style={{ flex: 1 }}>
              {t('diary.save')}
            </CtaButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}
