import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { CtaButton } from '../../components/ui/CtaButton';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { DailyNutritionSummary } from '../../components/nutrition/MacroProgress';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { useTheme } from '../../theme';
import { todayLocalDate } from '../../nutrition/ui/localDate';
import type { NutritionLoggedFoodItem, NutritionMealSlot, NutritionTotals } from '../../types/nutrition';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';

function DateNav({ localDate, onPrev, onNext }: { localDate: string; onPrev: () => void; onNext: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const today = todayLocalDate();
  const isToday = localDate === today;
  const label = isToday ? t('diary.today') : localDate;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginTop: 4 }}>
      <Pressable onPress={onPrev} accessibilityRole="button" accessibilityLabel={t('diary.yesterday')} hitSlop={10}>
        <Icon name="arrow-left" size={18} color={theme.colors.textPrimary} />
      </Pressable>
      <MonoLabel color={theme.colors.textSecondary}>{label.toUpperCase()}</MonoLabel>
      <Pressable onPress={onNext} disabled={isToday} accessibilityRole="button" accessibilityLabel="next" hitSlop={10}
        style={{ opacity: isToday ? theme.opacity.disabled : 1 }}>
        <Icon name="arrow-right" size={18} color={theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

/**
 * Renders as a plain absolutely-positioned overlay, not its own
 * `<Modal>` — it (and the "move meal" overlay below) used to be a
 * `<Modal transparent>` nested inside `NutritionDiaryScreen`'s own
 * `pageSheet` Modal. Two independent native Modals both `visible` at
 * once is unreliable (the same class of bug fixed for
 * `MealDetailsScreen` + `MealFeedbackSheet`): dismissing the inner one
 * can corrupt the outer one's native presentation/touch chain. Returning
 * `null` while `!visible` also fully unmounts `value`, so reopening for
 * a different item always starts from that item's own `initialGrams`
 * instead of whatever was last typed.
 */
function EditGramsSheet({
  visible, initialGrams, onClose, onSave,
}: { visible: boolean; initialGrams: number; onClose: () => void; onSave: (grams: number) => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const [value, setValue] = useState(String(initialGrams));

  if (!visible) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 }}>
      <View style={{ flex: 1, backgroundColor: theme.colors.loadingOverlay, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View style={{ width: '100%', borderRadius: theme.radii.xl, backgroundColor: theme.colors.surfaceElevated, padding: 20, gap: 14 }}>
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.textPrimary }}>{t('diary.editGrams')}</Text>
          <TextInput
            value={value} onChangeText={setValue} keyboardType="decimal-pad" autoFocus
            style={{ height: 48, borderRadius: theme.radii.lg, paddingHorizontal: 14, backgroundColor: theme.colors.inputBackground,
              borderWidth: 1, borderColor: theme.colors.inputBorder, fontFamily: theme.fonts.ui, fontSize: 16, color: theme.colors.inputText }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <CtaButton ghost onPress={onClose} style={{ flex: 1 }}>{t('diary.cancel')}</CtaButton>
            <CtaButton onPress={() => { const grams = Number(value.replace(',', '.')); if (Number.isFinite(grams) && grams > 0) onSave(grams); }} style={{ flex: 1 }}>
              {t('diary.save')}
            </CtaButton>
          </View>
        </View>
      </View>
    </View>
  );
}

export function NutritionDiaryScreen({
  visible, localDate, day, dayLoaded, goals, mealSlots, onClose, onPrevDay, onNextDay,
  onAddFood, onEditGrams, onRemove, onMove,
}: {
  visible: boolean;
  localDate: string;
  day: NutritionDailyLogDoc | null;
  dayLoaded: boolean;
  goals: NutritionTotals | null;
  mealSlots: readonly NutritionMealSlot[];
  onClose: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onAddFood: (slot: NutritionMealSlot) => void;
  onEditGrams: (slot: NutritionMealSlot, item: NutritionLoggedFoodItem, grams: number) => void;
  onRemove: (slot: NutritionMealSlot, itemId: string) => void;
  onMove: (slot: NutritionMealSlot, itemId: string, toSlot: NutritionMealSlot) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const [editing, setEditing] = useState<{ slot: NutritionMealSlot; item: NutritionLoggedFoodItem } | null>(null);
  const [moving, setMoving] = useState<{ slot: NutritionMealSlot; itemId: string } | null>(null);

  const totals: NutritionTotals = day?.totals ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 }}>
            <Display size={20}>{t('diary.title')}</Display>
            <Pressable accessibilityRole="button" accessibilityLabel={t('diary.cancel')} onPress={onClose} style={{ padding: 6 }}>
              <Icon name="x" size={20} color={theme.colors.textFaint} />
            </Pressable>
          </View>

          <DateNav localDate={localDate} onPrev={onPrevDay} onNext={onNextDay} />

          <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40, gap: 20 }}>
            {!dayLoaded ? (
              <SkeletonBlock height={120} />
            ) : goals ? (
              <View>
                <MonoLabel color={theme.colors.textFaint} style={{ marginBottom: 10 }}>{t('diary.dailyGoal')}</MonoLabel>
                <DailyNutritionSummary totals={totals} goals={goals} />
              </View>
            ) : null}

            {mealSlots.map((slot) => {
              const meal = day?.meals.find((item) => item.slot === slot);
              const items = meal?.items ?? [];
              return (
                <View key={slot} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.textPrimary }}>
                        {t(`mealSlots.${slot}`)}
                      </Text>
                      {meal?.followedRecommendedOptionId ? (
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.primaryEmphasis }}>
                          {t('diary.followedBadge').toUpperCase()}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable onPress={() => onAddFood(slot)} accessibilityRole="button" accessibilityLabel={t('diary.addFood')}>
                      <Icon name="plus" size={16} color={theme.colors.primaryEmphasis} />
                    </Pressable>
                  </View>
                  {items.length === 0 ? (
                    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textFaint }}>{t('diary.empty')}</Text>
                  ) : items.map((item) => (
                    <View key={item.id}>
                      <FoodRow
                        name={item.snapshot.name} grams={item.grams} kcal={item.snapshot.kcal}
                        trailing={(
                          <View style={{ flexDirection: 'row', gap: 14 }}>
                            <Pressable onPress={() => setEditing({ slot, item })} accessibilityRole="button" accessibilityLabel={t('diary.editGrams')}>
                              <Icon name="settings" size={15} color={theme.colors.textFaint} />
                            </Pressable>
                            <Pressable onPress={() => setMoving({ slot, itemId: item.id })} accessibilityRole="button" accessibilityLabel={t('diary.moveMeal')}>
                              <Icon name="swap" size={15} color={theme.colors.textFaint} />
                            </Pressable>
                            <Pressable
                              onPress={() => Alert.alert(t('diary.removeConfirm'), undefined, [
                                { text: t('diary.cancel'), style: 'cancel' },
                                { text: t('diary.remove'), style: 'destructive', onPress: () => onRemove(slot, item.id) },
                              ])}
                              accessibilityRole="button" accessibilityLabel={t('diary.remove')}
                            >
                              <Icon name="trash" size={15} color={theme.colors.textFaint} />
                            </Pressable>
                          </View>
                        )}
                      />
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </ScreenBg>

      <EditGramsSheet
        visible={editing != null}
        initialGrams={editing?.item.grams ?? 0}
        onClose={() => setEditing(null)}
        onSave={(grams) => { if (editing) onEditGrams(editing.slot, editing.item, grams); setEditing(null); }}
      />

      {moving != null ? (
        // Plain overlay, not its own `<Modal>` — see the comment on
        // `EditGramsSheet` above for why nesting a second native Modal
        // here is unreliable.
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 }}>
          <View style={{ flex: 1, backgroundColor: theme.colors.loadingOverlay, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <View style={{ width: '100%', borderRadius: theme.radii.xl, backgroundColor: theme.colors.surfaceElevated, padding: 20, gap: 10 }}>
              <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.textPrimary }}>{t('diary.moveMeal')}</Text>
              {mealSlots.filter((slot) => slot !== moving?.slot).map((slot) => (
                <Pressable
                  key={slot}
                  onPress={() => { if (moving) onMove(moving.slot, moving.itemId, slot); setMoving(null); }}
                  style={{ paddingVertical: 12 }}
                >
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textPrimary }}>{t(`mealSlots.${slot}`)}</Text>
                </Pressable>
              ))}
              <CtaButton ghost onPress={() => setMoving(null)}>{t('diary.cancel')}</CtaButton>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
