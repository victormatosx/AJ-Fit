import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { FoodRow } from '../../components/nutrition/FoodRow';
import { DailyNutritionSummary } from '../../components/nutrition/MacroProgress';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { NU, NuButton, NuNav, NuPanel, NuSelectPill, NuSheetHeader, NuStepper } from '../../components/nutrition/NuKit';
import { todayLocalDate } from '../../nutrition/ui/localDate';
import type { NutritionLoggedFoodItem, NutritionMealSlot, NutritionTotals } from '../../types/nutrition';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';

function DateNav({ localDate, onPrev, onNext }: { localDate: string; onPrev: () => void; onNext: () => void }) {
  const { t } = useTranslation('nutrition');
  const today = todayLocalDate();
  const isToday = localDate === today;
  const date = new Date(`${localDate}T00:00:00`);
  const weekdayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  const sub = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  return (
    <View style={{ paddingHorizontal: 24 }}>
      <NuNav
        label={isToday ? t('diary.today') : weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1)}
        sub={sub}
        onPrev={onPrev}
        onNext={onNext}
        nextDisabled={isToday}
      />
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
  const { t } = useTranslation('nutrition');
  const [grams, setGrams] = useState(initialGrams);

  return (
    <NuPanel visible={visible} onClose={onClose}>
      <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{t('diary.editGrams')}</Text>
      <View style={{ marginTop: 24 }}>
        <NuStepper
          value={`${Math.round(grams)} ${t('units.gramsShort')}`}
          onMinus={() => setGrams((g) => Math.max(1, g - 10))}
          onPlus={() => setGrams((g) => Math.min(10000, g + 10))}
        />
      </View>
      <NuButton onPress={() => { if (grams > 0) onSave(grams); }} style={{ marginTop: 26 }}>{t('diary.save')}</NuButton>
    </NuPanel>
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
  const { t } = useTranslation('nutrition');
  const [editing, setEditing] = useState<{ slot: NutritionMealSlot; item: NutritionLoggedFoodItem } | null>(null);
  const [moving, setMoving] = useState<{ slot: NutritionMealSlot; itemId: string; toSlot: NutritionMealSlot } | null>(null);

  const totals: NutritionTotals = day?.totals ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <NuSheetHeader title={t('diary.title')} onBack={onClose} />
          <DateNav localDate={localDate} onPrev={onPrevDay} onNext={onNextDay} />

          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {!dayLoaded ? (
              <SkeletonBlock height={120} />
            ) : goals ? (
              <View style={{ marginBottom: 20 }}>
                <DailyNutritionSummary totals={totals} goals={goals} />
              </View>
            ) : null}

            {mealSlots.map((slot, index) => {
              const meal = day?.meals.find((item) => item.slot === slot);
              const items = meal?.items ?? [];
              return (
                <View key={slot} style={{ paddingTop: 20, borderTopWidth: index ? 1 : 0, borderTopColor: NU.hairline }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: NU.hairline }}>
                    <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 16, color: NU.white }}>
                      {t(`mealSlots.${slot}`)}
                    </Text>
                    <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: items.length ? NU.white : NU.faint }}>
                      {items.length ? `${Math.round(meal!.totals.kcal)} ${t('units.kcal')}` : '—'}
                    </Text>
                  </View>
                  {meal?.followedRecommendedOptionId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                      <Icon name="check" size={12} color={NU.faint} />
                      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint }}>{t('diary.followedBadge')}</Text>
                    </View>
                  ) : null}
                  {items.length === 0 ? (
                    <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, paddingVertical: 10 }}>{t('diary.empty')}</Text>
                  ) : items.map((item) => (
                    <FoodRow
                      key={item.id}
                      name={item.snapshot.name} grams={item.grams} kcal={item.snapshot.kcal}
                      trailing={(
                        <View style={{ flexDirection: 'row', gap: 16 }}>
                          <Pressable onPress={() => setEditing({ slot, item })} accessibilityRole="button" accessibilityLabel={t('diary.editGrams')} hitSlop={8}>
                            <Icon name="settings" size={15} color={NU.faint} />
                          </Pressable>
                          <Pressable onPress={() => setMoving({ slot, itemId: item.id, toSlot: slot })} accessibilityRole="button" accessibilityLabel={t('diary.moveMeal')} hitSlop={8}>
                            <Icon name="swap" size={15} color={NU.faint} />
                          </Pressable>
                          <Pressable
                            onPress={() => Alert.alert(t('diary.removeConfirm'), undefined, [
                              { text: t('diary.cancel'), style: 'cancel' },
                              { text: t('diary.remove'), style: 'destructive', onPress: () => onRemove(slot, item.id) },
                            ])}
                            accessibilityRole="button" accessibilityLabel={t('diary.remove')} hitSlop={8}
                          >
                            <Icon name="trash" size={15} color={NU.faint} />
                          </Pressable>
                        </View>
                      )}
                    />
                  ))}
                  <Pressable onPress={() => onAddFood(slot)} accessibilityRole="button" accessibilityLabel={t('diary.addFood')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12 }}>
                    <Icon name="plus" size={15} color={NU.secondary} />
                    <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: NU.secondary }}>{t('diary.addFood')}</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>

      <EditGramsSheet
        visible={editing != null}
        initialGrams={editing?.item.grams ?? 0}
        onClose={() => setEditing(null)}
        onSave={(grams) => { if (editing) onEditGrams(editing.slot, editing.item, grams); setEditing(null); }}
      />

      {/* Plain overlay, not its own `<Modal>` — see the comment on
          `EditGramsSheet` above for why nesting a second native Modal here
          is unreliable. */}
      <NuPanel visible={moving != null} onClose={() => setMoving(null)}>
        <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{t('diary.moveMeal')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 20 }}>
          {mealSlots.filter((slot) => slot !== moving?.slot).map((slot) => (
            <NuSelectPill key={slot} on={moving?.toSlot === slot} onPress={() => setMoving((current) => (current ? { ...current, toSlot: slot } : current))}>
              {t(`mealSlots.${slot}`)}
            </NuSelectPill>
          ))}
        </View>
        <NuButton
          onPress={() => { if (moving) onMove(moving.slot, moving.itemId, moving.toSlot); setMoving(null); }}
          style={{ marginTop: 26 }}
        >
          {t('diary.save')}
        </NuButton>
      </NuPanel>
    </Modal>
  );
}
