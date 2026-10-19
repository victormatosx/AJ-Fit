import { diaryItemQuantity, diaryItemUnit } from '../../nutrition/diary/snapshot';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { NU, NuButton, NuNav, NuPanel, NuSelectPill, NuSheetHeader, NuRow } from '../../components/nutrition/NuKit';
import { isFutureLocalDate, todayLocalDate } from '../../nutrition/ui/localDate';
import { nextUnloggedSlot } from '../../nutrition/ui/diaryModel';
import { NUTRITION_MEAL_SLOTS, type NutritionLoggedFoodItem, type NutritionMealSlot, type NutritionTotals } from '../../types/nutrition';
import { formatFoodDisplayName } from '../../nutrition/ui/formatFoodDisplayName';
import type { NutritionDailyLogDoc } from '../../services/nutritionDiary';

function DateNav({ localDate, onPrev, onNext }: { localDate: string; onPrev: () => void; onNext: () => void }) {
  const { t, i18n } = useTranslation('nutrition');
  const today = todayLocalDate();
  const isToday = localDate === today;
  const date = new Date(`${localDate}T00:00:00`);
  const weekdayLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'long' }).format(date);
  const sub = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  return (
    <View style={{ paddingHorizontal: 22, paddingBottom: 4 }}>
      <NuNav
        label={isToday ? t('diary.today') : weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1)}
        sub={sub}
        onPrev={onPrev}
        onNext={onNext}
        nextDisabled={isToday || isFutureLocalDate(localDate)}
      />
    </View>
  );
}

/** Diary-only bars: consumption and goals are the same persisted values as the Home summary. */
function DiaryProgress({ value, goal, color, label, height = 4 }: {
  value: number; goal: number; color: string; label: string; height?: number;
}) {
  const percent = goal > 0 ? Math.max(0, Math.min(100, value / goal * 100)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
      style={{ height, borderRadius: height / 2, backgroundColor: NU.track, overflow: 'hidden' }}
    >
      <View style={{ height: '100%', width: `${percent}%`, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

function DiaryNutritionSummary({ totals, goals }: { totals: NutritionTotals; goals: NutritionTotals }) {
  const { t } = useTranslation('nutrition');
  const remaining = goals.kcal - totals.kcal;
  const { width, fontScale } = useWindowDimensions();
  const macros = [
    { key: 'proteinG', label: t('weekly.protein') },
    { key: 'carbsG', label: t('weekly.carbs') },
    { key: 'fatG', label: t('weekly.fat') },
    { key: 'fiberG', label: t('weekly.fiber') },
  ] as const;
  return (
    <View style={{ padding: 16, borderRadius: 16, backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline, gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, rowGap: 4 }}>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: NU.white }}>
          <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 24 }}>{Math.round(totals.kcal)}</Text>
          {' '}{t('home.summary.of')} {Math.round(goals.kcal)} {t('units.kcal')}
        </Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: remaining < 0 ? NU.warn : NU.secondary }}>
          {t(remaining < 0 ? 'diary.overGoal' : 'diary.remaining', { value: Math.round(Math.abs(remaining)) })}
        </Text>
      </View>
      <DiaryProgress value={totals.kcal} goal={goals.kcal} color={NU.blueHi} height={8}
        label={`${Math.round(totals.kcal)} ${t('home.summary.of')} ${Math.round(goals.kcal)} ${t('units.kcal')}`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, marginTop: 8 }}>
        {macros.map(({ key, label }) => (
          <View key={key} style={{ flexBasis: '25%', flexGrow: 1, minWidth: fontScale > 1.3 ? 120 : width < 360 ? 100 : 0, paddingHorizontal: 6, gap: 6 }}>
            <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: NU.white }}>
              {Math.round(totals[key])}
              <Text style={{ fontFamily: 'Archivo_400Regular', color: NU.secondary }}> / {Math.round(goals[key])}{t('units.gramsShort')}</Text>
            </Text>
            <DiaryProgress value={totals[key]} goal={goals[key]} color={NU.white}
              label={`${label}: ${Math.round(totals[key])} / ${Math.round(goals[key])}${t('units.gramsShort')}`} />
            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 11, color: NU.secondary }}>{label}</Text>
          </View>
        ))}
      </View>
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
function EditGramsSheet({ visible, initialGrams, unit, estimated, onClose, onSave }: {
  visible: boolean; initialGrams: number; unit: string; estimated: boolean;
  onClose: () => void; onSave: (quantity: number) => Promise<void>;
}) {
  const { t } = useTranslation('nutrition');
  const [text, setText] = useState(String(initialGrams));
  const [busy, setBusy] = useState(false);
  const quantity = Number(text.replace(',', '.'));
  const valid = Number.isFinite(quantity) && quantity > 0 && quantity <= (estimated ? 5000 : 10000);
  return (
    <NuPanel visible={visible} avoidKeyboard onClose={busy ? () => {} : onClose}>
      <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{t(estimated ? 'diary.editQuantity' : 'diary.editGrams')}</Text>
      {estimated ? <Text style={{ color: NU.secondary, marginTop: 8 }}>{t('diary.planEstimate')}</Text> : null}
      <TextInput value={text} onChangeText={setText} editable={!busy} keyboardType="decimal-pad"
        accessibilityLabel={`${t('diary.editQuantity')} (${unit})`}
        style={{ color: NU.white, fontSize: 24, marginTop: 24, padding: 12 }} />
      <Text style={{ color: NU.secondary }}>{unit}</Text>
      <NuButton disabled={!valid || busy} onPress={() => {
        setBusy(true);
        void onSave(quantity).then(onClose).catch(() => Alert.alert(t('diary.operationFailed'))).finally(() => setBusy(false));
      }} style={{ marginTop: 26 }}>{t('diary.save')}</NuButton>
    </NuPanel>
  );
}

export function NutritionDiaryScreen({
  visible, localDate, day, dayLoaded, goals, mealSlots, onClose, onPrevDay, onNextDay,
  onAddFood, onEditGrams, onRemove, onMove, overlay, onDismissOverlay,
}: {
  visible: boolean;
  overlay?: React.ReactNode;
  onDismissOverlay?: () => void;
  localDate: string;
  day: NutritionDailyLogDoc | null;
  dayLoaded: boolean;
  goals: NutritionTotals | null;
  mealSlots: readonly NutritionMealSlot[];
  onClose: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onAddFood: (slot: NutritionMealSlot) => void;
  onEditGrams: (slot: NutritionMealSlot, item: NutritionLoggedFoodItem, grams: number) => Promise<void>;
  onRemove: (slot: NutritionMealSlot, itemId: string) => void;
  onMove: (slot: NutritionMealSlot, itemId: string, toSlot: NutritionMealSlot) => void;
}) {
  const { t } = useTranslation('nutrition');
  const [editing, setEditing] = useState<{ slot: NutritionMealSlot; item: NutritionLoggedFoodItem } | null>(null);
  const [moving, setMoving] = useState<{ slot: NutritionMealSlot; itemId: string; toSlot: NutritionMealSlot } | null>(null);

  const [foodActions, setFoodActions] = useState<{ slot: NutritionMealSlot; item: NutritionLoggedFoodItem } | null>(null);
  // Only presentation state, keyed by date: live diary updates never reset a user's choices.
  const [expandedByDate, setExpandedByDate] = useState<Record<string, Partial<Record<NutritionMealSlot, boolean>>>>({});
  const orderedSlots = [...mealSlots].sort((a, b) => NUTRITION_MEAL_SLOTS.indexOf(a) - NUTRITION_MEAL_SLOTS.indexOf(b));
  const firstRecorded = orderedSlots.find((slot) => day?.meals.some((meal) => meal.slot === slot && meal.items.length > 0));
  const defaultExpansion = firstRecorded ? { [firstRecorded]: true } : {};
  const expanded = expandedByDate[localDate] ?? defaultExpansion;
  // Shares `planView.nextPlanMeal`'s predicate (via `nextUnloggedSlot`) so
  // the Home card and this screen never disagree on which meal is next.
  const nextSlot = localDate === todayLocalDate() ? nextUnloggedSlot(orderedSlots, day) : undefined;

  useEffect(() => {
    if (!visible || !dayLoaded) return;
    setExpandedByDate((current) => current[localDate] ? current : {
      ...current, [localDate]: firstRecorded ? { [firstRecorded]: true } : {},
    });
  }, [visible, dayLoaded, localDate, firstRecorded]);

  useEffect(() => {
    setEditing(null);
    setMoving(null);
    setFoodActions(null);
  }, [localDate, visible]);

  const totals: NutritionTotals = day?.totals ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDismissOverlay ?? onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <NuSheetHeader title={t('diary.title')} onBack={onClose} />
          <DateNav localDate={localDate} onPrev={onPrevDay} onNext={onNextDay} />

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
            {!dayLoaded ? (
              <View style={{ gap: 16 }}><SkeletonBlock height={160} /><SkeletonBlock height={64} /><SkeletonBlock height={64} /></View>
            ) : goals ? (
              <View style={{ marginBottom: 20 }}>
                <DiaryNutritionSummary totals={totals} goals={goals} />
              </View>
            ) : null}

            {dayLoaded ? orderedSlots.map((slot, index) => {
              const meal = day?.meals.find((item) => item.slot === slot);
              const items = meal?.items ?? [];
              const hasItems = items.length > 0;
              const isNext = !hasItems && slot === nextSlot;
              const isExpanded = Boolean(expanded[slot]);
              return (
                <View key={slot} style={{ borderTopWidth: index ? 1 : 0, borderTopColor: NU.hairline }}>
                  <Pressable
                    onPress={() => setExpandedByDate((current) => ({
                      ...current, [localDate]: { ...(current[localDate] ?? defaultExpansion), [slot]: !isExpanded },
                    }))}
                    accessibilityRole="button"
                    accessibilityLabel={t(`mealSlots.${slot}`)}
                    accessibilityState={{ expanded: isExpanded }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 14, paddingHorizontal: 6 }}
                  >
                    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{
                      width: 24, height: 24, borderRadius: 12, flexShrink: 0,
                      backgroundColor: hasItems ? NU.blue : 'transparent', borderWidth: hasItems ? 0 : 1.5,
                      borderColor: isNext ? NU.blueHi : NU.faint, alignItems: 'center', justifyContent: 'center',
                    }}>
                      {hasItems ? <Icon name="check" size={16} color={NU.white} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 15, lineHeight: 21, color: NU.white }}>{t(`mealSlots.${slot}`)}</Text>
                      {hasItems || isNext ? (
                        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 17, color: isNext ? NU.blueHi : NU.secondary }}>
                          {hasItems ? t('home.mealsToday.itemCount', { count: items.length }) : t('home.mealsToday.nextMeal')}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: hasItems ? NU.white : NU.secondary }}>
                      {hasItems ? Math.round(meal!.totals.kcal) : '—'} {t('units.kcal')}
                    </Text>
                    <View style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}>
                      <Icon name="chevron-down" size={16} color={NU.secondary} />
                    </View>
                  </Pressable>
                  {isExpanded ? (
                    <View style={{ backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline, borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}>
                      {meal?.followedRecommendedOptionId ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 12 }}>
                          <Icon name="check" size={12} color={NU.secondary} />
                          <Text style={{ flexShrink: 1, fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.secondary }}>{t('diary.followedBadge')}</Text>
                        </View>
                      ) : null}
                      {items.length === 0 ? (
                        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.secondary, paddingHorizontal: 16, paddingTop: 14 }}>{t('diary.emptyMeal')}</Text>
                      ) : items.map((item, itemIndex) => (
                        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 6, paddingVertical: 8, borderTopWidth: itemIndex ? 1 : 0, borderTopColor: NU.hairline }}>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, lineHeight: 20, color: NU.white }}>{item.source === 'plan_snapshot' ? item.snapshot.name : formatFoodDisplayName(item.snapshot.name)}</Text>
                            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 17, color: NU.secondary }}>
                              {diaryItemQuantity(item)} {diaryItemUnit(item)} · {Math.round(item.snapshot.kcal)} {t('units.kcal')}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => setFoodActions({ slot, item })}
                            accessibilityRole="button"
                            accessibilityLabel={t('diary.foodActions', { name: formatFoodDisplayName(item.snapshot.name) })}
                            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Icon name="more-vertical" size={20} color={NU.secondary} />
                          </Pressable>
                        </View>
                      ))}
                      <Pressable onPress={() => onAddFood(slot)} accessibilityRole="button" accessibilityLabel={t('diary.addFood')}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: hasItems ? 1 : 0, borderTopColor: NU.hairline }}>
                        <Icon name="plus" size={18} color={NU.blueHi} />
                        <Text style={{ flexShrink: 1, fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: NU.blueHi }}>{t('diary.addFood')}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            }) : null}
          </ScrollView>
        </SafeAreaView>
      </View>

      <NuPanel visible={foodActions != null} onClose={() => setFoodActions(null)}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 16, lineHeight: 22, color: NU.white, marginBottom: 12 }}>
          {foodActions ? formatFoodDisplayName(foodActions.item.snapshot.name) : ''}
        </Text>
        <NuRow label={t(foodActions?.item.source === 'plan_snapshot' ? 'diary.editQuantity' : 'diary.editGrams')} onPress={() => { setEditing(foodActions); setFoodActions(null); }} />
        <NuRow label={t('diary.moveMeal')} onPress={() => {
          if (foodActions) setMoving({ slot: foodActions.slot, itemId: foodActions.item.id, toSlot: foodActions.slot });
          setFoodActions(null);
        }} />
        <NuRow label={t('diary.remove')} danger last onPress={() => {
          if (!foodActions) return;
          const { slot, item } = foodActions;
          setFoodActions(null);
          Alert.alert(t('diary.removeConfirm'), undefined, [
            { text: t('diary.cancel'), style: 'cancel' },
            { text: t('diary.remove'), style: 'destructive', onPress: () => onRemove(slot, item.id) },
          ]);
        }} />
      </NuPanel>

      {editing ? (
        <EditGramsSheet
          key={`${localDate}-${editing.slot}-${editing.item.id}`}
          visible
          initialGrams={diaryItemQuantity(editing.item)}
          unit={diaryItemUnit(editing.item)}
          estimated={editing.item.source === 'plan_snapshot'}
          onClose={() => setEditing(null)}
          onSave={async (quantity) => { await onEditGrams(editing.slot, editing.item, quantity); setEditing(null); }}
        />
      ) : null}

      {/* Plain overlay, not its own `<Modal>` — see the comment on
          `EditGramsSheet` above for why nesting a second native Modal here
          is unreliable. */}
      <NuPanel visible={moving != null} onClose={() => setMoving(null)}>
        <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>{t('diary.moveMeal')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 20 }}>
          {orderedSlots.filter((slot) => slot !== moving?.slot).map((slot) => (
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
      {overlay}
    </Modal>
  );
}
