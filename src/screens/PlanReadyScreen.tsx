import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  AqMonoLabel,
  AqPrimaryButton,
  AqSegmented,
  AqSheet,
} from '../components/ui/AcquisitionControls';
import {
  PlanLockedPreview,
  PlanMacroColumn,
  PlanPanelHeader,
  PlanStatsLine,
  PlanWeekRow,
} from '../components/plan/PlanPanels';
import { AjSpeechText } from '../components/aj/AjSpeechText';
import { AJ_PLAN, AJ_TYPING_MS_PER_CHAR, AJ_TYPING_PLAN_CHAIN_GAP_MS } from '../components/aj/ajMomentTiming';
import { useAjFunnelDirector } from '../components/onboarding/AjFunnelStage';
import { macroCalorieShares, resolvePlanDietPreview } from './plan/planDietPreview';
import { useTheme } from '../theme';
import { useAppState, WEEKDAY_ORDER } from '../state/AppState';
import { generateWorkoutPrescriptionRouted } from '../workoutPrescription/generatePrescription';
import { prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { startingLevelFromQuestionnaire } from '../workoutLifecycle/domain';
import { nutritionDraftAnswers, type OnboardingNutritionDraft } from '../onboarding/nutritionDraft';
import type { LooseT } from '../components/onboarding/QuestionRenderer';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/**
 * How many rows the workout's locked preview shows. The diet panel has no
 * such cap: it lists every meal the user actually marked.
 */
const LOCKED_ROW_COUNT = 3;

type PlanTab = 'workout' | 'diet';

/**
 * Every value on this screen must trace back to a real answer — see
 * docs/onboarding_funnel_architecture.md §Plan Ready. This intentionally
 * does NOT show a program name, a weekly split (push/pull/legs), a split
 * letter per day, a body-composition projection, or a program length in
 * weeks/workout count: none of those are computed by a real engine today, and
 * presenting them would be fabricated personalization. The approved design
 * shows all of them; reproducing its *structure* without its invented data is
 * the deliberate difference recorded in the delivery report.
 *
 * Calories and macros are the one exception, and only because they are real:
 * `calculateNutritionTargets` is a pure function of the onboarding answers and
 * is the same engine the automatic diet generation runs (the Cloud Function's
 * copy is generated from it). When it cannot run — an incomplete profile, a
 * missing birth date, an ambiguous goal — `resolvePlanDietPreview` returns no
 * targets and this screen omits the numbers rather than estimating them.
 */
export function PlanReadyScreen({
  name,
  onContinue,
  nutrition,
}: {
  name?: string | null;
  onContinue: () => void;
  /** Read-only copy of the funnel's nutrition draft. Never written back. */
  nutrition?: OnboardingNutritionDraft;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation(['plan', 'quiz', 'nutrition']);
  const tLoose = t as unknown as LooseT;
  const { quiz } = useAppState();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
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

  /* ── Narration ──────────────────────────────────────────────────────────
   * Five lines, each revealing the block it describes. `onContinue` is still
   * called exactly once, from one place, and the CTA's own behaviour — the
   * `plan_ready_cta_pressed` event, `flushDraft`, `onAuthRequested` — all
   * live behind it, untouched.
   * ──────────────────────────────────────────────────────────────────────── */

  const [tab, setTab] = useState<PlanTab>('workout');
  const [lineIndex, setLineIndex] = useState(0);
  const [narrationDone, setNarrationDone] = useState(reduceMotion);
  const [sheetHeight, setSheetHeight] = useState(0);
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

  const allergens = draft.excludedAllergens ?? [];
  const mealSlots = diet.mealSlots;
  const categoryLabel = diet.goalCategory
    ? tLoose(`nutrition:profile.questions.nutritionGoalCategory.options.${diet.goalCategory}`)
    : null;

  const narrationLines = [
    name ? t('plan:aj.intro', { name }) : t('plan:aj.introNoName'),
    t('plan:aj.strategy', { goal: goalLabel, level: levelLabel }),
    isFlexible
      ? t('plan:aj.volumeFlexible', { count: prescribedDays, minutes: durationMinutes })
      : t('plan:aj.volume', { count: prescribedDays, minutes: durationMinutes }),
    // Only promises macros when the engine actually produced them.
    categoryLabel
      ? diet.targets
        ? t('plan:aj.dietWithMacros', {
            category: categoryLabel,
            count: mealSlots.length,
            kcal: diet.targets.kcal,
            protein: diet.targets.proteinG,
          })
        : t('plan:aj.diet', { category: categoryLabel, count: mealSlots.length })
      : null,
    t('plan:aj.closing'),
  ].filter((line): line is string => Boolean(line));

  // Reduce Motion: every block is already revealed and the CTA is immediate.
  const revealed = (index: number) => reduceMotion || lineIndex > index || narrationDone;
  const dietLineIndex = narrationLines.length - 2;

  // AJ stands in the gap between the top of the screen and the sheet. Size is
  // clamped so a short screen does not end up with a mascot taller than the
  // room it has.
  useEffect(() => {
    const sheetTop = sheetHeight > 0 ? height - sheetHeight : height * 0.55;
    const size = Math.max(72, Math.min(112, sheetTop - 220));
    aj.direct({ x: (width - size) / 2, y: Math.max(insets.top + 40, (sheetTop - size) / 2), size, rotate: 0 });
  }, [aj, width, height, insets.top, sheetHeight]);

  const handleLineStart = (index: number) => {
    aj.setTalking(true);
    aj.setMood('talk');
    // The narration switches to the Diet tab as its own fourth line begins —
    // the tab change IS the line, not a consequence of it.
    if (index === dietLineIndex && categoryLabel) {
      setTab('diet');
      aj.play('nod');
    }
  };

  const handleLineDone = (index: number) => {
    aj.setTalking(false);
    if (index >= narrationLines.length - 1) {
      aj.setMood('happy');
      setNarrationDone(true);
      return;
    }
    aj.play('nod');
    later(() => setLineIndex(index + 1), AJ_PLAN.lineSettleMs);
  };

  useEffect(() => {
    if (!reduceMotion) return () => undefined;
    setNarrationDone(true);
    return () => undefined;
  }, [reduceMotion]);

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

  const weekColumns = (isFlexible
    ? Array.from({ length: Math.min(7, Math.max(0, prescribedDays)) }, (_, index) => ({
        key: `slot-${index}`,
        // Flexible training has no weekdays to show, so the columns become an
        // ordinal sequence — the one honest rendering of "whenever you can".
        label: t('plan:workoutPanel.flexibleSlot', { index: index + 1 }),
        active: true,
      }))
    : trainingSlots.map((active, index) => ({
        key: DAY_ORDER[index],
        label: t(`plan:schedule.dayLabels.${DAY_ORDER[index]}` as 'plan:schedule.dayLabels.mon'),
        active,
      })));

  const shares = diet.targets ? macroCalorieShares(diet.targets) : null;

  const allergenSummary = (): string | null => {
    if (allergens.length === 0) return null;
    const labels = allergens.map((allergen) => tLoose(`nutrition:profile.questions.excludedAllergens.options.${allergen}`));
    if (labels.length <= 2) {
      return t('plan:dietPanel.withoutAllergens', { allergens: labels.join(tLoose('quiz:aj.list.conjunction')) });
    }
    return t('plan:dietPanel.allergenCount', { count: labels.length });
  };

  const dietSummaryParts = [
    { value: t('plan:dietPanel.meals', { count: mealSlots.length }), label: '' },
    ...(diet.targets ? [{ value: t('plan:dietPanel.kcalPerDay', { kcal: diet.targets.kcal }), label: '' }] : []),
    ...(allergenSummary() ? [{ value: allergenSummary() as string, label: '' }] : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ paddingTop: 15, alignItems: 'center' }}>
          <AqMonoLabel color={theme.colors.textLabelQuiet}>{t('plan:kicker')}</AqMonoLabel>
        </View>

        {/* AJ is drawn by the funnel's stage; his lines sit just below him. */}
        <View
          style={{
            position: 'absolute',
            top: Math.max(insets.top + 40, ((sheetHeight > 0 ? height - sheetHeight : height * 0.55) - 112) / 2) + 112 + 16,
            left: 26,
            right: 26,
          }}
        >
          {narrationLines.map((line, index) => (
            index <= lineIndex || reduceMotion ? (
              <AjSpeechText
                key={line}
                text={line}
                msPerChar={AJ_TYPING_MS_PER_CHAR.plan}
                reduceMotion={reduceMotion}
                startDelayMs={index === 0 ? AJ_PLAN.firstLineAtMs : AJ_TYPING_PLAN_CHAIN_GAP_MS}
                enabled={!reduceMotion ? index === lineIndex : true}
                onStart={() => handleLineStart(index)}
                onDone={() => handleLineDone(index)}
                style={{
                  display: !reduceMotion && index !== lineIndex ? 'none' : 'flex',
                  textAlign: 'center',
                  fontFamily: theme.fonts.ui,
                  fontSize: 16,
                  lineHeight: 23,
                  color: theme.colors.textSpeech,
                }}
              />
            ) : null
          ))}
        </View>
      </SafeAreaView>

      <AqSheet
        delay={reduceMotion ? 0 : AJ_PLAN.sheetRiseAtMs}
        reduceMotion={reduceMotion}
        onSheetLayout={setSheetHeight}
        style={{ paddingBottom: Math.max(34, insets.bottom + 16) }}
      >
        <AqSegmented
          role="tab"
          accessibilityLabel={t('plan:tabs.accessibility')}
          selectedId={tab}
          onSelect={(next) => {
            setTab(next as PlanTab);
            // Tapping a tab acknowledges, but never interrupts the narration.
            aj.play('nod');
          }}
          options={[
            { id: 'workout', label: t('plan:tabs.workout') },
            { id: 'diet', label: t('plan:tabs.diet') },
          ]}
          style={{ marginBottom: 20 }}
        />

        {/* Both panels occupy the same cell, so the sheet is as tall as the
            taller one and does not jump when the tab changes. */}
        <View>
          <PlanPanel active={tab === 'workout'} reduceMotion={reduceMotion}>
            <PlanPanelHeader
              title={prescription.status === 'SUCCESS'
                ? t(`plan:prescription.${prescriptionCopyKey}.title`)
                : t('plan:header.reviewTitle')}
              badge={t('plan:workoutPanel.frequencyBadge', { count: prescribedDays })}
              subtitle={t('plan:workoutPanel.subtitle', { goal: goalLabel, level: levelLabel })}
            />
            {revealed(1) ? (
              <View style={{ marginTop: 20 }}>
                <PlanWeekRow columns={weekColumns} />
              </View>
            ) : null}
            {revealed(2) ? (
              <View style={{ marginTop: 18, gap: 16 }}>
                <PlanStatsLine
                  parts={[
                    { value: t('plan:workoutPanel.statsFrequency', { count: prescribedDays }), label: '' },
                    { value: t('plan:workoutPanel.statsDuration', { minutes: durationMinutes }), label: '' },
                  ]}
                />
                <PlanLockedPreview
                  rows={Array.from({ length: LOCKED_ROW_COUNT }, (_, index) => ({
                    key: `workout-${index}`,
                    title: t('plan:workoutPanel.lockedRow', { index: index + 1 }),
                  }))}
                  footer={t('plan:workoutPanel.lockedFooter')}
                />
              </View>
            ) : null}
          </PlanPanel>

          <PlanPanel active={tab === 'diet'} reduceMotion={reduceMotion}>
            <PlanPanelHeader
              title={t('plan:dietPanel.title')}
              subtitle={categoryLabel
                ? draft.progressionPace
                  ? t('plan:dietPanel.subtitleWithPace', {
                      category: categoryLabel,
                      pace: tLoose(`nutrition:profile.questions.progressionPace.options.${draft.progressionPace}`),
                    })
                  : t('plan:dietPanel.subtitle', { category: categoryLabel })
                : null}
            />
            <View style={{ marginTop: 18, gap: 16 }}>
              <PlanStatsLine parts={dietSummaryParts} />
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
          </PlanPanel>
        </View>

        {narrationDone ? (
          <AqPrimaryButton
            glow
            label={t('plan:cta.label')}
            onPress={handleContinue}
            style={{ marginTop: 22, backgroundColor: theme.colors.primary }}
            textStyle={{ color: theme.colors.primaryForeground }}
          />
        ) : null}

        {narrationDone ? (
          <Text
            style={{
              marginTop: 12,
              textAlign: 'center',
              fontFamily: theme.fonts.mono,
              fontSize: 10,
              letterSpacing: 1.4,
              color: theme.colors.textLabelFaint,
            }}
          >
            {t('plan:cta.footer').toUpperCase()}
          </Text>
        ) : null}
      </AqSheet>
    </View>
  );
}

/**
 * One tab's panel. Both are always mounted and stacked in the same grid cell
 * so the sheet keeps the height of the taller one; the inactive one is
 * untouchable and hidden from assistive technology rather than unmounted.
 */
function PlanPanel({
  active,
  reduceMotion,
  children,
}: {
  active: boolean;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        active ? null : { position: 'absolute', top: 0, left: 0, right: 0 },
        { opacity: active ? 1 : 0 },
      ]}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}
      // `reduceMotion` is accepted so the cross-fade can be suppressed by the
      // caller's single source of truth rather than re-queried here.
      needsOffscreenAlphaCompositing={!reduceMotion}
    >
      {children}
    </View>
  );
}
