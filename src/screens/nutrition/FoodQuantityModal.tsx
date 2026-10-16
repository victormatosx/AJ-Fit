import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NU, NuButton, NuCap, NuPanel, NuSelectPill, NuStepper } from '../../components/nutrition/NuKit';
import { nutrientsForGrams } from '../../nutrition/catalog/math';
import { resolveDefaultServingUnit, servingGrams } from '../../nutrition/catalog/servings';
import { isPositiveGrams } from '../../nutrition/ui/diaryModel';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';
import type { FoodLogServingUnit, NutritionFoodNutritionValues } from '../../types/nutrition';

/** Only the fields this modal needs to resolve a default unit and preview macros — `NutritionFoodPick` already satisfies this shape. */
export interface FoodQuantityPick {
  name: string;
  nutritionPer100g: NutritionFoodNutritionValues;
  servings?: FoodLogServingUnit[];
  defaultServingId?: string | null;
}

/**
 * Quantity-confirmation overlay for a catalog/custom food picked from
 * `FoodSearchScreen`'s "logging" search (the Diário "+" entry point) — the
 * same role `RecipeQuantityModal` already plays for recipes picked from
 * that same screen. Reuses the exact unit-resolution functions
 * (`resolveDefaultServingUnit`/`servingGrams`/`nutrientsForGrams`,
 * `src/nutrition/catalog/{servings,math}.ts`) `RegisterMealScreen`'s own
 * grams step already uses, so a food's natural unit (ovo -> "1 unidade
 * (50 g)", mussarela -> "1 fatia (30 g)") is never dropped between search
 * and the actual diary write — this closes the gap where that write used
 * to happen immediately with a hardcoded 100 g.
 *
 * Renders as a plain `NuPanel` overlay (never a second native `<Modal>`),
 * exactly like `RecipeQuantityModal` — hosted inside `FoodSearchScreen`'s
 * `overlay` slot while its own `pageSheet` Modal stays open.
 */
export function FoodQuantityModal({
  visible, pick, onClose, onConfirm, saving = false,
}: {
  visible: boolean;
  saving?: boolean;
  pick: FoodQuantityPick | null;
  onClose: () => void;
  onConfirm: (grams: number) => void;
}) {
  const { t } = useTranslation('nutrition');
  const servableUnits = (pick?.servings ?? []).filter((unit) => servingGrams(unit) != null);
  const [selectedServingId, setSelectedServingId] = useState<string | null>(null);
  const [gramsText, setGramsText] = useState('100');

  useEffect(() => {
    if (!visible) return;
    const defaultUnit = pick ? resolveDefaultServingUnit(pick.servings, pick.defaultServingId) : null;
    const defaultGrams = defaultUnit ? servingGrams(defaultUnit) : null;
    setSelectedServingId(defaultUnit?.id ?? null);
    setGramsText(defaultGrams != null ? String(defaultGrams) : '100');
  }, [visible, pick]);

  const selectServingUnit = (unit: FoodLogServingUnit | null) => {
    setSelectedServingId(unit?.id ?? null);
    if (unit) { const grams = servingGrams(unit); if (grams != null) setGramsText(String(grams)); }
  };

  const gramsValue = Number(gramsText.replace(',', '.'));
  const gramsValid = isPositiveGrams(gramsValue);
  const preview = pick && gramsValid ? nutrientsForGrams(pick.nutritionPer100g, gramsValue) : null;

  return (
    <NuPanel visible={visible} onClose={onClose} avoidKeyboard>
      {pick ? (
        <View style={{ gap: 18 }}>
          <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white, lineHeight: 23 }}>
            {formatFoodDisplayName(pick.name)}
          </Text>
          {servableUnits.length > 0 ? (
            <View style={{ gap: 10 }}>
              <NuCap>{t('registerMeal.unitLabel')}</NuCap>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <NuSelectPill on={selectedServingId === null} onPress={() => selectServingUnit(null)}>
                  {t('registerMeal.unitGrams')}
                </NuSelectPill>
                {servableUnits.map((unit) => (
                  <NuSelectPill key={unit.id} on={selectedServingId === unit.id} onPress={() => selectServingUnit(unit)}>
                    {unit.label}
                  </NuSelectPill>
                ))}
              </View>
            </View>
          ) : null}
          <NuStepper
            value={`${gramsText} ${t('units.gramsShort')}`}
            sub={preview ? `${Math.round(preview.kcal)} ${t('units.kcal')}` : null}
            onMinus={() => setGramsText(String(Math.max(0, Number(gramsText.replace(',', '.')) - 10)))}
            onPlus={() => setGramsText(String(Number(gramsText.replace(',', '.')) + 10))}
          />
          <TextInput
            value={gramsText} onChangeText={setGramsText} keyboardType="decimal-pad"
            style={{
              height: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: NU.surfaceSubtleStrong,
              fontFamily: 'Archivo_400Regular', fontSize: 16, color: NU.white, textAlign: 'center',
            }}
          />
          {preview ? (
            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, textAlign: 'center' }}>
              {`${Math.round(preview.kcal)} ${t('units.kcal')} · ${preview.proteinG.toFixed(1)} g ${t('registerMeal.proteinShort')}`}
            </Text>
          ) : null}
          <NuButton onPress={() => { if (gramsValid) onConfirm(gramsValue); }} disabled={!gramsValid || saving}>
            {t('diary.save')}
          </NuButton>
        </View>
      ) : null}
    </NuPanel>
  );
}
