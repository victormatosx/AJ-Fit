import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { Card } from '../components/ui/Card';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { CtaButton } from '../components/ui/CtaButton';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useTheme } from '../theme';
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
  const { t } = useTranslation('treino');
  const { t: tHome } = useTranslation('home');
  const tLoose = tHome as unknown as LooseTranslate;
  const [changeSheetOpen, setChangeSheetOpen] = useState(false);

  const nextIndex = effectiveNextSessionIndex(resolution);
  const nextSession = nextIndex != null ? plan.sessions[nextIndex] ?? null : null;
  const displayedSession = treinoCardSession(plan.sessions, resolution, completedTodaySessionIndex);
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

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          <Display size={30}>{t('header.title').toUpperCase()}</Display>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 6, marginBottom: 22 }}>
            {t('header.subtitle')}
          </Text>

          {/* Next/today workout — the screen's primary element. */}
          <Card style={{ padding: 20 }}>
            <MonoLabel>
              {(statusCopyKey ? tHome(`schedule.${statusCopyKey}.title`) : tHome('todayCard.kicker')).toUpperCase()}
            </MonoLabel>
            {displayedSession && (
              <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 22, marginTop: 10 }}>
                {resolveSessionDisplayName(tLoose, displayedSession.name, displayedSession.type, displayedSession.displayName)}
              </Text>
            )}
            {statusCopyKey && (
              <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 6 }}>
                {tHome(`schedule.${statusCopyKey}.body`)}
              </Text>
            )}
            {displayedSession && (
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 10 }}>
                {tHome('todayCard.sessionMeta', { exercises: exerciseCount, sets: setCount })}
              </Text>
            )}
            {canStartNow && (
              <CtaButton onPress={onStart} disabled={startPending} style={{ marginTop: 18 }}>
                <Text style={{
                  color: theme.colors.primaryForeground, fontFamily: theme.fonts.display,
                  fontSize: 15, letterSpacing: 1.4, textTransform: 'uppercase',
                }}>
                  {workoutInProgress ? t('currentWorkout.continue') : tHome('todayCard.start')}
                </Text>
              </CtaButton>
            )}

            {/* Alterar treino — secondary action, always offered when there is
                a division to pick from, independent of today's status. */}
            {plan.sessions.length > 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('changeWorkout.accessibilityOpen')}
                disabled={workoutInProgress}
                onPress={() => setChangeSheetOpen(true)}
                style={{ marginTop: 14, alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 10, opacity: workoutInProgress ? 0.4 : 1 }}
              >
                <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.uiSemi, fontSize: 13, textDecorationLine: 'underline' }}>
                  {t('changeWorkout.cta')}
                </Text>
              </Pressable>
            )}
          </Card>

          {/* Minha divisão */}
          <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 16, marginTop: 28, marginBottom: 10 }}>
            {t('mySplit.title')}
          </Text>
          <Card style={{ padding: 6 }}>
            {plan.sessions.map((session, index) => {
              const isNext = index === nextIndex;
              return (
                <View
                  key={`${session.name}-${index}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 12, paddingHorizontal: 12,
                    borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.colors.border,
                  }}
                >
                  <Text style={{
                    color: isNext ? theme.colors.primaryEmphasis : theme.colors.textPrimary,
                    fontFamily: isNext ? theme.fonts.uiBold : theme.fonts.ui,
                    fontSize: 14,
                  }}>
                    {resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName)}
                  </Text>
                  {isNext && (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: theme.colors.primaryBorderQuiet }}>
                      <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi, fontSize: 10, textTransform: 'uppercase' }}>
                        {t('mySplit.nextBadge')}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </Card>

          {/* Agenda de treino */}
          <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 16, marginTop: 28, marginBottom: 10 }}>
            {t('agenda.title')}
          </Text>
          <Card style={{ padding: 18 }}>
            <MonoLabel>{(isFlexible ? t('agenda.flexibleLabel') : t('agenda.fixedLabel')).toUpperCase()}</MonoLabel>
            <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 15, marginTop: 8 }}>
              {isFlexible
                ? t('agenda.flexibleHint')
                : (scheduleConfig?.trainingDays ?? [])
                    .map((day) => tLoose(`quiz:trainingDays.options.${day}`))
                    .join(' · ')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: workoutInProgress }}
              disabled={workoutInProgress}
              onPress={onOpenAgendaEditor}
              style={{ marginTop: 14, alignSelf: 'flex-start', opacity: workoutInProgress ? 0.4 : 1 }}
            >
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.uiSemi, fontSize: 13, textDecorationLine: 'underline' }}>
                {t('agenda.edit')}
              </Text>
            </Pressable>
          </Card>

          {/* Resumo de treinos — only already-loaded, already-reliable
              metrics; nothing new is computed here. */}
          {(weekSummary || last30DaysCompletedCount != null) && (
            <>
              <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 16, marginTop: 28, marginBottom: 10 }}>
                {t('summary.title')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {weekSummary && (
                  <Card style={{ flex: 1, padding: 16 }}>
                    <MonoLabel>{t('summary.thisWeek').toUpperCase()}</MonoLabel>
                    <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 20, marginTop: 8 }}>
                      {t('summary.thisWeekValue', { completed: weekSummary.completedCount, scheduled: weekSummary.scheduledCount })}
                    </Text>
                  </Card>
                )}
                {last30DaysCompletedCount != null && (
                  <Card style={{ flex: 1, padding: 16 }}>
                    <MonoLabel>{t('summary.last30Days').toUpperCase()}</MonoLabel>
                    <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 20, marginTop: 8 }}>
                      {t('summary.last30DaysValue', { count: last30DaysCompletedCount })}
                    </Text>
                  </Card>
                )}
              </View>
            </>
          )}
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
