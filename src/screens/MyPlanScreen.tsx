import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { Icon, type IconName } from '../components/ui/Icon';
import { SettingsDivider } from '../components/ui/SettingsSection';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { localDateInTimezone, weekdayOfLocalDate, type WorkoutScheduleController } from '../scheduleEngine';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import { resolveSessionDisplayName } from '../workoutPrescription/sessionPresentation';
import { buildAdaptationFlags, buildWeekView, hasAnyAdaptation } from './myPlanPresentation';
import type { PrescriptionResult } from '../workoutPrescription/types';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';

type LooseT = (key: string, opts?: Record<string, unknown>) => string;

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Compact badge for a session ("A", "B" — the canonical letter) — falls back to a 1-based index for a longer/unusual name rather than truncating it oddly. */
function sessionBadgeLabel(name: string, index: number): string {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 2 ? trimmed.toUpperCase() : String(index + 1);
}

/**
 * A pure VIEW of the already-resolved plan (docs: "Meu Plano" spec §13) —
 * receives `prescription`/`schedule` exactly as `AppShell` already resolved
 * them via `useWorkoutPrescription`/`useWorkoutSchedule`, and never calls the
 * Prescription or Schedule Engine itself. Opening this screen cannot
 * generate, regenerate, or otherwise mutate the active program.
 */
export function MyPlanScreen({
  prescription,
  loading,
  schedule,
  onBack,
}: {
  prescription: PrescriptionResult;
  loading: boolean;
  schedule: WorkoutScheduleController;
  onBack: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('myPlan');
  const tLoose = t as unknown as LooseT;
  const { questionnaire } = useAuth();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const plan = prescription.status === 'SUCCESS' ? (prescription.plan as WorkoutProgramSnapshot) : null;
  const answers = questionnaire?.answers ?? null;

  const timezone = schedule.config?.timezone ?? deviceTimezone();
  const todayWeekday = useMemo(() => weekdayOfLocalDate(localDateInTimezone(new Date(), timezone)), [timezone]);
  const weekView = useMemo(
    () => buildWeekView(schedule.config?.trainingDays ?? [], todayWeekday, schedule.resolution, plan?.weeklySchedule),
    [schedule.config, schedule.resolution, todayWeekday, plan?.weeklySchedule],
  );
  const adaptations = useMemo(() => (plan ? buildAdaptationFlags(plan.trace) : null), [plan]);

  const dueToday = weekView.find((day) => day.isToday && day.dueSessionIndex !== null) ?? null;
  const dueTodaySessionName = useMemo(() => {
    if (!plan || !dueToday || dueToday.dueSessionIndex === null) return null;
    const session = plan.sessions[dueToday.dueSessionIndex];
    return session ? resolveSessionDisplayName(tLoose, session.name, session.type) : null;
  }, [plan, dueToday, tLoose]);

  const goalLabel = answers?.goal
    ? t(`quiz:goal.options.${answers.goal}.label`, { defaultValue: '' })
    : '';
  const levelLabel = answers?.level
    ? t(`quiz:level.options.${answers.level}.label`, { defaultValue: '' })
    : '';
  const placeLabel = answers?.place
    ? t(`quiz:place.options.${answers.place}.label`, { defaultValue: '' })
    : '';
  const equipmentLabels = (answers?.equipment ?? [])
    .map((id) => t(`quiz:equipment.options.${id}`, { defaultValue: '' }))
    .filter(Boolean);
  const daysAvailable = answers?.days ?? plan?.requestedDays ?? null;
  const goalFallbackLabel = plan
    ? t(`goalFamily.${plan.goalFamily}`, { defaultValue: '' })
    : '';
  const resolvedGoalLabel = goalLabel || goalFallbackLabel;

  const summaryItems = plan
    ? [
        resolvedGoalLabel ? { key: 'goal', label: t('summary.goal'), value: resolvedGoalLabel } : null,
        {
          key: 'frequency',
          label: t('summary.frequency'),
          value: t('summary.frequencyValue', {
            count: plan.prescribedTrainingFrequency ?? plan.prescribedStructuredDays,
          }),
        },
        levelLabel ? { key: 'level', label: t('summary.level'), value: levelLabel } : null,
        { key: 'structure', label: t('summary.structure'), value: plan.split },
      ].filter((item): item is { key: string; label: string; value: string } => item !== null)
    : [];

  const factorItems: { key: string; icon: IconName; label: string; value: string }[] = [
    resolvedGoalLabel ? { key: 'goal', icon: 'target', label: t('madeForYou.factors.goal'), value: resolvedGoalLabel } : null,
    levelLabel ? { key: 'level', icon: 'trophy', label: t('madeForYou.factors.level'), value: levelLabel } : null,
    daysAvailable
      ? { key: 'days', icon: 'calendar', label: t('summary.frequency'), value: t('madeForYou.factors.days', { count: daysAvailable }) }
      : null,
    placeLabel ? { key: 'place', icon: 'home', label: t('madeForYou.factors.place'), value: placeLabel } : null,
    equipmentLabels.length > 0
      ? { key: 'equipment', icon: 'dumbbell', label: t('madeForYou.factors.equipment'), value: equipmentLabels.join(', ') }
      : null,
  ].filter((item): item is { key: string; icon: IconName; label: string; value: string } => item !== null);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 22,
            paddingTop: 12,
            paddingBottom: 8,
            gap: 12,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            onPress={onBack}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: pressed ? theme.colors.dividerStrong : theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Icon name="arrow-left" size={16} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>{t('header.title')}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {loading && !plan ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textMuted }}>
              {t('states.loading')}
            </Text>
          </View>
        ) : !plan ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Icon name="calendar" size={24} color={theme.colors.textFaint} />
            </View>
            <Display size={20} style={{ textAlign: 'center', marginTop: 6 }}>
              {t(prescription.status === 'SUCCESS' ? 'states.emptyTitle' : 'states.errorTitle')}
            </Display>
            <Text
              style={{
                fontFamily: theme.fonts.ui,
                fontSize: 13,
                color: theme.colors.textMuted,
                textAlign: 'center',
                lineHeight: 19,
                maxWidth: 280,
              }}
            >
              {t(prescription.status === 'SUCCESS' ? 'states.emptyBody' : 'states.errorBody')}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
            {/* Hero */}
            <View style={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 4 }}>
              <View
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                  backgroundColor: theme.colors.primarySoft,
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.fonts.monoBold,
                    fontSize: 9.5,
                    letterSpacing: 1.4,
                    color: theme.colors.primaryEmphasis,
                  }}
                >
                  {t('header.badge').toUpperCase()}
                </Text>
              </View>
              <Display size={30} skew={false}>
                {plan.split.toUpperCase()}
              </Display>
              <Text
                style={{
                  fontFamily: theme.fonts.ui,
                  fontSize: 13.5,
                  lineHeight: 20,
                  color: theme.colors.textSecondary,
                  marginTop: 10,
                  maxWidth: 340,
                }}
              >
                {t('header.subtitle')}
              </Text>
            </View>

            {/* Summary */}
            {summaryItems.length > 0 && (
              <View style={{ paddingHorizontal: 22, marginTop: 20 }}>
                <Card style={{ overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {summaryItems.map((item, index) => {
                      const isRightColumn = index % 2 === 1;
                      return (
                        <View
                          key={item.key}
                          style={{
                            width: '50%',
                            paddingHorizontal: 16,
                            paddingVertical: 14,
                            borderLeftWidth: isRightColumn ? 1 : 0,
                            borderLeftColor: theme.colors.divider,
                            borderTopWidth: index >= 2 ? 1 : 0,
                            borderTopColor: theme.colors.divider,
                          }}
                        >
                          <MonoLabel size={9}>{item.label}</MonoLabel>
                          <Text
                            style={{
                              fontFamily: theme.fonts.uiSemi,
                              fontSize: 15,
                              color: theme.colors.textPrimary,
                              marginTop: 5,
                            }}
                            numberOfLines={2}
                          >
                            {item.value}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </Card>
              </View>
            )}

            {/* Made for you */}
            {factorItems.length > 0 && (
              <View style={{ paddingHorizontal: 22, marginTop: 26 }}>
                <Slash style={{ marginBottom: 6 }}>{t('madeForYou.title')}</Slash>
                <Text
                  style={{
                    fontFamily: theme.fonts.ui,
                    fontSize: 12.5,
                    color: theme.colors.textMuted,
                    marginBottom: 12,
                    maxWidth: 340,
                  }}
                >
                  {t('madeForYou.subtitle')}
                </Text>
                <View
                  style={{
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: theme.colors.settingsGroupBackground,
                    borderWidth: 1,
                    borderColor: theme.colors.settingsGroupBorder,
                  }}
                >
                  {factorItems.map((item, index) => (
                    <View key={item.key}>
                      {index > 0 && <SettingsDivider />}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingHorizontal: 16,
                          paddingVertical: 13,
                        }}
                      >
                        <View
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: theme.colors.primarySoft,
                          }}
                        >
                          <Icon name={item.icon} size={14} color={theme.colors.primaryEmphasis} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textMuted }}>
                            {item.label}
                          </Text>
                          <Text
                            style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13.5, color: theme.colors.textPrimary, marginTop: 2 }}
                            numberOfLines={2}
                          >
                            {item.value}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Week */}
            <View style={{ paddingHorizontal: 22, marginTop: 26 }}>
              <Slash style={{ marginBottom: 14 }}>{t('week.title')}</Slash>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {weekView.map((day) => (
                  <View key={day.weekday} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
                    <View
                      style={{
                        width: '100%',
                        aspectRatio: 1,
                        borderRadius: 11,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: day.isToday
                          ? theme.colors.primary
                          : day.isTrainingDay
                            ? theme.colors.primarySoft
                            : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: day.isToday
                          ? theme.colors.primaryEmphasis
                          : day.isTrainingDay
                            ? theme.colors.primaryBorderQuiet
                            : theme.colors.border,
                        ...(day.isToday
                          ? {
                              shadowColor: theme.colors.primary,
                              shadowOpacity: 0.5,
                              shadowRadius: 10,
                              shadowOffset: { width: 0, height: 0 },
                              elevation: 5,
                            }
                          : null),
                      }}
                    >
                      <Icon
                        name={day.state === 'TRAINING' ? 'dumbbell' : day.state === 'ACTIVE_RECOVERY' ? 'heart' : 'moon'}
                        size={14}
                        color={
                          day.isToday
                            ? theme.colors.primaryForeground
                            : day.state !== 'REST'
                              ? theme.colors.primaryEmphasis
                              : theme.colors.textFaint
                        }
                        stroke={1.6}
                      />
                    </View>
                    <Text
                      style={{
                        fontFamily: theme.fonts.mono,
                        fontSize: 9,
                        letterSpacing: 0.5,
                        color: day.isToday ? theme.colors.primaryEmphasis : theme.colors.textFaint,
                      }}
                    >
                      {tLoose(`quiz:trainingDays.options.${day.weekday}`).toUpperCase()}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: theme.fonts.ui, fontSize: 7, color: theme.colors.textFaint }}
                    >
                      {day.state === 'TRAINING'
                        ? t('week.trainingDay')
                        : day.state === 'ACTIVE_RECOVERY'
                          ? t('week.activeRecovery')
                          : t('week.restDay')}
                    </Text>
                  </View>
                ))}
              </View>
              {dueTodaySessionName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.primaryEmphasis }} />
                  <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 12.5, color: theme.colors.textSecondary }}>
                    {t('week.todaySession', { session: dueTodaySessionName })}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Workouts */}
            <View style={{ paddingHorizontal: 22, marginTop: 30 }}>
              <Slash style={{ marginBottom: 14 }}>{t('workouts.title')}</Slash>
              <View style={{ gap: 10 }}>
                {plan.sessions.map((session, index) => (
                  <WorkoutCard
                    key={`${session.name}-${index}`}
                    badgeLabel={sessionBadgeLabel(session.name, index)}
                    sessionName={resolveSessionDisplayName(tLoose, session.name, session.type)}
                    exerciseCount={session.exercises.length}
                    expanded={expandedIndex === index}
                    onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
                    isDueToday={dueToday?.dueSessionIndex === index}
                    tLoose={tLoose}
                    exercises={workoutExercisesFromPlan(plan, i18n.language, index)}
                  />
                ))}
              </View>
            </View>

            {/* Adaptations */}
            {adaptations && hasAnyAdaptation(adaptations) ? (
              <View style={{ paddingHorizontal: 22, marginTop: 30 }}>
                <Slash style={{ marginBottom: 12 }}>{t('adaptations.title')}</Slash>
                <Card style={{ padding: 16, gap: 12 }}>
                  {adaptations.equipment ? <AdaptationRow text={t('adaptations.equipment')} /> : null}
                  {adaptations.limitations ? <AdaptationRow text={t('adaptations.limitations')} /> : null}
                  {adaptations.experience ? <AdaptationRow text={t('adaptations.experience')} /> : null}
                  {adaptations.duration ? <AdaptationRow text={t('adaptations.duration')} /> : null}
                </Card>
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

function AdaptationRow({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.primarySoft,
          marginTop: 1,
        }}
      >
        <Icon name="check" size={11} color={theme.colors.primaryEmphasis} stroke={2.2} />
      </View>
      <Text style={{ flex: 1, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary }}>
        {text}
      </Text>
    </View>
  );
}

function WorkoutCard({
  badgeLabel,
  sessionName,
  exerciseCount,
  expanded,
  onToggle,
  isDueToday,
  tLoose: t,
  exercises,
}: {
  badgeLabel: string;
  sessionName: string;
  exerciseCount: number;
  expanded: boolean;
  onToggle: () => void;
  isDueToday: boolean;
  tLoose: LooseT;
  exercises: ReturnType<typeof workoutExercisesFromPlan>;
}) {
  const { theme } = useTheme();
  const chevronRot = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevronRot, { toValue: expanded ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [expanded, chevronRot]);
  const rotate = chevronRot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <Card
      style={
        isDueToday
          ? { overflow: 'hidden', borderColor: theme.colors.primaryBorderQuiet }
          : { overflow: 'hidden' }
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(expanded ? 'workouts.hideWorkout' : 'workouts.viewWorkout')}
        onPress={onToggle}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 15,
          gap: 13,
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isDueToday ? theme.colors.primary : theme.colors.surface,
            borderWidth: 1,
            borderColor: isDueToday ? theme.colors.primaryEmphasis : theme.colors.border,
          }}
        >
          <Text
            style={{
              fontFamily: theme.fonts.display,
              fontSize: 16,
              color: isDueToday ? theme.colors.primaryForeground : theme.colors.textPrimary,
            }}
          >
            {badgeLabel}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.textPrimary }} numberOfLines={1}>
              {sessionName}
            </Text>
            {isDueToday ? (
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: theme.colors.primarySoft,
                }}
              >
                <Text style={{ fontFamily: theme.fonts.monoBold, fontSize: 8.5, color: theme.colors.primaryEmphasis }}>
                  {t('week.today').toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted, marginTop: 3 }}>
            {t('workouts.exerciseCount', { count: exerciseCount })}
          </Text>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
        </Animated.View>
      </Pressable>

      {expanded ? (
        <View>
          <SettingsDivider />
          <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
            {exercises.map((exercise, exIndex) => {
              const reps = exercise.sets[0]?.r ?? '';
              const isDuration = /s$|min$/i.test(reps.trim());
              return (
                <View
                  key={`${exercise.id}-${exIndex}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 11,
                    borderTopWidth: exIndex === 0 ? 0 : 1,
                    borderTopColor: theme.colors.divider,
                  }}
                >
                  <Text
                    style={{
                      width: 18,
                      fontFamily: theme.fonts.mono,
                      fontSize: 11,
                      color: theme.colors.textFaint,
                    }}
                  >
                    {String(exIndex + 1).padStart(2, '0')}
                  </Text>
                  <Text
                    style={{ flex: 1, fontFamily: theme.fonts.uiSemi, fontSize: 13.5, color: theme.colors.textPrimary }}
                    numberOfLines={2}
                  >
                    {exercise.name}
                  </Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 12.5, color: theme.colors.textSecondary }}>
                      {t(isDuration ? 'workouts.setsDuration' : 'workouts.setsReps', {
                        sets: exercise.sets.length,
                        reps,
                        duration: reps,
                      })}
                    </Text>
                    {exercise.rest > 0 ? (
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11, color: theme.colors.textFaint, marginTop: 1 }}>
                        {t('workouts.rest', { seconds: exercise.rest })}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </Card>
  );
}
