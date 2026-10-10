import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/AuthContext';
import { createCustomFood } from '../../services/nutritionFoods';
import { validateCustomFoodForm } from '../../nutrition/ui/customFoodForm';
import type { NutritionCustomFood } from '../../types/nutrition';
import type { Timestamp } from 'firebase/firestore';

function Field({ label, value, onChangeText, placeholder, error, numeric = false }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; error?: boolean; numeric?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.inputLabel }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.inputPlaceholder}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={{
          height: 48, borderRadius: theme.radii.lg, paddingHorizontal: 14,
          backgroundColor: theme.colors.inputBackground,
          borderWidth: 1, borderColor: error ? theme.colors.inputBorderError : theme.colors.inputBorder,
          fontFamily: theme.fonts.ui, fontSize: 15, color: theme.colors.inputText,
        }}
      />
    </View>
  );
}

/** `08_frontend/screens.md` §8. Saved foods become usable immediately — caller re-fetches/selects right after `onCreated`. */
export function CreateCustomFoodScreen({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (food: NutritionCustomFood<Timestamp> & { id: string }) => void;
}) {
  const { theme } = useTheme();
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('customFood.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('profile.actions.cancel')} onPress={() => { reset(); onClose(); }} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 22, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label={t('customFood.name')} value={name} onChangeText={setName} placeholder={t('customFood.namePlaceholder')} error={errors.name} />
            {errors.name ? <Text style={{ color: theme.colors.formErrorText, fontSize: 12 }}>{t('customFood.errors.name')}</Text> : null}

            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 }}>
              {t('customFood.per100g')}
            </Text>
            <Field numeric label={t('customFood.kcal')} value={kcal} onChangeText={setKcal} placeholder="0" error={errors.kcal} />
            <Field numeric label={t('customFood.protein')} value={protein} onChangeText={setProtein} placeholder="0" error={errors.protein} />
            <Field numeric label={t('customFood.carbs')} value={carbs} onChangeText={setCarbs} placeholder="0" error={errors.carbs} />
            <Field numeric label={t('customFood.fat')} value={fat} onChangeText={setFat} placeholder="0" error={errors.fat} />
            <Field numeric label={t('customFood.fiber')} value={fiber} onChangeText={setFiber} placeholder="0" error={errors.fiber} />
            {(errors.kcal || errors.protein || errors.carbs || errors.fat || errors.fiber) ? (
              <Text style={{ color: theme.colors.formErrorText, fontSize: 12 }}>{t('customFood.errors.number')}</Text>
            ) : null}

            <CtaButton onPress={handleSave} disabled={saving} style={{ marginTop: 8 }}>{t('customFood.save')}</CtaButton>
          </ScrollView>
        </SafeAreaView>
      </ScreenBg>
    </Modal>
  );
}
