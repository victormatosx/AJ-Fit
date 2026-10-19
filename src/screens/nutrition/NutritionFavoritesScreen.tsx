import React from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { EmptyNutritionState } from '../../components/nutrition/NutritionStates';
import { NU, NuButton, NuCap, NuIconButton, NuSheetHeader } from '../../components/nutrition/NuKit';
import { planItemKcal } from '../../nutrition/ui/planView';
import type { NutritionFavoriteMealOption } from '../../types/nutrition';

export function NutritionFavoritesScreen({
  visible, favorites, loading, removingId, usingId, onClose, onUse, onRemove,
}: {
  visible: boolean;
  favorites: readonly NutritionFavoriteMealOption<unknown>[];
  loading: boolean;
  removingId: string | null;
  usingId: string | null;
  onClose: () => void;
  onUse: (favorite: NutritionFavoriteMealOption<unknown>) => void;
  onRemove: (favoriteId: string) => void;
}) {
  const { t } = useTranslation('nutrition');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <NuSheetHeader title={t('favorites.title')} onBack={onClose} />

          {loading ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={NU.blueHi} /></View>
          ) : favorites.length === 0 ? (
            <View style={{ paddingTop: 20 }}>
              <EmptyNutritionState icon="star" title={t('favorites.empty')} body={t('favorites.emptyBody')} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
              {favorites.map((favorite, index) => (
                <View key={favorite.id} style={[{ paddingVertical: 22 }, index ? { borderTopWidth: 1, borderTopColor: NU.hairline } : null]}>
                  <NuCap>{t(`mealSlots.${favorite.slot}`)}</NuCap>
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.faint, marginTop: 8 }}>
                    {favorite.foods.map((food) => food.name).join(', ')}
                  </Text>
                  <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, color: NU.secondary, marginTop: 5 }}>
                    {Math.round(favorite.totals.kcal)} {t('units.kcal')} · P {Math.round(favorite.totals.proteinG)}{t('units.gramsShort')} ·
                    {' '}C {Math.round(favorite.totals.carbsG)}{t('units.gramsShort')} · G {Math.round(favorite.totals.fatG)}{t('units.gramsShort')}
                  </Text>
                  <View style={{ marginTop: 10 }}>
                    {favorite.foods.map((food, foodIndex) => (
                      <View key={`${food.name}-${foodIndex}`} style={{ borderTopWidth: 1, borderTopColor: NU.hairline }}>
                        <FoodRow name={`${food.name}${food.catalogBinding?.brandName ? ` (${food.catalogBinding.brandName})` : ''} — ${food.quantity} ${food.unit}`} raw kcal={planItemKcal(food)} />
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                    <View style={{ flex: 1 }}>
                      <NuButton ghost onPress={() => onUse(favorite)} disabled={usingId === favorite.id}>
                        {usingId === favorite.id ? <ActivityIndicator size="small" color={NU.white} /> : t('favorites.use')}
                      </NuButton>
                    </View>
                    <NuIconButton
                      icon="trash"
                      accessibilityLabel={t('favorites.remove')}
                      onPress={() => onRemove(favorite.id)}
                    />
                  </View>
                  {removingId === favorite.id ? <ActivityIndicator size="small" color={NU.faint} style={{ marginTop: 8 }} /> : null}
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
