import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { NU, NuButton, NuCap, NuHairline } from '../../components/nutrition/NuKit';
import { useAuth } from '../../state/AuthContext';
import { createCustomFood } from '../../services/nutritionFoods';
import { validateCustomFoodForm } from '../../nutrition/ui/customFoodForm';
import type { NutritionCustomFood } from '../../types/nutrition';
import type { Timestamp } from 'firebase/firestore';

/** `NOME` — full-width filled input (spec §4.9). */
function NuFormInput({ value, onChangeText, placeholder, error }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; error?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={NU.faint}
      style={{
        height: 52, borderRadius: 12, paddingHorizontal: 16,
        backgroundColor: NU.surfaceSubtleStrong,
        borderWidth: 1, borderColor: error ? NU.danger : 'transparent',
        fontFamily: 'Archivo_400Regular', fontSize: 15.5, color: NU.white,
      }}
    />
  );
}

/** A labeled row with a small right-aligned numeric input + trailing unit — spec §4.9 `C2NumRow` ("Calorias/Proteína/…" rows). */
function NuNumRow({ label, value, onChangeText, unit, placeholder = '0', last, error }: {
  label: string; value: string; onChangeText: (v: string) => void; unit: string; placeholder?: string; last?: boolean; error?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: NU.hairline }}>
      <Text style={{ flex: 1, fontFamily: 'Archivo_400Regular', fontSize: 14.5, color: NU.white }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={NU.faint}
        keyboardType="decimal-pad"
        textAlign="right"
        style={{
          width: 84, height: 40, borderRadius: 10, paddingHorizontal: 12,
          backgroundColor: NU.surfaceSubtleStrong, borderWidth: 1, borderColor: error ? NU.danger : 'transparent',
          fontFamily: 'Archivo_600SemiBold', fontSize: 15, color: NU.white,
        }}
      />
      <Text style={{ width: 30, fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint }}>{unit}</Text>
    </View>
  );
}

/**
 * `08_frontend/screens.md` §8. Saved foods become usable immediately —
 * caller re-fetches/selects right after `onCreated`.
 *
 * Renders as a plain absolutely-positioned overlay, not its own
 * `<Modal>` — its caller supplies the native presentation, either
 * NutritionShell's standalone sliding `pageSheet` or `FoodSearchScreen`'s own
 * `pageSheet` Modal (its "no results, cadastrar alimento" CTA). Two
 * independent native `<Modal>`s stacked on top of each other is
 * unreliable (the same class of bug fixed for `MealDetailsScreen` +
 * `MealFeedbackSheet`): dismissing the inner one can corrupt the outer
 * one's native presentation/touch chain. A plain View has no such
 * ambiguity in either position. Returning `null` while `!visible` also
 * fully unmounts the form fields on close, so `reset()` only needs to
 * run for the in-session "save" path.
 */
export function CreateCustomFoodScreen({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (food: NutritionCustomFood<Timestamp> & { id: string }) => void;
}) {
  const { t } = useTranslation('nutrition');
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const reset = () => { setName(''); setKcal(''); setProtein(''); setCarbs(''); setFat(''); setFiber(''); setErrors({}); };

  const handleSave = async () => {
    if (!user) return;
    const result = validateCustomFoodForm({ name, kcal, protein, carbs, fat, fiber });
    setErrors(result.errors as Record<string, boolean>);
    if (!result.valid || !result.values) return;
    setSaving(true);
    try {
      const id = await createCustomFood(user.uid, { name: name.trim(), nutritionPer100g: result.values });
      onCreated({ id, name: name.trim(), nutritionPer100g: result.values } as NutritionCustomFood<Timestamp> & { id: string });
      reset();
    } catch {
      setErrors({ save: true });
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50, backgroundColor: NU.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
          <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{t('customFood.title')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={() => { reset(); onClose(); }} style={{ padding: 6 }}>
            <Icon name="x" size={20} color={NU.faint} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <NuCap style={{ marginBottom: 10 }}>{t('customFood.name')}</NuCap>
          <NuFormInput value={name} onChangeText={setName} placeholder={t('customFood.namePlaceholder')} error={errors.name} />
          {errors.name ? <Text style={{ color: NU.danger, fontSize: 12, marginTop: 6 }}>{t('customFood.errors.name')}</Text> : null}

          <NuCap style={{ marginTop: 30, marginBottom: 2 }}>{t('customFood.per100g')}</NuCap>
          <NuNumRow label={t('customFood.kcal')} unit="kcal" value={kcal} onChangeText={setKcal} error={errors.kcal} />
          <NuNumRow label={t('customFood.protein')} unit="g" value={protein} onChangeText={setProtein} error={errors.protein} />
          <NuNumRow label={t('customFood.carbs')} unit="g" value={carbs} onChangeText={setCarbs} error={errors.carbs} />
          <NuNumRow label={t('customFood.fat')} unit="g" value={fat} onChangeText={setFat} error={errors.fat} />
          <NuNumRow label={t('customFood.fiber')} unit="g" value={fiber} onChangeText={setFiber} error={errors.fiber} last />
          {(errors.kcal || errors.protein || errors.carbs || errors.fat || errors.fiber) ? (
            <Text style={{ color: NU.danger, fontSize: 12, marginTop: 10 }}>{t('customFood.errors.number')}</Text>
          ) : null}

          <NuHairline style={{ marginTop: 24 }} />
          <NuButton onPress={handleSave} disabled={saving} style={{ marginTop: 24 }}>{t('customFood.save')}</NuButton>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
