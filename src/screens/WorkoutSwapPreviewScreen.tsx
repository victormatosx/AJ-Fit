import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  AqMonoLabel,
  AqPrimaryButton,
  AqSheet,
} from '../components/ui/AcquisitionControls';
import {
  PlanPanelHeader,
  PlanStatsLine,
  PlanWeekRow,
} from '../components/plan/PlanPanels';
import { AjSpeechText } from '../components/aj/AjSpeechText';
import { AJ_PLAN, AJ_TYPING_MS_PER_CHAR, AJ_TYPING_PLAN_CHAIN_GAP_MS } from '../components/aj/ajMomentTiming';
import { useAjFunnelDirector } from '../components/onboarding/AjFunnelStage';
import { Icon } from '../components/ui/Icon';
import { SettingsDivider } from '../components/ui/SettingsSection';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import {
  AJ_EXPANDED_SIZE,
  AJ_SHEET_COLLAPSED_PADDING,
  AJ_SPEECH_BOTTOM_MARGIN,
  expandedSheetHeight,
  planFrequency,
  sessionMuscleGroups,
  swapPreviewWeek,
  workoutSwapComparison,
} from './workoutSwapPreview';
import { buildSwapNarration, type SwapNarrationSession } from './workoutSwapNarration';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';

/** AJ parked beside the header. His expanded geometry lives in the pure module. */
const AJ_CORNER_SIZE = 58;
const AJ_CORNER_INSET = 16;
const AJ_TOGGLE_MS = 300;

/**
 * "Apresentando seu novo plano" — the same moment the onboarding's
 * `PlanReadyScreen` is, reused for a program swap.
 *
 * Shares that screen's entire presentation vocabulary rather than restating
 * it: `AqSheet`'s rise, `AqMonoLabel`'s kicker, `PlanPanelHeader`,
 * `PlanWeekRow`, `PlanStatsLine`, `AqPrimaryButton`, `AjSpeechText` driven at
 * `AJ_TYPING_MS_PER_CHAR.plan`, and the same `AJ_PLAN` beats — AJ travels,
 * the sheet rises, he hops, then narrates one line per block, each line
 * revealing what it describes. AJ himself is the stage's single mascot
 * instance, positioned by `aj.direct()` exactly as `PlanReadyScreen` does
 * (`AjFunnelStepPose` has no `plan` entry on purpose, because that screen
 * directs him itself).
 *
 * Two deliberate differences from the onboarding original:
 *
 * 1. No diet. There is no second tab, so there is no `AqSegmented` either —
 *    a one-option segmented control is not a control. `PlanMacroColumn` and
 *    the diet panel are simply never rendered here. The onboarding screen is
 *    untouched and keeps both tabs.
 *
 * 2. The sessions are real. `PlanReadyScreen` shows `PlanLockedPreview`'s
 *    blurred rows because it is a pre-auth acquisition surface selling a plan
 *    the user does not have yet. Here the user already owns this plan, so the
 *    same slot carries the actual sessions, with every exercise, its sets,
 *    its reps and its prescribed rest.
 *
 * A pure VIEW, like `MyPlanScreen`: it receives both snapshots and renders
 * them. It never reads `prescription`/`schedule`, never calls an engine and
 * never writes — so it is structurally incapable of showing a stale plan.
 * `newPlan` is the exact snapshot the adaptation returned.
 */
export function WorkoutSwapPreviewScreen({
  previousPlan,
  newPlan,
  onDone,
}: {
  previousPlan: WorkoutProgramSnapshot;
  newPlan: WorkoutProgramSnapshot;
  onDone: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['treino', 'workout', 'myPlan', 'quiz']);
  const tLoose = t as unknown as LooseTranslate;
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const aj = useAjFunnelDirector();
  const { reduceMotion } = aj;

  const comparison = workoutSwapComparison(previousPlan, newPlan);
  const week = swapPreviewWeek(newPlan);
  const flexible = (newPlan.scheduleMode ?? 'fixed') === 'flexible';
  const frequency = planFrequency(newPlan);

  /* ── The new plan, resolved once ───────────────────────────────────────── */

  // `workoutExercisesFromPlan` throws on a catalog lookup miss. Same
  // degrade-gracefully contract as `NewPlanRevealScreen`: a bad exercise id
  // must only empty that session's list, never crash the presentation.
  const sessions = newPlan.sessions.map((session, index) => {
    let exercises: ReturnType<typeof workoutExercisesFromPlan> = [];
    try {
      exercises = workoutExercisesFromPlan(newPlan, i18n.language, index);
    } catch {
      // fall through with an empty list
    }
    const muscleGroups = sessionMuscleGroups(exercises).map((muscle) =>
      tLoose(`workout:muscleGroups.${muscle}`, { defaultValue: muscle }),
    );
    return {
      letter: String.fromCharCode(65 + index),
      name: resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName),
      muscleGroups,
      exercises,
    };
  });

  const narrationSessions: SwapNarrationSession[] = sessions.map((session) => ({
    letter: session.letter,
    muscleGroups: session.muscleGroups,
    exerciseCount: session.exercises.length,
    setCount: session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    restSeconds: session.exercises.map((exercise) => exercise.rest),
  }));

  const trainingWeekdays = week.filter((day) => day.state === 'TRAINING');
  const narrationLines = buildSwapNarration(tLoose, {
    firstName: firstNameOf(profile?.profile.name),
    comparison,
    scheduleMode: flexible ? 'flexible' : 'fixed',
    frequency,
    trainingDayLabels: trainingWeekdays.map((day) =>
      tLoose(`treino:agenda.weekday.${day.weekday}`),
    ),
    restDayCount: week.filter((day) => day.state === 'REST').length,
    split: newPlan.split,
    sessions: narrationSessions,
  });

  /* ── AJ: parked by default, narrates on demand ─────────────────────────
   * The plan is the point of this screen, so it is on screen complete from
   * the first frame and the CTA is live immediately — nothing waits on a
   * narration. AJ sits small in the corner, and only grows and explains the
   * plan if the user actually asks him to by tapping him.
   * ─────────────────────────────────────────────────────────────────────── */

  const [expanded, setExpanded] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const sheetTall = height;
  const sheetShort = expandedSheetHeight(height, insets.top);
  /**
   * The sheet's height, animated.
   *
   * `LayoutAnimation` is what this replaces: it does not reliably animate a
   * height change on `AqSheet`'s `Animated.View`, whose opacity and transform
   * are already native-driven — which is why the content used to teleport.
   * Driving an outer box myself keeps the two animations on separate nodes, so
   * there is no JS/native driver conflict, and the descent is a real movement
   * the eye can follow.
   */
  const sheetAnim = useRef(new Animated.Value(height)).current;
  const [openSession, setOpenSession] = useState<number | null>(0);
  const doneRef = useRef(false);
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

  // A dimension change (rotation, a resized window) must not leave the box
  // animated to a height that no longer matches the screen.
  useEffect(() => {
    sheetAnim.setValue(expanded ? sheetShort : sheetTall);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only on a real dimension change, never on the toggle itself (which animates)
  }, [sheetTall, sheetShort]);

  // Where AJ stands in each state. One source for both the pose handed to the
  // stage and the tap target drawn over him, so the two can never drift.
  const ajBox = expanded
    // Centred horizontally in the space the sheet just gave up — ~220pt of
    // clear room under him for the lines, on a 844pt screen.
    ? { size: AJ_EXPANDED_SIZE, x: (width - AJ_EXPANDED_SIZE) / 2, y: insets.top + 16 }
    // Collapsed he stands at the right edge of the title row — the spot the
    // frequency badge used to occupy before it moved beside the title.
    : { size: AJ_CORNER_SIZE, x: width - AJ_CORNER_SIZE - AJ_CORNER_INSET, y: insets.top + 24 };

  useEffect(() => {
    aj.direct({ x: ajBox.x, y: ajBox.y, size: ajBox.size, rotate: 0 });
  }, [aj, ajBox.x, ajBox.y, ajBox.size]);

  const toggleAj = () => {
    setExpanded((open) => {
      const next = !open;
      const toValue = next ? sheetShort : sheetTall;
      if (reduceMotion) {
        sheetAnim.setValue(toValue);
      } else {
        Animated.timing(sheetAnim, {
          toValue,
          duration: AJ_TOGGLE_MS,
          easing: Easing.out(Easing.cubic),
          // Height is not a transform; this one cannot run on the native
          // driver, which is exactly why it lives on its own node.
          useNativeDriver: false,
        }).start();
      }
      if (next) {
        // Every expansion replays the explanation from its first line.
        setLineIndex(0);
        aj.play('nod');
      } else {
        aj.setTalking(false);
        aj.setMood('idle');
      }
      return next;
    });
  };

  const handleLineStart = () => {
    aj.setTalking(true);
    aj.setMood('talk');
  };

  const handleLineDone = (index: number) => {
    aj.setTalking(false);
    if (index >= narrationLines.length - 1) {
      aj.setMood('happy');
      return;
    }
    aj.play('nod');
    later(() => setLineIndex(index + 1), AJ_PLAN.lineSettleMs);
  };

  const handleContinue = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (reduceMotion) {
      onDone();
      return;
    }
    aj.play('hop');
    later(onDone, AJ_PLAN.ctaContinueAtMs);
  };

  const weekColumns = flexible || week.length === 0
    ? sessions.map((session, index) => ({
        key: `slot-${index}`,
        // Flexible training has no weekdays to show, so the columns become the
        // session sequence itself — the one honest rendering of "whenever you
        // can": which workout comes next, without claiming a day for it.
        label: String(index + 1),
        active: true,
        badge: session.letter,
      }))
    : week.map((day) => ({
        key: day.weekday,
        label: tLoose(`treino:agenda.weekday.${day.weekday}`),
        active: day.state !== 'REST',
        // The letter the plan itself sealed onto this weekday
        // (`weeklySchedule[].sessionIndex`) — the very session the user trains
        // that day, never a position guessed from the list's order.
        badge: day.sessionIndex !== null ? String.fromCharCode(65 + day.sessionIndex) : null,
      }));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        // Expanded, the sheet is pushed to the bottom: that is what actually
        // moves the content down and frees the top of the screen for AJ.
        // Without this it keeps its place at the top and he talks over it.
        justifyContent: expanded ? 'flex-end' : undefined,
      }}
    >
      {/* AJ's lines, only once he has been asked for them. Above the sheet in
          the stacking order, so they are readable over it. */}
      {expanded ? (
        <View
          style={{
            position: 'absolute',
            top: ajBox.y + ajBox.size + 18,
            left: 26,
            right: 26,
            // Stops at the sheet's top edge: the lines occupy the freed area,
            // they never spill over the plan.
            bottom: sheetShort + AJ_SPEECH_BOTTOM_MARGIN,
            justifyContent: 'flex-start',
            zIndex: 2,
          }}
        >
          {narrationLines.map((line, index) => (
            index <= lineIndex || reduceMotion ? (
              <AjSpeechText
                key={line}
                text={line}
                msPerChar={AJ_TYPING_MS_PER_CHAR.plan}
                reduceMotion={reduceMotion}
                // No opening delay here: the user just asked, so he answers.
                startDelayMs={index === 0 ? 0 : AJ_TYPING_PLAN_CHAIN_GAP_MS}
                enabled={!reduceMotion ? index === lineIndex : true}
                onStart={handleLineStart}
                onDone={() => handleLineDone(index)}
                style={{
                  display: !reduceMotion && index !== lineIndex ? 'none' : 'flex',
                  textAlign: 'center',
                  fontFamily: theme.fonts.ui,
                  fontSize: 15.5,
                  lineHeight: 22,
                  color: theme.colors.textSpeech,
                }}
              />
            ) : null
          ))}
        </View>
      ) : null}

      {/* The stage draws AJ in a `pointerEvents="none"` overlay, so his tap
          target is this transparent box laid over the exact same pose. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(expanded
          ? 'treino:swapPresentation.ajCollapseAccessibility'
          : 'treino:swapPresentation.ajExpandAccessibility')}
        onPress={toggleAj}
        hitSlop={10}
        style={{
          position: 'absolute',
          left: ajBox.x,
          top: ajBox.y,
          width: ajBox.size,
          height: ajBox.size,
          zIndex: 3,
        }}
      />

      {/* The animated box. Its height is what descends; `AqSheet` fills it and
          keeps its own entrance animation on its own node. The top padding
          rides the same driver, so the heading travels with the edge rather
          than jumping to a new inset. */}
      <Animated.View
        style={{
          height: sheetAnim,
          paddingTop: sheetAnim.interpolate({
            inputRange: [sheetShort, sheetTall],
            outputRange: [AJ_SHEET_COLLAPSED_PADDING, insets.top + 10],
            extrapolate: 'clamp',
          }),
        }}
      >
        <AqSheet
          // The sheet IS the screen here: it starts at the very top, so it keeps
          // no rounded edge, no top border and no grab handle. `delay={0}`
          // because the plan is the screen, not a reward for waiting.
          flush
          delay={0}
          reduceMotion={reduceMotion}
          style={{
            flex: 1,
            paddingTop: 0,
            paddingBottom: Math.max(34, insets.bottom + 16),
          }}
        >
          <ScrollView
            // `flex: 1`, not a content-sized box: the scroll takes every point
            // the sheet has left over, which is what keeps the CTA below it
            // pinned to the sheet's bottom edge. Sized to its content instead,
            // a short plan would leave the button floating mid-screen.
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 4 }}
            showsVerticalScrollIndicator={false}
          >
            {/* The heading scrolls with the plan — it is the top of the content,
                not a fixed bar over it. */}
            <AqMonoLabel color={theme.colors.textLabelQuiet}>
              {t('treino:swapPresentation.kicker')}
            </AqMonoLabel>

            <View style={{ marginTop: 10, marginBottom: 20 }}>
              <PlanPanelHeader
                title={t('treino:swapPresentation.panelTitle')}
                badge={t('treino:swapPresentation.frequencyBadge', { count: frequency })}
                // The badge rides beside the title; the row's right edge is AJ's
                // while he is parked there.
                badgeInline
                reserveRight={expanded ? undefined : AJ_CORNER_SIZE + 10}
                subtitle={t('treino:swapPresentation.panelSubtitle', { split: newPlan.split })}
              />
            </View>

            <PlanWeekRow columns={weekColumns} />

            <View style={{ marginTop: 18 }}>
              <PlanStatsLine
                parts={[
                  { value: t('treino:swapPresentation.statsSessions', { count: sessions.length }), label: '' },
                  {
                    value: t('treino:swapPresentation.statsExercises', {
                      count: narrationSessions.reduce((sum, s) => sum + s.exerciseCount, 0),
                    }),
                    label: '',
                  },
                ]}
              />
            </View>

            <View style={{ marginTop: 18, gap: 8 }}>
              {sessions.map((session, index) => (
                <SwapSessionRow
                  key={`${session.name}-${index}`}
                  letter={session.letter}
                  sessionName={session.name}
                  muscleGroups={session.muscleGroups}
                  exercises={session.exercises}
                  expanded={openSession === index}
                  onToggle={() => setOpenSession(openSession === index ? null : index)}
                  tLoose={tLoose}
                />
              ))}
            </View>
          </ScrollView>

          {/* Live from the first frame — nothing about continuing depends on AJ
              having spoken. */}
          <AqPrimaryButton
            glow
            label={t('treino:swapPresentation.cta')}
            onPress={handleContinue}
            style={{ marginTop: 20, backgroundColor: theme.colors.primary }}
            textStyle={{ color: theme.colors.primaryForeground }}
          />
        </AqSheet>
      </Animated.View>
    </View>
  );
}

/** First word of the stored profile name — AJ greets, he does not read a form. */
function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/**
 * One session of the new plan. Occupies the slot `PlanReadyScreen` fills with
 * `PlanLockedPreview`'s blurred rows, but with the real thing: the division
 * letter, the session name, its muscle groups, and — expanded — every
 * exercise with its sets, reps/duration and prescribed rest, read from the
 * same `workoutExercisesFromPlan` values and the same `myPlan:workouts.*`
 * copy `MyPlanScreen` uses.
 */
function SwapSessionRow({
  letter,
  sessionName,
  muscleGroups,
  exercises,
  expanded,
  onToggle,
  tLoose: t,
}: {
  letter: string;
  sessionName: string;
  muscleGroups: readonly string[];
  exercises: ReturnType<typeof workoutExercisesFromPlan>;
  expanded: boolean;
  onToggle: () => void;
  tLoose: LooseTranslate;
}) {
  const { theme } = useTheme();
  const chevronRot = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevronRot, { toValue: expanded ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [expanded, chevronRot]);
  const rotate = chevronRot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <View
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceQuiet,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(expanded ? 'myPlan:workouts.hideWorkout' : 'myPlan:workouts.viewWorkout')}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.primarySoft,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.display, fontSize: 15, color: theme.colors.primaryEmphasis }}>
            {letter}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}
            numberOfLines={1}
          >
            {sessionName}
          </Text>
          <Text
            style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}
            numberOfLines={2}
          >
            {muscleGroups.length > 0
              ? `${muscleGroups.join(' · ')} — ${t('myPlan:workouts.exerciseCount', { count: exercises.length })}`
              : t('myPlan:workouts.exerciseCount', { count: exercises.length })}
          </Text>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Icon name="chevron-right" size={15} color={theme.colors.textFaint} />
        </Animated.View>
      </Pressable>

      {expanded ? (
        <View>
          <SettingsDivider />
          <View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            {exercises.map((exercise, exIndex) => {
              const reps = exercise.sets[0]?.r ?? '';
              const isDuration = /s$|min$/i.test(reps.trim());
              return (
                <View
                  key={`${exercise.id}-${exIndex}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 10,
                    borderTopWidth: exIndex === 0 ? 0 : 1,
                    borderTopColor: theme.colors.divider,
                  }}
                >
                  <Text style={{ width: 17, fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.textFaint }}>
                    {String(exIndex + 1).padStart(2, '0')}
                  </Text>
                  <Text
                    style={{ flex: 1, fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}
                    numberOfLines={2}
                  >
                    {exercise.name}
                  </Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 12, color: theme.colors.textSecondary }}>
                      {t(isDuration ? 'myPlan:workouts.setsDuration' : 'myPlan:workouts.setsReps', {
                        sets: exercise.sets.length,
                        reps,
                        duration: reps,
                      })}
                    </Text>
                    {exercise.rest > 0 ? (
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 10.5, color: theme.colors.textFaint, marginTop: 1 }}>
                        {t('myPlan:workouts.rest', { seconds: exercise.rest })}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
