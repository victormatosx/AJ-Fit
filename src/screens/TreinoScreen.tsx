import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { BodyMuscleMap } from '../components/fitness/BodyMuscleMap';
import { HudCorners } from '../components/ui/Card';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useTheme } from '../theme';
import { localDateInTimezone, weekdayOfLocalDate } from '../scheduleEngine';
import { WEEKDAY_ORDER } from '../state/AppState';
import type { Sex } from '../state/AppState';
import { deriveSessionMuscles } from '../lib/sessionMuscles';
import { effectiveNextSessionIndex } from '../scheduleEngine/effectiveNextSessionIndex';
import { treinoCardSession } from './treinoCardSession';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { ScheduleConfig, ScheduleResolution } from '../scheduleEngine/types';

export type RepositionOutcome = 'OK' | 'BLOCKED_IN_PROGRESS' | 'ALREADY_COMPLETED_TODAY' | 'ERROR';

export interface TreinoWeekSummary {
  completedCount: number;
  scheduledCount: number;
}

/**
 * TREINO hub (docs §Nova tela TREINO). The Schedule Engine's own resolution
 * is the only source for "what's next" — this screen never recomputes or
 * guesses it, only renders `resolution`/`plan.sessions` and forwards intent
 * (start / reposition / edit agenda) to callbacks the caller (`AppShell`)
 * wires to the real authoritative flows.
 */
export function TreinoScreen({
  sex,
  plan,
  resolution,
  completedTodaySessionIndex,
  scheduleConfig,
  workoutInProgress,
  startPending,
  onStart,
  onOpenAgendaEditor,
  onReposition,
  weekSummary,
  last30DaysCompletedCount,
}: {
  sex: Sex;
  plan: FinalWorkoutPlan;
  resolution: ScheduleResolution;
  completedTodaySessionIndex: number | null;
  scheduleConfig: ScheduleConfig | null;
  workoutInProgress: boolean;
  startPending: boolean;
  onStart: () => void;
  onOpenAgendaEditor: () => void;
  onReposition: (targetSessionIndex: number) => Promise<RepositionOutcome>;
  weekSummary: TreinoWeekSummary | null;
  last30DaysCompletedCount: number | null;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('treino');
  const { t: tHome } = useTranslation('home');
  const tLoose = tHome as unknown as LooseTranslate;
  const [changeSheetOpen, setChangeSheetOpen] = useState(false);
  const { width } = useWindowDimensions();

  const nextIndex = effectiveNextSessionIndex(resolution);
  const displayedSession = treinoCardSession(plan.sessions, resolution, completedTodaySessionIndex);
  const displayedIndex = resolution.status === 'TODAY_COMPLETED' ? completedTodaySessionIndex : nextIndex;
  // Same actionable-CTA set as Home's own "todayCard" (docs §Consistência com
  // Meu Plano): MISSED_SESSION_DECISION_REQUIRED keeps the normal "Iniciar
  // treino" affordance — the decision itself is only asked once the user
  // taps it (`requestStartWorkout`'s own branch), never surfaced here as a
  // second, competing flow.
  const canStartNow = workoutInProgress
    || resolution.status === 'SESSION_READY'
    || resolution.status === 'MISSED_SESSION_DECISION_REQUIRED';
  const isFlexible = (scheduleConfig?.scheduleMode ?? 'fixed') === 'flexible';

  const statusCopyKey =
    resolution.status === 'REST_DAY' ? 'restDay' :
    resolution.status === 'ACTIVE_RECOVERY_DAY' ? 'activeRecovery' :
    resolution.status === 'TODAY_COMPLETED' ? 'completedToday' :
    resolution.status === 'SCHEDULE_SETUP_REQUIRED' ? 'setupRequired' :
    resolution.status === 'MISSED_SESSION_DECISION_REQUIRED' ? 'missedDecision' :
    null;

  const exerciseCount = displayedSession?.exercises.length ?? 0;
  const setCount = displayedSession?.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 1), 0) ?? 0;
  const sessionMuscles = deriveSessionMuscles(displayedSession?.exercises.map((exercise) => exercise.exerciseId) ?? []);
  const showBodyMap = sessionMuscles.primary.length > 0;
  const todayLocalDate = localDateInTimezone(new Date(), scheduleConfig?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const todayWeekday = weekdayOfLocalDate(todayLocalDate);
  const nextWorkoutDate = 'nextWorkoutDate' in resolution ? resolution.nextWorkoutDate : null;
  const dateLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${nextWorkoutDate ?? todayLocalDate}T12:00:00Z`));
  const compact = width < 360;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 112 }}
          showsVerticalScrollIndicator={false}
        >
          <Slash>{t('header.subtitle')}</Slash>
          <Display size={34} style={{ marginTop: 8, marginBottom: 22 }}>{t('header.title')}</Display>

          {/* One dominant training poster; the resolution remains the sole authority. */}
          <View style={{ backgroundColor: theme.colors.backgroundSecondary, borderRadius: 18, borderBottomRightRadius: 2, borderWidth: 1, borderColor: theme.colors.primaryBorderQuiet, overflow: 'hidden', minHeight: 310 }}>
            <HudCorners color={theme.colors.primaryEmphasis} />
            <View pointerEvents="none" style={{ position: 'absolute', right: -74, top: 34, width: 220, height: 220, borderRadius: 110, borderWidth: 1, borderColor: theme.colors.primaryBorderSoft }} />
            <View pointerEvents="none" style={{ position: 'absolute', right: -28, top: 80, width: 128, height: 128, borderRadius: 64, borderWidth: 1, borderColor: theme.colors.primaryBorderQuiet }} />
            <View pointerEvents="none" style={{ position: 'absolute', right: 26, top: 0, bottom: 0, width: 1, backgroundColor: theme.colors.primarySurfaceSubtle }} />
            <View style={{ padding: compact ? 19 : 23, paddingBottom: 18, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Slash textColor={theme.colors.textSecondary}>
                  {(workoutInProgress ? t('hero.inProgress') : statusCopyKey ? tHome(`schedule.${statusCopyKey}.title`) : tHome('todayCard.kicker')).toUpperCase()}
                </Slash>
                <MonoLabel color={theme.colors.primaryEmphasis}>{displayedIndex == null ? '—' : String(displayedIndex + 1).padStart(2, '0')} / {String(plan.sessions.length).padStart(2, '0')}</MonoLabel>
              </View>
              <View style={{ minHeight: 110, justifyContent: 'center', marginTop: 24, marginRight: 28 }}>
                {displayedSession ? (
                  <Display size={compact ? 34 : 40} skew={false} style={{ flexShrink: 1 }}>
                    {resolveSessionDisplayName(tLoose, displayedSession.name, displayedSession.type, displayedSession.displayName)}
                  </Display>
                ) : (
                  <Display size={compact ? 28 : 34} skew={false}>{tHome(`schedule.${statusCopyKey ?? 'setupRequired'}.title`)}</Display>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 7 }}>
                <View style={{ flex: 1, gap: 8 }}>
                  {displayedSession && <MonoLabel color={theme.colors.textSecondaryStrong} size={10}>{tHome('todayCard.sessionMeta', { exercises: exerciseCount, sets: setCount })}</MonoLabel>}
                  <MonoLabel color={theme.colors.primaryEmphasis} size={9}>{dateLabel}</MonoLabel>
                </View>
                {showBodyMap && <BodyMuscleMap sex={sex} primaryMuscles={sessionMuscles.primary} secondaryMuscles={sessionMuscles.secondary} activeColor={theme.colors.primaryEmphasis} baseColor={theme.colors.textFaint} outlineColor={theme.colors.border} size={compact ? 58 : 72} />}
              </View>
              {statusCopyKey && !displayedSession && (
                <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 10 }}>
                  {tHome(`schedule.${statusCopyKey}.body`)}
                </Text>
              )}
              <View style={{ marginTop: 24, gap: 8 }}>
                {canStartNow && (
                  <Pressable accessibilityRole="button" accessibilityState={{ disabled: startPending }} disabled={startPending} onPress={onStart} style={({ pressed }) => ({ minHeight: 52, backgroundColor: pressed ? theme.colors.primaryEmphasis : theme.colors.primary, borderRadius: 11, borderBottomRightRadius: 2, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: startPending ? 0.6 : 1 })}>
                    <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.display, fontSize: 16, letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 1 }}>
                      {workoutInProgress ? t('currentWorkout.continue') : tHome('todayCard.start')}
                    </Text>
                    <Icon name={workoutInProgress ? 'arrow-right' : 'play'} size={16} color={theme.colors.primaryForeground} />
                  </Pressable>
                )}
                {plan.sessions.length > 1 && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('changeWorkout.accessibilityOpen')} accessibilityState={{ disabled: workoutInProgress }} disabled={workoutInProgress} onPress={() => setChangeSheetOpen(true)} style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: workoutInProgress ? 0.4 : 1 }}>
                    <Icon name="swap" size={15} color={theme.colors.primaryEmphasis} />
                    <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 13 }}>{t('changeWorkout.cta')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          <View style={{ marginTop: 32, marginBottom: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View><MonoLabel color={theme.colors.primaryEmphasis}>{t('mySplit.sequence')}</MonoLabel><Display size={23} skew={false} style={{ marginTop: 4 }}>{t('mySplit.title')}</Display></View>
            <MonoLabel>{String(plan.sessions.length).padStart(2, '0')}</MonoLabel>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
            {plan.sessions.map((session, index) => {
              const isNext = index === nextIndex;
              const sessionName = resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName);
              return <View key={`${session.name}-${index}`} accessibilityRole="text" accessibilityLabel={`${index + 1}. ${sessionName}${isNext ? `, ${t('mySplit.nextBadge')}` : ''}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 68, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, backgroundColor: isNext ? theme.colors.primarySurfaceSubtle : 'transparent' }}>
                <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: isNext ? theme.colors.primaryEmphasis : 'transparent', marginRight: 14 }} />
                <MonoLabel color={isNext ? theme.colors.primaryEmphasis : theme.colors.textFaint} size={12} style={{ width: 30 }}>{String(index + 1).padStart(2, '0')}</MonoLabel>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontFamily: isNext ? theme.fonts.display : theme.fonts.uiSemi, color: isNext ? theme.colors.textPrimary : theme.colors.textSecondaryStrong, fontSize: isNext ? 18 : 14, textTransform: isNext ? 'uppercase' : 'none' }}>{sessionName}</Text>
                  <MonoLabel size={9} style={{ marginTop: 4 }}>{t('mySplit.exerciseCount', { count: session.exercises.length })}</MonoLabel>
                </View>
                {isNext && <MonoLabel color={theme.colors.primaryEmphasis} size={9} style={{ marginRight: 12 }}>{t('mySplit.nextBadge')}</MonoLabel>}
              </View>;
            })}
          </View>

          <View style={{ marginTop: 34, marginBottom: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}><MonoLabel color={theme.colors.primaryEmphasis}>{isFlexible ? t('agenda.flexibleLabel') : t('agenda.fixedLabel')}</MonoLabel><Display size={23} skew={false} style={{ marginTop: 4 }}>{t('agenda.title')}</Display></View>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: workoutInProgress }} disabled={workoutInProgress} onPress={onOpenAgendaEditor} style={{ minHeight: 44, justifyContent: 'center', opacity: workoutInProgress ? 0.4 : 1 }}>
              <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi, fontSize: 12 }}>{t('agenda.edit')}</Text>
            </Pressable>
          </View>
          {isFlexible ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 20, paddingHorizontal: 18, backgroundColor: theme.colors.primarySurfaceSubtle, borderLeftWidth: 3, borderLeftColor: theme.colors.primaryEmphasis }}>
              <Icon name="calendar" size={21} color={theme.colors.primaryEmphasis} />
              <View style={{ flex: 1 }}><Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 15 }}>{t('agenda.flexibleLabel')}</Text><Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 3 }}>{t('agenda.flexibleHint')}</Text></View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 3 }}>
              {WEEKDAY_ORDER.map((day) => {
                const isToday = day === todayWeekday;
                const isTraining = scheduleConfig?.trainingDays.includes(day) ?? false;
                const isRecovery = !isTraining && (scheduleConfig?.activeRecoveryDays?.includes(day) ?? false);
                return <View key={day} accessible accessibilityRole="text" accessibilityLabel={`${tLoose(`quiz:trainingDays.options.${day}`)}, ${t(isTraining ? 'agenda.trainingDay' : isRecovery ? 'agenda.activeRecoveryDay' : 'agenda.restDay')}${isToday ? `, ${t('agenda.today')}` : ''}`} style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <MonoLabel color={isToday ? theme.colors.primaryEmphasis : theme.colors.textFaint} size={9}>{t(`agenda.weekday.${day}`)}</MonoLabel>
                  <View style={{ marginTop: 9, width: compact ? 31 : 38, height: compact ? 38 : 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isTraining ? theme.colors.primarySurface : theme.colors.surfaceMuted, borderWidth: isToday ? 1 : 0, borderColor: theme.colors.primaryEmphasis }}>
                    {isRecovery ? <Icon name="heart" size={11} color={theme.colors.textMuted} /> : <View style={{ width: isTraining ? 8 : 4, height: isTraining ? 8 : 2, borderRadius: 4, backgroundColor: isTraining ? theme.colors.primaryEmphasis : theme.colors.indicatorRest }} />}
                  </View>
                </View>;
              })}
            </View>
          )}

          {(weekSummary || last30DaysCompletedCount != null) && <View style={{ marginTop: 38, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 19 }}>
            <MonoLabel color={theme.colors.primaryEmphasis}>{t('summary.title')}</MonoLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 17 }}>
              {weekSummary && <View style={{ flexGrow: 1, minWidth: 110 }}><Display size={27} skew={false}>{t('summary.thisWeekValue', { completed: weekSummary.completedCount, scheduled: weekSummary.scheduledCount })}</Display><MonoLabel style={{ marginTop: 5 }}>{t('summary.thisWeek')}</MonoLabel></View>}
              {last30DaysCompletedCount != null && <View style={{ flexGrow: 1, minWidth: 110 }}><Display size={27} skew={false}>{t('summary.last30DaysValue', { count: last30DaysCompletedCount })}</Display><MonoLabel style={{ marginTop: 5 }}>{t('summary.last30Days')}</MonoLabel></View>}
            </View>
          </View>}
        </ScrollView>
      </SafeAreaView>

      {changeSheetOpen && (
        <ChangeWorkoutSheet
          plan={plan}
          nextIndex={nextIndex}
          completedTodaySessionIndex={completedTodaySessionIndex}
          onClose={() => setChangeSheetOpen(false)}
          onConfirm={async (targetIndex) => {
            const outcome = await onReposition(targetIndex);
            if (outcome === 'OK') setChangeSheetOpen(false);
            return outcome;
          }}
        />
      )}
    </ScreenBg>
  );
}

function ChangeWorkoutSheet({
  plan,
  nextIndex,
  completedTodaySessionIndex,
  onClose,
  onConfirm,
}: {
  plan: FinalWorkoutPlan;
  nextIndex: number | null;
  completedTodaySessionIndex: number | null;
  onClose: () => void;
  onConfirm: (targetIndex: number) => Promise<RepositionOutcome>;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('treino');
  const { t: tHome } = useTranslation('home');
  const tLoose = tHome as unknown as LooseTranslate;
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<RepositionOutcome | null>(null);

  const confirm = async () => {
    if (selected == null || submitting) return;
    setSubmitting(true);
    setErrorCode(null);
    try {
      const outcome = await onConfirm(selected);
      if (outcome !== 'OK') setErrorCode(outcome);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={submitting ? undefined : onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('changeWorkout.accessibilityClose')}
        onPress={submitting ? undefined : onClose}
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingHorizontal: 22, paddingTop: 20, paddingBottom: 34,
            maxHeight: '80%',
          }}
        >
          <Slash>{t('changeWorkout.sheetTitle').toUpperCase()}</Slash>
          <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 8, marginBottom: 16 }}>
            {t('changeWorkout.sheetSubtitle')}
          </Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {plan.sessions.map((session, index) => {
              const isCurrent = index === nextIndex;
              const isSelected = index === selected;
              const alreadyCompletedToday = index === completedTodaySessionIndex;
              return (
                <Pressable
                  key={`${session.name}-${index}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected, disabled: alreadyCompletedToday }}
                  disabled={alreadyCompletedToday}
                  onPress={() => { setErrorCode(null); setSelected(index); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 8, borderRadius: 10,
                    backgroundColor: isSelected ? theme.colors.primaryBorderQuiet : theme.colors.surfaceElevated,
                    opacity: alreadyCompletedToday ? 0.45 : 1,
                  }}
                >
                  <View>
                    <Text style={{
                      color: isSelected ? theme.colors.primaryEmphasis : theme.colors.textPrimary,
                      fontFamily: theme.fonts.uiBold, fontSize: 14,
                    }}>
                      {resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName)}
                    </Text>
                    {isCurrent && (
                      <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 11, marginTop: 2 }}>
                        {t('mySplit.nextBadge')}
                      </Text>
                    )}
                  </View>
                  {isSelected && <Icon name="check" size={18} color={theme.colors.primaryEmphasis} stroke={2.6} />}
                </Pressable>
              );
            })}
          </ScrollView>
          {errorCode && (
            <Text style={{ color: theme.colors.danger ?? theme.colors.textPrimary, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 8 }}>
              {errorCode === 'ALREADY_COMPLETED_TODAY'
                ? t('changeWorkout.blockedCompletedToday')
                : errorCode === 'BLOCKED_IN_PROGRESS'
                  ? t('changeWorkout.blockedInProgress')
                  : t('changeWorkout.error')}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              disabled={submitting}
              style={{ flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.inputBorder }}
            >
              <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                {t('changeWorkout.cancel')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={confirm}
              disabled={selected == null || submitting}
              style={{
                flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                backgroundColor: theme.colors.inverseSurface, opacity: selected == null || submitting ? 0.5 : 1,
              }}
            >
              <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                {t('changeWorkout.confirm')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
