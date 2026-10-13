import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { EmptyNutritionState } from '../../components/nutrition/NutritionStates';
import { useTheme } from '../../theme';
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
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('favorites.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('diary.cancel')} onPress={onClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>

          {loading ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={theme.colors.primaryEmphasis} /></View>
          ) : favorites.length === 0 ? (
            <View style={{ paddingTop: 20 }}>
              <EmptyNutritionState icon="star" title={t('favorites.empty')} body={t('favorites.emptyBody')} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 22, gap: 14 }}>
              {favorites.map((favorite) => (
                <View
                  key={favorite.id}
                  style={{ borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.cardBorder,
                    backgroundColor: theme.colors.surface, padding: 14, gap: 6 }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <MonoLabel color={theme.colors.textFaint}>{t(`mealSlots.${favorite.slot}`)}</MonoLabel>
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textFaint }}>
                      {Math.round(favorite.totals.kcal)} {t('units.kcal')}
                    </Text>
                  </View>
                  {favorite.foods.map((food, index) => (
                    <FoodRow key={`${food.name}-${index}`} name={`${food.name} — ${food.quantity} ${food.unit}`}
                      raw kcal={planItemKcal(food)} />
                  ))}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                    <Pressable
                      onPress={() => onRemove(favorite.id)} disabled={removingId === favorite.id}
                      style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: theme.radii.md,
                        borderWidth: 1, borderColor: theme.colors.cardBorder }}
                    >
                      {removingId === favorite.id ? <ActivityIndicator size="small" color={theme.colors.textFaint} /> : (
                        <Icon name="trash" size={15} color={theme.colors.textFaint} />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => onUse(favorite)} disabled={usingId === favorite.id}
                      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
                        borderRadius: theme.radii.md, backgroundColor: theme.colors.primaryEmphasis, opacity: usingId === favorite.id ? 0.6 : 1 }}
                    >
                      {usingId === favorite.id ? <ActivityIndicator size="small" color={theme.colors.primaryForeground} /> : (
                        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13, color: theme.colors.primaryForeground }}>
                          {t('favorites.use')}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </ScreenBg>
    </Modal>
  );
}
