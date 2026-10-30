import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { useTheme, type AppTheme } from '../theme';
import { useReducedMotionPreference } from '../lib/reducedMotion';
import { buildTreinoWeekStrip } from '../home/treinoWeekStrip';
import { completedTodayNextLabel } from './completedTodayNote';
import {
  isWeeklyScheduleComplete,
  selectFixedSchedule,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../onboarding/weeklyScheduleSelection';
import {
  AGENDA_MAX_DAYS,
  AGENDA_MIN_DAYS,
  agendaNextWorkoutTarget,
  agendaSelectionChanged,
  agendaSheetWeek,
  agendaSummaryKind,
  sessionSequenceLabel,
  type AgendaSheetDay,
} from './treinoAgendaPresentation';
import { agendaChangeRequiresAdaptation } from './treinoAgendaPolicy';
import type { ScheduleMode, Weekday } from '../state/AppState';
import type { LocalDate } from '../scheduleEngine/calendar';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { FinalWorkoutSession } from '../workoutPrescription/types';
import type { WeekOverviewViewModel } from '../home/weekOverview';

export type AgendaSaveOutcome = 'OK' | 'ERROR';

/** Sheet rise / full-screen rise, in points — fade-only under Reduce Motion. */
const ENTRANCE_TRAVEL_Y = 14;
const BACKDROP_FADE_MS = 200;
const SHEET_ENTRANCE_MS = 300;
const NEW_SPLIT_ENTRANCE_MS = 250;
/** Selected/unselected circle cross-fade. */
const CIRCLE_TRANSITION_MS = 150;
/** Day grid dim while the flexible mode is on. */
const GRID_DIM_MS = 200;
const GRID_DIM_OPACITY = 0.3;
/** Short phones (iPhone SE class) shrink the circles and the frequency numerals. */
const SMALL_SCREEN_MAX_HEIGHT = 667;

/**
 * Editar agenda (docs §Alteração de agenda). Reuses the onboarding's own
 * pure selection helpers (`weeklyScheduleSelection.ts`) verbatim — the user
 * only ever answers "which days do you want to train", never sees
 * `template`/`programInstance`/`ScheduleState` concepts. The weekday grid
 * below is a Treino-specific restyle (entrega-agenda §3.2), deliberately NOT
 * the shared `WeeklySchedulePicker` component — reusing that one here would
 * also restyle onboarding's own schedule question.
 * Whether the save is a same-frequency agenda edit (`saveScheduleConfig`,
 * never touches the program) or a real frequency change
 * (`adaptWorkoutProgram`, regenerates the division) is decided here,
 * transparently, by comparing the selected day count against the program's
 * current prescribed frequency — never by the user picking a mode.
 *
 * The day numbers and the letter under each circle come from the very same
 * `buildTreinoWeekStrip` view model the faixa da semana renders, so the week
 * the user just tapped is the week the sheet opens on. The letters disappear
 * as soon as the selection stops matching the saved schedule: which session
 * each day would then carry is the Schedule Engine's answer for a schedule
 * that does not exist yet, and this sheet never guesses it.
 */
export function TreinoAgendaSheet({
  initialScheduleMode,
  initialTrainingDays,
  currentFrequency,
  maxDays = AGENDA_MAX_DAYS,
  weekOverview,
  sessions,
  resolution,
  nextSessionIndex,
  todayLocalDate,
  onClose,
  onSave,
  onChangeFrequency,
}: {
  initialScheduleMode: ScheduleMode;
  initialTrainingDays: Weekday[];
  currentFrequency: number;
  /**
   * Weekly ceiling for the account's CURRENT lifecycle level
   * (`weeklyDayAllowance.maxWeeklyDaysForTrainingLevel`). Defaults to the
   * uncapped 7, so any caller that does not pass it keeps today's behaviour
   * byte-for-byte.
   */
  maxDays?: number;
  /** The Schedule Engine's own week — the sheet's day numbers, never a second calendar. */
  weekOverview: WeekOverviewViewModel | null;
  /** `plan.sessions`, for the division letters and the flexible sequence. */
  sessions: readonly FinalWorkoutSession[];
  resolution: ScheduleResolution | null;
  /** `effectiveNextSessionIndex(resolution)` — the rotation's current cursor. */
  nextSessionIndex: number | null;
  todayLocalDate: LocalDate;
  onClose: () => void;
  onSave: (value: { scheduleMode: ScheduleMode; trainingDays: Weekday[] }) => Promise<AgendaSaveOutcome>;
  onChangeFrequency: (value: { scheduleMode: ScheduleMode; trainingDays: Weekday[]; days: number }) => Promise<AgendaSaveOutcome>;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('treino');
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotionPreference();
  const [value, setValue] = useState<WeeklyScheduleValue>({
    days: initialScheduleMode === 'fixed' ? (initialTrainingDays.length || null) : currentFrequency,
    scheduleMode: initialScheduleMode,
    trainingDays: initialScheduleMode === 'fixed' ? initialTrainingDays : null,
  });
  const [step, setStep] = useState<'edit' | 'confirmFrequency'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const flexible = value.scheduleMode === 'flexible';
  const selectedDays = value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [];
  const newCount = flexible ? value.days ?? currentFrequency : selectedDays.length;
  const complete = isWeeklyScheduleComplete(value, maxDays);
  const frequencyChanged = agendaChangeRequiresAdaptation(value, currentFrequency);
  const canSave = complete && !submitting;
  // Design §3.5: a selection identical to what is saved keeps the button
  // blocked. It only ever suppresses a save that would rewrite the schedule
  // it just read — the validity rule above is untouched.
  const selectionChanged = agendaSelectionChanged(value, {
    scheduleMode: initialScheduleMode,
    trainingDays: initialTrainingDays,
    frequency: currentFrequency,
  });
  const canSubmit = canSave && selectionChanged;

  const handleSavePress = () => {
    setError(false);
    if (!canSubmit) return;
    if (frequencyChanged) {
      setStep('confirmFrequency');
      return;
    }
    void commitAgendaOnly();
  };

  const commitAgendaOnly = async () => {
    setSubmitting(true);
    setError(false);
    try {
      const outcome = await onSave({
        scheduleMode: value.scheduleMode ?? 'fixed',
        trainingDays: value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [],
      });
      if (outcome === 'OK') onClose();
      else setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const commitFrequencyChange = async () => {
    setSubmitting(true);
    setError(false);
    try {
      const outcome = await onChangeFrequency({
        scheduleMode: value.scheduleMode ?? 'fixed',
        trainingDays: value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [],
        days: newCount,
      });
      if (outcome === 'OK') onClose();
      else setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  /** Back out of "Nova divisão" with the selection intact. */
  const backToEdit = () => {
    setError(false);
    setStep('edit');
  };

  // Letters are only honest while the selection still matches what the engine
  // resolved this week against (see the component's doc comment).
  const lettersVisible = !flexible && !selectionChanged;
  const weekDays = useMemo<AgendaSheetDay[]>(() => agendaSheetWeek({
    stripDays: weekOverview
      ? buildTreinoWeekStrip({
          overview: weekOverview,
          todayLocalDate,
          scheduleMode: initialScheduleMode,
          trainingDays: initialTrainingDays,
          sessions,
          resolution,
          nextSessionIndex,
        })
      : [],
    todayLocalDate,
    lettersVisible,
  }), [
    weekOverview, todayLocalDate, initialScheduleMode, initialTrainingDays,
    sessions, resolution, nextSessionIndex, lettersVisible,
  ]);

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const nextWorkoutTarget = agendaNextWorkoutTarget(resolution);
  const nextWorkoutDate = nextWorkoutTarget === null
    ? null
    : nextWorkoutTarget.kind === 'TODAY' ? todayLocalDate : nextWorkoutTarget.localDate;
  const nextWorkoutLabel = lettersVisible
    ? completedTodayNextLabel({
        nextWorkoutDate,
        todayLocalDate,
        todayLabel: t('agenda.today'),
        tomorrowLabel: t('agenda.tomorrow'),
        locale,
      })
    : null;

  // Live preview of what Salvar/Continuar will do — purely a restatement of
  // already-real state (`complete`/`frequencyChanged`/`newCount`), never a
  // second validation rule.
  const summaryKind = agendaSummaryKind({ flexible, complete, frequencyChanged });
  // At the level's own ceiling the status line explains why the next day does
  // not latch — same Text, same slot, same style, only the message differs.
  // Reported for every level (3 for beginners, 6 for the rest). Deliberately
  // the LAST branch: an invalid range still blocks Salvar and a frequency
  // change still has to announce itself, so neither is displaced by a hint.
  const atMaximum = !flexible && complete && selectedDays.length >= maxDays;
  const summaryText =
    summaryKind === 'INVALID' ? t('agenda.liveInvalidRange', { min: AGENDA_MIN_DAYS, max: maxDays }) :
    summaryKind === 'FLEXIBLE' ? t('agenda.liveFlexible', { sequence: sessionSequenceLabel(sessions.length) }) :
    summaryKind === 'FREQUENCY_CHANGE' ? t('agenda.liveFrequencyChange', { from: currentFrequency, to: newCount }) :
    atMaximum ? t('agenda.liveMaximumReached', { max: maxDays }) :
    nextWorkoutLabel ? t('agenda.liveSameFrequencyNext', { count: newCount, when: nextWorkoutLabel }) :
    t('agenda.liveSameFrequency', { count: newCount });
  const summaryColor =
    summaryKind === 'INVALID' ? theme.colors.warning :
    summaryKind === 'FREQUENCY_CHANGE' ? theme.colors.textPrimary :
    theme.colors.textInactive;

  const compact = windowHeight <= SMALL_SCREEN_MAX_HEIGHT;
  const circleSize = compact ? 32 : 36;

  const backdropOpacity = useSharedValue(0);
  const sheetEntrance = useSharedValue(0);
  const newSplitEntrance = useSharedValue(0);
  const gridOpacity = useSharedValue(flexible ? GRID_DIM_OPACITY : 1);

  useEffect(() => {
    backdropOpacity.value = withTiming(1, { duration: BACKDROP_FADE_MS });
    sheetEntrance.value = withTiming(1, {
      duration: reducedMotion ? BACKDROP_FADE_MS : SHEET_ENTRANCE_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [backdropOpacity, sheetEntrance, reducedMotion]);

  useEffect(() => {
    if (step !== 'confirmFrequency') {
      newSplitEntrance.value = 0;
      return;
    }
    newSplitEntrance.value = withTiming(1, {
      duration: reducedMotion ? BACKDROP_FADE_MS : NEW_SPLIT_ENTRANCE_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [step, newSplitEntrance, reducedMotion]);

  useEffect(() => {
    gridOpacity.value = withTiming(flexible ? GRID_DIM_OPACITY : 1, {
      duration: reducedMotion ? 0 : GRID_DIM_MS,
    });
  }, [flexible, gridOpacity, reducedMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: sheetEntrance.value,
    transform: [{ translateY: (1 - sheetEntrance.value) * (reducedMotion ? 0 : ENTRANCE_TRAVEL_Y) }],
  }));
  const newSplitStyle = useAnimatedStyle(() => ({
    opacity: newSplitEntrance.value,
    transform: [{ translateY: (1 - newSplitEntrance.value) * (reducedMotion ? 0 : ENTRANCE_TRAVEL_Y) }],
  }));
  const gridStyle = useAnimatedStyle(() => ({ opacity: gridOpacity.value }));

  const primaryButtonStyle = {
    width: '100%' as const,
    paddingVertical: 17,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: 10,
    backgroundColor: theme.colors.primary,
  };
  const primaryLabelStyle = {
    color: theme.colors.primaryForeground,
    fontFamily: theme.fonts.uiSemi,
    fontSize: 16,
  };
  const footerLinkStyle = {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.uiSemi,
    fontSize: 13.5,
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={submitting ? undefined : step === 'edit' ? onClose : backToEdit}
      statusBarTranslucent
    >
      {step === 'edit' ? (
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('agenda.accessibilityClose')}
              onPress={submitting ? undefined : onClose}
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlayStrong }]}
            />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            style={[
              {
                maxHeight: '88%',
                backgroundColor: theme.colors.sheetBackground,
                borderTopLeftRadius: 22,
                borderTopRightRadius: 22,
                borderTopWidth: 1,
                borderColor: theme.colors.divider,
              },
              sheetStyle,
            ]}
          >
            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 24, paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={{
                width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20,
                backgroundColor: theme.colors.indicatorRest,
              }} />
              {/* Anton, like every other title in the app (`Display`) — the
                  spec's 20/700 Archivo would have been the one headline in
                  Treino not set in the display face. */}
              <Display size={24} skew={false}>
                {t('agenda.sheetHeading')}
              </Display>
              <Text style={{
                color: theme.colors.textInactive, fontFamily: theme.fonts.ui,
                // 2, not the spec's 6: Anton's line box already carries the
                // remaining space under the title.
                fontSize: 13.5, lineHeight: 20, marginTop: 2,
              }}>
                {t('agenda.sheetInstruction')}
              </Text>

              <Animated.View style={[{ flexDirection: 'row', marginTop: 28 }, gridStyle]}>
                {weekDays.map((day) => (
                  <AgendaDayCircle
                    key={day.localDate}
                    day={day}
                    size={circleSize}
                    selected={selectedDays.includes(day.weekday)}
                    disabled={flexible || submitting}
                    reducedMotion={reducedMotion}
                    theme={theme}
                    weekdayLabel={t(`agenda.weekday.${day.weekday}`)}
                    accessibilityLabel={t('agenda.dayAccessibilityLabel', {
                      weekday: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
                        .format(new Date(`${day.localDate}T12:00:00Z`)),
                      day: day.dayNumber,
                    })}
                    onPress={() => setValue(toggleFixedTrainingDay(value, day.weekday, maxDays))}
                  />
                ))}
              </Animated.View>

              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: summaryColor, fontFamily: theme.fonts.ui, fontSize: 13.5,
                  lineHeight: 20, textAlign: 'center', marginTop: 18,
                }}
              >
                {summaryText}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: flexible }}
                disabled={submitting}
                onPress={() => setValue(flexible ? selectFixedSchedule() : selectFlexibleSchedule(value, maxDays))}
                style={{ alignSelf: 'center', paddingVertical: 4, marginTop: 14 }}
              >
                <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.uiSemi, fontSize: 13 }}>
                  {flexible ? t('agenda.fixedModeLink') : t('agenda.freeModeLink')}
                </Text>
              </Pressable>

              {error && (
                <Text style={{
                  color: theme.colors.danger, fontFamily: theme.fonts.ui, fontSize: 12,
                  textAlign: 'center', marginTop: 10,
                }}>
                  {t('agenda.error')}
                </Text>
              )}
            </ScrollView>

            <View style={{ paddingTop: 14, paddingHorizontal: 24, paddingBottom: 30 + insets.bottom }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit }}
                onPress={handleSavePress}
                disabled={!canSubmit}
                style={[primaryButtonStyle, { opacity: canSubmit ? 1 : 0.4 }]}
              >
                <Text style={primaryLabelStyle}>
                  {submitting
                    ? t('agenda.saving')
                    : frequencyChanged ? t('agenda.continueAction') : t('agenda.saveShort')}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      ) : (
        <Animated.View
          accessibilityViewIsModal
          style={[{ flex: 1, backgroundColor: theme.colors.background }, newSplitStyle]}
        >
          <View style={{
            paddingTop: insets.top + 11, paddingHorizontal: 14, paddingBottom: 6,
            flexDirection: 'row', alignItems: 'center',
          }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('agenda.newSplitBackAccessibility')}
              onPress={backToEdit}
              disabled={submitting}
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
            >
              {/* `chevron-left` is the mirrored shared `chevron-right` — the
                  icon set is shared with other screens and gains no new glyph
                  for this surface. */}
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <Icon name="chevron-right" size={22} color={theme.colors.textPrimary} />
              </View>
            </Pressable>
            <Text style={{
              flex: 1, textAlign: 'center', color: theme.colors.textPrimary,
              fontFamily: theme.fonts.uiSemi, fontSize: 16,
            }}>
              {t('agenda.newSplitTitle')}
            </Text>
            <View style={{ width: 42 }} />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: 'center', marginTop: 24 }}>
              <CapLabel theme={theme}>{t('agenda.frequencyLabel')}</CapLabel>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 10 }}>
                <Display
                  size={compact ? 40 : 44}
                  skew={false}
                  color={theme.colors.textFaint}
                  style={{ lineHeight: Math.round((compact ? 40 : 44) * 1.2) }}
                >
                  {`${currentFrequency}×`}
                </Display>
                <Icon name="arrow-right" size={18} color={theme.colors.iconMuted} />
                <Display
                  size={compact ? 46 : 52}
                  skew={false}
                  style={{ lineHeight: Math.round((compact ? 46 : 52) * 1.2) }}
                >
                  {`${newCount}×`}
                </Display>
              </View>
              <Text style={{
                color: theme.colors.textInactive, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 8,
              }}>
                {t('agenda.perWeek')}
              </Text>
              <Text style={{
                color: theme.colors.textSubtle, fontFamily: theme.fonts.ui, fontSize: 14,
                lineHeight: 22, marginTop: 18, textAlign: 'center',
              }}>
                {t('agenda.frequencyChangeBody', { from: currentFrequency, to: newCount })}
              </Text>
            </View>

            <View style={{ marginTop: 32 }}>
              <CapLabel theme={theme}>{t('agenda.keepsTitle')}</CapLabel>
              <View style={{ marginTop: 6 }}>
                {[t('agenda.keepsHistory'), t('agenda.keepsCycle')].map((item, index) => (
                  <OutcomeRow key={item} theme={theme} text={item} kind="keeps" first={index === 0} />
                ))}
              </View>
            </View>

            <View style={{ marginTop: 24 }}>
              <CapLabel theme={theme}>{t('agenda.changesTitle')}</CapLabel>
              <View style={{ marginTop: 6 }}>
                {[t('agenda.changesExercises'), t('agenda.changesDays')].map((item, index) => (
                  <OutcomeRow key={item} theme={theme} text={item} kind="changes" first={index === 0} />
                ))}
              </View>
            </View>

            {error && (
              <Text style={{
                color: theme.colors.danger, fontFamily: theme.fonts.ui, fontSize: 12,
                textAlign: 'center', marginTop: 18,
              }}>
                {t('agenda.error')}
              </Text>
            )}
          </ScrollView>

          <View style={{
            paddingTop: 14, paddingHorizontal: 24, paddingBottom: 30 + insets.bottom,
            borderTopWidth: 1, borderColor: theme.colors.border,
          }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
              onPress={commitFrequencyChange}
              disabled={submitting}
              style={[primaryButtonStyle, { opacity: submitting ? 0.75 : 1 }]}
            >
              {submitting && <ActivityIndicator size="small" color={theme.colors.primaryForeground} />}
              <Text style={primaryLabelStyle}>
                {submitting ? t('agenda.newSplitGenerating') : t('agenda.newSplitConfirm')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={backToEdit}
              disabled={submitting}
              style={{ alignSelf: 'center', paddingVertical: 4, marginTop: 14 }}
            >
              <Text style={footerLinkStyle}>{t('agenda.newSplitBack')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </Modal>
  );
}

/** Mono all-caps section label (`cap`), shared by every block of "Nova divisão". */
function CapLabel({ theme, children }: { theme: AppTheme; children: ReactNode }) {
  return (
    <Text style={{
      fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.6,
      textTransform: 'uppercase', color: theme.colors.textFaint,
    }}>
      {children}
    </Text>
  );
}

/** One "o que continua" / "o que muda" line. */
function OutcomeRow({
  theme,
  text,
  kind,
  first,
}: {
  theme: AppTheme;
  text: string;
  kind: 'keeps' | 'changes';
  first: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
      borderTopWidth: first ? 0 : 1, borderColor: theme.colors.border,
    }}>
      <Icon
        name={kind === 'keeps' ? 'check' : 'swap'}
        size={14}
        stroke={2.2}
        color={kind === 'keeps' ? theme.colors.primaryEmphasis : theme.colors.iconMuted}
      />
      <Text style={{
        flex: 1, color: theme.colors.textEmphasis, fontFamily: theme.fonts.ui,
        fontSize: 14, lineHeight: 20,
      }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * One day of the grid: weekday initials, the day-of-month circle and the
 * division letter slot (kept at a fixed height so the row never reflows when
 * a letter appears or disappears).
 */
function AgendaDayCircle({
  day,
  size,
  selected,
  disabled,
  reducedMotion,
  theme,
  weekdayLabel,
  accessibilityLabel,
  onPress,
}: {
  day: AgendaSheetDay;
  size: number;
  selected: boolean;
  disabled: boolean;
  reducedMotion: boolean;
  theme: AppTheme;
  weekdayLabel: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, {
      duration: reducedMotion ? 0 : CIRCLE_TRANSITION_MS,
    });
  }, [selected, progress, reducedMotion]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.colors.borderStrong, theme.colors.inverseSurface],
    ),
  }));

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 8 }}
    >
      <Text style={{
        fontFamily: theme.fonts.mono, fontSize: 8.5, letterSpacing: 0.8,
        color: day.isToday ? theme.colors.textPrimary : theme.colors.textFaint,
      }}>
        {weekdayLabel}
      </Text>
      <Animated.View
        style={[
          {
            width: size, height: size, borderRadius: size / 2,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, overflow: 'hidden',
          },
          borderStyle,
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.colors.inverseSurface },
            fillStyle,
          ]}
        />
        <Text style={{
          fontFamily: theme.fonts.uiSemi, fontSize: 14,
          color: selected ? theme.colors.inverseForeground : theme.colors.textFaint,
        }}>
          {day.dayNumber}
        </Text>
      </Animated.View>
      <View style={{ height: 12, alignItems: 'center', justifyContent: 'center' }}>
        {day.letter && (
          <Text style={{
            fontFamily: theme.fonts.mono, fontSize: 9, letterSpacing: 0.6,
            color: theme.colors.primaryEmphasis,
          }}>
            {day.letter}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
