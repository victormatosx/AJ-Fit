import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  AqMonoLabel,
  AqPrimaryButton,
  AqRise,
  AqSegmented,
  AqTextAction,
} from '../components/ui/AcquisitionControls';
import { Display } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { NuRing } from '../components/nutrition/NuKit';
import {
  PlanLockedPreview,
  PlanMacroColumn,
  PlanPanelHeader,
  PlanStatsLine,
  PlanTagRibbon,
  PlanWeekRow,
} from '../components/plan/PlanPanels';
import { JotinhaPlanDropdown } from '../components/plan/JotinhaPlanDropdown';
import { AJ_PLAN } from '../components/aj/ajMomentTiming';
import { useAjFunnelDirector } from '../components/onboarding/AjFunnelStage';
import { macroCalorieShares, resolvePlanDietPreview } from './plan/planDietPreview';
import { useTheme } from '../theme';
import { useAppState, WEEKDAY_ORDER } from '../state/AppState';
import { generateWorkoutPrescriptionRouted } from '../workoutPrescription/generatePrescription';
import { prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { startingLevelFromQuestionnaire } from '../workoutLifecycle/domain';
import { resolveSessionDisplayName } from '../workoutPrescription/sessionPresentation';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import { nutritionDraftAnswers, type OnboardingNutritionDraft } from '../onboarding/nutritionDraft';
import type { LooseT } from '../components/onboarding/QuestionRenderer';

/** `sessionIndex` → the single letter the week pills and the session card badge it as (`A`, `B`, …). */
function sessionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** A weekly frequency is always 1–7; this only guards against a bad upstream value, it never invents one. */
const MIN_LOCKED_ROW_COUNT = 1;
const MAX_LOCKED_ROW_COUNT = 7;

/**
 * Every value on this screen must trace back to a real answer — see
 * docs/onboarding_funnel_architecture.md §Plan Ready. It still intentionally
 * does NOT show a program name, a body-composition projection, or a program
 * length in weeks/workout count: none of those are computed by a real engine
 * today, and presenting them would be fabricated personalization.
 *
 * The weekly split letter per day and the previewed session's own exercises
 * (see the Workout-tab paragraph below) are the one exception, now that the
 * v1.27 prescription engine genuinely computes them — see that paragraph for
 * what changed and why it's a product decision, not a data-integrity one.
 *
 * Calories and macros are the one exception, and only because they are real:
 * `calculateNutritionTargets` is a pure function of the onboarding answers and
 * is the same engine the automatic diet generation runs (the Cloud Function's
 * copy is generated from it). When it cannot run — an incomplete profile, a
 * missing birth date, an ambiguous goal — `resolvePlanDietPreview` returns no
 * targets and this screen omits the numbers rather than estimating them.
 *
 * Layout: a single vertical scroll, with a Workout/Diet tab switcher
 * (`AqSegmented`) choosing which of the two panels is visible below the
 * ribbon. Jotinha (`JotinhaPlanDropdown`) is a silent, fixed presence
 * top-right for the whole screen — no narration, no bubble — so he never
 * gates the plan or the CTA below it.
 *
 * The Workout tab's previewed day (letter, session name, exercises with
 * their sets/reps) is real: `FinalWorkoutPlan.sessions`/`weeklySchedule`,
 * the same v1.27 engine output `WorkoutScreen` runs the session from. This
 * is the one deliberate reversal of this screen's original "nothing the
 * engine didn't produce" policy — it now shows that real output unlocked,
 * which is a product decision (not a data-integrity one): the lock stays on
 * the diet panel's foods below, only the workout preview changed.
 */
export function PlanReadyScreen({
  name,
  onContinue,
  onBack,
  nutrition,
}: {
  name?: string | null;
  onContinue: () => void;
  /** "Ajustar minhas respostas" under the CTA — absent when the funnel can't go back. */
  onBack?: (() => void) | null;
  /** Read-only copy of the funnel's nutrition draft. Never written back. */
  nutrition?: OnboardingNutritionDraft;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['plan', 'quiz', 'nutrition', 'workout']);
  const tLoose = t as unknown as LooseT;
  const { quiz } = useAppState();
  const insets = useSafeAreaInsets();
  const aj = useAjFunnelDirector();
  const { reduceMotion } = aj;

  const goalKey = quiz.goal ?? 'gain_muscle';
  const levelKey = quiz.level ?? 'intermediate';
  const days = quiz.days || 4;
  const durationMinutes = quiz.duration ?? '60';
  const prescription = generateWorkoutPrescriptionRouted(quiz, startingLevelFromQuestionnaire(quiz.level) ?? 'INTERMEDIATE');
  const prescriptionCopyKey = prescription.status === 'SUCCESS'
    ? 'success'
    : prescriptionOutcomeKey(prescription.status);

  const goalLabel = t(`quiz:goal.options.${goalKey}.label` as 'quiz:goal.options.gain_muscle.label');
  const levelLabel = t(`quiz:level.options.${levelKey}.label` as 'quiz:level.options.intermediate.label');
  const scheduleMode = prescription.status === 'SUCCESS'
    ? prescription.plan.scheduleMode ?? 'fixed'
    : quiz.scheduleMode ?? 'fixed';
  const prescribedDays = prescription.status === 'SUCCESS'
    ? prescription.plan.prescribedTrainingFrequency ?? prescription.plan.prescribedStructuredDays
    : days;
  const fixedTrainingDays = prescription.status === 'SUCCESS'
    ? prescription.plan.weeklySchedule?.filter((day) => day.state === 'TRAINING').map((day) => day.weekday) ?? []
    : quiz.trainingDays ?? [];
  const trainingSlots = WEEKDAY_ORDER.map((weekday) => fixedTrainingDays.includes(weekday));
  const isFlexible = scheduleMode === 'flexible';

  // How many rows the workout's locked preview shows — the real weekly
  // frequency already badged elsewhere on this screen, never a fixed count.
  // The diet panel has no such cap: it lists every meal the user actually
  // marked.
  const LOCKED_ROW_COUNT = Math.min(MAX_LOCKED_ROW_COUNT, Math.max(MIN_LOCKED_ROW_COUNT, Math.round(prescribedDays)));

  const draft = nutritionDraftAnswers(nutrition ?? { answers: {}, targetWeightText: '', targetWeightUnits: 'metric', customFoods: [], completed: false });
  const diet = resolvePlanDietPreview({
    goal: quiz.goal,
    sex: quiz.sex,
    heightCm: quiz.height,
    weightKg: quiz.weight,
    birthDate: quiz.birthDate instanceof Date ? quiz.birthDate : null,
    weeklyTrainingFrequency: prescribedDays,
    draft,
  });

  const allergens = draft.excludedAllergens ?? [];
  const mealSlots = diet.mealSlots;
  const categoryLabel = diet.goalCategory
    ? tLoose(`nutrition:profile.questions.nutritionGoalCategory.options.${diet.goalCategory}`)
    : null;

  const continuedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const handleContinue = () => {
    if (continuedRef.current) return;
    continuedRef.current = true;
    if (reduceMotion) {
      onContinue();
      return;
    }
    aj.play('hop');
    // AJ leaves first; the funnel's own handler runs once, afterwards.
    later(onContinue, AJ_PLAN.ctaContinueAtMs);
  };

  const weeklySchedule = prescription.status === 'SUCCESS' ? prescription.plan.weeklySchedule ?? [] : [];
  const weeklyScheduleByWeekday = new Map(weeklySchedule.map((entry) => [entry.weekday, entry]));

  const weekColumns = (isFlexible
    ? Array.from({ length: Math.min(7, Math.max(0, prescribedDays)) }, (_, index) => ({
        key: `slot-${index}`,
        // Flexible training has no weekdays to show, so the columns become an
        // ordinal sequence — the one honest rendering of "whenever you can".
        label: t('plan:workoutPanel.flexibleSlot', { index: index + 1 }),
        active: true,
        letter: prescription.status === 'SUCCESS' ? sessionLetter(index) : null,
      }))
    : trainingSlots.map((active, index) => {
        const weekday = WEEKDAY_ORDER[index];
        const scheduledSessionIndex = weeklyScheduleByWeekday.get(weekday)?.sessionIndex;
        return {
          key: DAY_ORDER[index],
          label: t(`plan:schedule.dayLabels.${DAY_ORDER[index]}` as 'plan:schedule.dayLabels.mon'),
          active,
          letter: active && scheduledSessionIndex != null ? sessionLetter(scheduledSessionIndex) : null,
        };
      }));

  // The single day this screen previews unlocked in the Workout card — the
  // first training weekday the real schedule assigns (fixed mode) or the
  // first session in sequence (flexible mode, which has no weekdays at all).
  const previewWeekdayIndex = isFlexible ? -1 : trainingSlots.findIndex(Boolean);
  const previewWeekday = previewWeekdayIndex >= 0 ? WEEKDAY_ORDER[previewWeekdayIndex] : null;
  const previewSessionIndex = isFlexible
    ? 0
    : (previewWeekday ? weeklyScheduleByWeekday.get(previewWeekday)?.sessionIndex : undefined) ?? 0;

  // One card per distinct session the engine produced (`A`, `B`, …) — not one
  // per training day, so a letter the week reuses on more than one weekday
  // (fixed mode can do that) still only gets a single card. Swiping through
  // them is a preview of the split's shape, same `FinalWorkoutPlan.sessions`
  // `WorkoutScreen` runs the live session from — only `previewSessionIndex`'s
  // card renders its real exercises (see `unlocked` in the carousel below);
  // every other card is deliberately locked, same as the diet panel's foods.
  const sessionCards = prescription.status === 'SUCCESS'
    ? prescription.plan.sessions.map((session, index) => {
        const letter = sessionLetter(index);
        const weekdayIndex = isFlexible
          ? -1
          : WEEKDAY_ORDER.findIndex((weekday) => weeklyScheduleByWeekday.get(weekday)?.sessionIndex === index);
        const dayLabel = weekdayIndex >= 0
          ? t(`plan:schedule.dayNames.${DAY_ORDER[weekdayIndex]}` as 'plan:schedule.dayNames.mon')
          : null;
        return {
          index,
          eyebrow: dayLabel
            ? t('plan:workoutPanel.sessionCard', { letter, day: dayLabel })
            : t('plan:workoutPanel.sessionCardFlexible', { letter, slot: t('plan:workoutPanel.flexibleSlot', { index: index + 1 }) }),
          name: resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName),
          // Same conversion `WorkoutScreen` runs for the live session — real
          // exercise names and sets/reps from the same `FinalWorkoutPlan`,
          // not re-derived here. Computed for every session (not just the
          // unlocked one) so a locked card's placeholder rows can still
          // match that session's real exercise count.
          exercises: workoutExercisesFromPlan(prescription.plan, i18n.language, index),
        };
      })
    : [];
  // The unlocked card always leads the swipe order, so the carousel never
  // needs an imperative "scroll to the Nth page" on mount.
  const orderedSessionCards = [
    ...sessionCards.filter((card) => card.index === previewSessionIndex),
    ...sessionCards.filter((card) => card.index !== previewSessionIndex),
  ];

  const [activeTab, setActiveTab] = useState<'workout' | 'diet'>('workout');
  // The CTA footer sits fixed below the scroll, not inside it — the
  // scroll's own bottom padding has to clear it by its real measured
  // height (it varies with locale-driven label length and the optional
  // "Ajustar minhas respostas" row), not a guessed constant.
  const [ctaFooterHeight, setCtaFooterHeight] = useState(0);
  const [sessionCardWidth, setSessionCardWidth] = useState(0);
  const [selectedSessionCardPosition, setSelectedSessionCardPosition] = useState(0);
  const handleSessionCardScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (sessionCardWidth <= 0) return;
    const raw = event.nativeEvent.contentOffset.x / sessionCardWidth;
    const position = Math.max(0, Math.min(orderedSessionCards.length - 1, Math.round(raw)));
    setSelectedSessionCardPosition((current) => (current === position ? current : position));
  }, [sessionCardWidth, orderedSessionCards.length]);

  const shares = diet.targets ? macroCalorieShares(diet.targets) : null;

  const allergenSummary = (): string | null => {
    if (allergens.length === 0) return null;
    const labels = allergens.map((allergen) => tLoose(`nutrition:profile.questions.excludedAllergens.options.${allergen}`));
    if (labels.length <= 2) {
      return t('plan:dietPanel.withoutAllergens', { allergens: labels.join(tLoose('quiz:aj.list.conjunction')) });
    }
    return t('plan:dietPanel.allergenCount', { count: labels.length });
  };

  const ribbonItems = [
    { label: '', value: goalLabel },
    { label: '', value: t('plan:banner.frequency', { count: prescribedDays }) },
    { label: '', value: levelLabel },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: ctaFooterHeight + 20,
          }}
        >
          <AqRise reduceMotion={reduceMotion}>
            {/* Reserves room on the right for Jotinha (`JotinhaPlanDropdown`'s
                fixed avatar anchor), so a long name never wraps a title line
                underneath him. */}
            <View style={{ alignItems: 'flex-start', gap: 8, maxWidth: '75%' }}>
              <AqMonoLabel color={theme.colors.textLabelQuiet}>{t('plan:kicker')}</AqMonoLabel>
              <View accessibilityRole="header" style={{ alignItems: 'flex-start' }}>
                <Display size={34} color={theme.colors.textPrimary}>
                  {name ? t('plan:header.titleLine1WithName', { name }) : t('plan:header.titleLine1NoName')}
                </Display>
                <Display size={34} color={theme.colors.primaryEmphasis}>
                  {t('plan:header.titleLine2')}
                </Display>
              </View>
            </View>
          </AqRise>

          <AqRise reduceMotion={reduceMotion} delay={reduceMotion ? 0 : 40} style={{ marginTop: 20, marginHorizontal: -22 }}>
            <PlanTagRibbon items={ribbonItems} />
          </AqRise>

          <AqRise reduceMotion={reduceMotion} delay={reduceMotion ? 0 : 55} style={{ marginTop: 20, marginHorizontal: -22 }}>
            <AqSegmented
              role="tab"
              accessibilityLabel={t('plan:tabs.accessibility')}
              options={[
                { id: 'workout', label: t('plan:tabs.workout') },
                { id: 'diet', label: t('plan:tabs.diet') },
              ]}
              selectedId={activeTab}
              onSelect={(id) => setActiveTab(id as 'workout' | 'diet')}
              trackRadius={0}
              thumbRadius={0}
              trackPadding={0}
              trackBackgroundColor={theme.colors.background}
              thumbColor={theme.colors.inverseSurface}
              thumbGlowColor="transparent"
              selectedLabelColor={theme.colors.background}
              style={{
                borderLeftWidth: 0,
                borderRightWidth: 0,
                borderTopWidth: 1,
                borderBottomWidth: 1,
              }}
            />
          </AqRise>

          {activeTab === 'workout' ? (
            <AqRise reduceMotion={reduceMotion} delay={reduceMotion ? 0 : 70} style={{ marginTop: 20 }}>
              <PlanPanelHeader
                title={prescription.status === 'SUCCESS'
                  ? t(`plan:prescription.${prescriptionCopyKey}.title`)
                  : t('plan:header.reviewTitle')}
                badge={t('plan:workoutPanel.frequencyBadge', { count: prescribedDays })}
              />

              <View style={{ marginTop: 22 }}>
                <AqMonoLabel color={theme.colors.textLabelFaint}>{t('plan:schedule.yourWeek')}</AqMonoLabel>
                <View style={{ marginTop: 12 }}>
                  <PlanWeekRow columns={weekColumns} />
                </View>
              </View>

              <View style={{ marginTop: 20, gap: 16 }}>
                <PlanStatsLine
                  parts={[
                    { value: t('plan:workoutPanel.statsFrequency', { count: prescribedDays }), label: '' },
                    { value: t('plan:workoutPanel.statsDuration', { minutes: durationMinutes }), label: '' },
                  ]}
                />
                {prescription.status === 'SUCCESS' && orderedSessionCards.length > 0 ? (
                  <View>
                    <View onLayout={(event) => setSessionCardWidth(event.nativeEvent.layout.width)}>
                      {sessionCardWidth > 0 ? (
                        <ScrollView
                          horizontal
                          pagingEnabled
                          showsHorizontalScrollIndicator={false}
                          onMomentumScrollEnd={handleSessionCardScrollEnd}
                          scrollEventThrottle={16}
                        >
                          {orderedSessionCards.map((card) => {
                            const unlocked = card.index === previewSessionIndex;
                            return (
                              <View
                                key={card.index}
                                style={{
                                  width: sessionCardWidth,
                                  borderWidth: 1,
                                  borderColor: theme.colors.divider,
                                  borderRadius: 16,
                                  overflow: 'hidden',
                                }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 16, gap: 12 }}>
                                  <View style={{ flex: 1 }}>
                                    <AqMonoLabel color={theme.colors.textLabelFaint}>{card.eyebrow.toUpperCase()}</AqMonoLabel>
                                    <Text
                                      style={{
                                        marginTop: 6,
                                        fontFamily: theme.fonts.uiSemi,
                                        fontSize: 19,
                                        lineHeight: 24,
                                        color: theme.colors.textPrimary,
                                      }}
                                    >
                                      {card.name}
                                    </Text>
                                  </View>
                                  <View
                                    style={{
                                      alignItems: 'center',
                                      paddingHorizontal: 12,
                                      paddingVertical: 8,
                                      borderRadius: 12,
                                      backgroundColor: theme.colors.primarySurface,
                                    }}
                                  >
                                    <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.primaryEmphasis }}>
                                      {durationMinutes}
                                    </Text>
                                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, letterSpacing: 1, color: theme.colors.primaryEmphasis }}>
                                      {t('plan:workoutPanel.durationUnit').toUpperCase()}
                                    </Text>
                                  </View>
                                </View>
                                <PlanLockedPreview
                                  locked={!unlocked}
                                  showPlaceholderBars={!unlocked}
                                  rows={card.exercises.map((exercise, index) => unlocked
                                    ? {
                                        key: `${exercise.id}-${index}`,
                                        title: exercise.name,
                                        trailing: `${exercise.sets.length}×${exercise.sets[0]?.r ?? ''}`,
                                      }
                                    : {
                                        key: `${exercise.id}-${index}`,
                                        title: t('plan:workoutPanel.exerciseRow', { index: index + 1 }),
                                      })}
                                  footer={unlocked ? null : t('plan:workoutPanel.lockedFooter')}
                                />
                              </View>
                            );
                          })}
                        </ScrollView>
                      ) : null}
                    </View>
                    {orderedSessionCards.length > 1 ? (
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}
                      >
                        {orderedSessionCards.map((card, position) => (
                          <View
                            key={card.index}
                            style={{
                              width: position === selectedSessionCardPosition ? 16 : 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: position === selectedSessionCardPosition
                                ? theme.colors.primary
                                : theme.colors.divider,
                            }}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <PlanLockedPreview
                    rows={Array.from({ length: LOCKED_ROW_COUNT }, (_, index) => ({
                      key: `workout-${index}`,
                      title: t('plan:workoutPanel.lockedRow', { index: index + 1 }),
                    }))}
                    footer={t('plan:workoutPanel.lockedFooter')}
                  />
                )}
              </View>
            </AqRise>
          ) : null}

          {activeTab === 'diet' ? (
            <AqRise reduceMotion={reduceMotion} delay={reduceMotion ? 0 : 70} style={{ marginTop: 20 }}>
              <PlanPanelHeader
                title={t('plan:dietPanel.title')}
                badge={t('plan:dietPanel.frequencyBadge', { count: mealSlots.length })}
              />
              <View style={{ marginTop: 20, gap: 16 }}>
                {/* Calories get the same ring design as the Nutrition home
                    screen's hero kcal ring (`NuRing`/`DailyNutritionSummary`
                    in `components/nutrition/MacroProgress.tsx`) — a full
                    ring here (there's nothing consumed yet to progress
                    against, this is the target), not the small single-line
                    stats text the Workout tab uses. Meal frequency moved to
                    the header badge, same spot the Workout tab's "5X/SEM"
                    sits in. */}
                {diet.targets ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                    <NuRing
                      size={112}
                      stroke={5}
                      pct={100}
                      color={theme.colors.primaryEmphasis}
                      accessibilityLabel={`${diet.targets.kcal} ${t('plan:dietPanel.kcalLabel')}`}
                    >
                      <Display size={26} skew={false} color={theme.colors.textPrimary}>
                        {diet.targets.kcal}
                      </Display>
                      <Text
                        style={{
                          marginTop: 2,
                          fontFamily: theme.fonts.mono,
                          fontSize: 9,
                          letterSpacing: 1,
                          textAlign: 'center',
                          textTransform: 'uppercase',
                          color: theme.colors.textMuted,
                        }}
                      >
                        {t('plan:dietPanel.kcalLabel')}
                      </Text>
                    </NuRing>
                  </View>
                ) : null}
                {allergenSummary() ? (
                  <PlanStatsLine parts={[{ value: allergenSummary() as string, label: '' }]} />
                ) : null}
                {diet.targets ? (
                  <View style={{ flexDirection: 'row' }}>
                    <PlanMacroColumn
                      value={`${diet.targets.proteinG}${t('plan:dietPanel.gramsSuffix')}`}
                      label={t('plan:dietPanel.protein')}
                      share={shares?.protein ?? null}
                    />
                    <PlanMacroColumn
                      value={`${diet.targets.carbsG}${t('plan:dietPanel.gramsSuffix')}`}
                      label={t('plan:dietPanel.carbs')}
                      share={shares?.carbs ?? null}
                    />
                    <PlanMacroColumn
                      value={`${diet.targets.fatG}${t('plan:dietPanel.gramsSuffix')}`}
                      label={t('plan:dietPanel.fat')}
                      share={shares?.fat ?? null}
                    />
                  </View>
                ) : null}
                {/* Every meal the user said they would have, by name — the one
                    part of the menu that is already a real answer. No blurred
                    bars here: the name and its calorie target are the row's
                    data, and only the food itself is still locked. */}
                {mealSlots.length > 0 ? (
                  <PlanLockedPreview
                    showPlaceholderBars={false}
                    rows={mealSlots.map((slot) => {
                      const mealKcal = diet.targets?.mealKcal.find((meal) => meal.slot === slot);
                      return {
                        key: slot,
                        // The slot labels live at the root of the nutrition
                        // bundle (`mealSlots.<slot>`), not under the
                        // questionnaire's own options — same key every other
                        // nutrition screen reads.
                        title: tLoose(`nutrition:mealSlots.${slot}`),
                        trailing: mealKcal ? t('plan:dietPanel.mealKcal', { kcal: mealKcal.kcal }) : null,
                      };
                    })}
                    footer={t('plan:dietPanel.lockedFooter')}
                  />
                ) : null}
              </View>
            </AqRise>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <View
        onLayout={(event) => setCtaFooterHeight(event.nativeEvent.layout.height)}
        style={{
          paddingHorizontal: 22,
          paddingTop: 10,
          // Never less than the device's own safe-area inset, so the button
          // and the link under it are never clipped by the home indicator —
          // just a smaller cushion above it than before.
          paddingBottom: Math.max(12, insets.bottom + 6),
          backgroundColor: theme.colors.background,
        }}
      >
        <AqPrimaryButton
          glow
          label={t('plan:cta.label')}
          icon={(
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.primaryForegroundSurface,
              }}
            >
              <Icon name="arrow-right" size={12} color={theme.colors.primaryForeground} />
            </View>
          )}
          onPress={handleContinue}
          style={{ backgroundColor: theme.colors.primary, paddingVertical: 13 }}
          textStyle={{ color: theme.colors.primaryForeground }}
        />
        {onBack ? (
          <AqTextAction label={t('plan:cta.adjustAnswers')} onPress={onBack} style={{ marginTop: 4 }} />
        ) : null}
      </View>

      <JotinhaPlanDropdown aj={aj} reduceMotion={reduceMotion} />
    </View>
  );
}
