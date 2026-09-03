import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { HudCorners } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { darkTheme, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { getDisplayFirstName } from '../lib/userName';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import type { PrescriptionResult } from '../workoutPrescription/types';
import { prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { weekdayOfLocalDate, type ScheduleResolution } from '../scheduleEngine';
import { EvolutionCard } from '../components/evolution/EvolutionCard';
import type { EvolutionViewModel } from '../workoutEvolution/types';

// Lifecycle claims on Home come from the shared EvolutionViewModel.

// Product invariant: the Today Workout poster keeps the official Dark art
// direction in both app themes. This is intentionally scoped to this card;
// surrounding Home surfaces still follow the active theme.
const TODAY_WORKOUT_THEME = darkTheme;

export function HomeScreen({
  prescription,
  loading,
  generating,
  scheduleResolution,
  onStart,
  onOpenProfile,
  evolutionViewModel,
  onOpenEvolution,
}: {
  prescription: PrescriptionResult;
  /**
   * True until the FIRST resolution of `prescription` for the current
   * identity lands (`useWorkoutPrescription`'s own `loading`) — while true,
   * `prescription.status` may still be an internal placeholder and must
   * never be read. Distinct from `generating`: this covers the ordinary
   * "we haven't read Firestore yet" window (happy path, no engine running),
   * so it renders a neutral loading state, never the "generating"/"needs
   * questionnaire update" copy below.
   */
  loading?: boolean;
  /** True while automatic reconciliation or the manual fallback is generating the first/updated program — shown in place of the outcome copy below, never alongside it. */
  generating?: boolean;
  /** Schedule Engine's read on "what to train right now" (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md). Optional — omitted callers keep the pre-Schedule-Engine behavior of always showing session 0. */
  scheduleResolution?: ScheduleResolution;
  onStart: () => void;
  onOpenProfile: () => void;
  /** Fase 5 — real Training Level/Cycle/progress state; replaces the old hardcoded ticker (docs product §67/§130/§132/§AU). */
  evolutionViewModel: EvolutionViewModel;
  onOpenEvolution?: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['home', 'profile']);
  const { user, profile } = useAuth();
  const firstName = getDisplayFirstName({
    profileName: profile?.profile.name,
    authDisplayName: user?.displayName,
    email: user?.email ?? profile?.profile.email,
    // Visual-only fallback: never persisted, always resolves in the active
    // locale. `getDisplayFirstName` returns 'Atleta' as its literal last
    // resort — we replace that here so it becomes "Athlete" / "Atleta" in en/es.
  });
  const localizedFirstName = (
    firstName === 'Atleta' ? t('profile:fallback.athlete') : firstName
  ).toUpperCase();
  // `loading` only forces the neutral loading copy when there's no known
  // SUCCESS yet — a refresh that already has a valid plan on screen keeps
  // showing it instead of flashing "loading" over real data. While
  // `generating`, the card shows the in-flight copy regardless of the last
  // known `prescription.status` — reconciliation/manual retry are about to
  // replace it with a real outcome, so the stale one is never shown
  // mid-attempt (`docs/workout-lifecycle` — distinguishes "generating" from
  // every terminal outcome, incl. "not generated yet").
  const showLoadingState = Boolean(loading) && prescription.status !== 'SUCCESS';
  const outcomeKey = showLoadingState
    ? 'loadingState'
    : generating
      ? 'generatingState'
      : prescription.status === 'SUCCESS'
        ? null
        : prescriptionOutcomeKey(prescription.status);
  const scheduledSessionIndex = scheduleResolution?.status === 'SESSION_READY' ? scheduleResolution.sessionIndex : 0;
  const firstSession = prescription.status === 'SUCCESS'
    ? prescription.plan.sessions[scheduledSessionIndex] ?? prescription.plan.sessions[0]
    : null;
  // REST_DAY/TODAY_COMPLETED/SCHEDULE_SETUP_REQUIRED only override the card
  // when there is otherwise a ready program — a legacy/blocked prescription
  // keeps its own outcome copy above (docs/workout-lifecycle/
  // 03_SCHEDULE_ENGINE.md §UI mínima). REST_DAY and TODAY_COMPLETED never
  // offer "Iniciar treino" again today — the CTA below is swapped for a
  // "próximo treino" info row instead (docs §Bloqueio real): the domain
  // layer (Schedule Engine resolution itself, not just this button) is what
  // actually prevents a second session the same day.
  const scheduleOverrideKey = prescription.status !== 'SUCCESS'
    ? null
    : scheduleResolution?.status === 'REST_DAY'
      ? 'restDay'
      : scheduleResolution?.status === 'ACTIVE_RECOVERY_DAY'
        ? 'activeRecovery'
      : scheduleResolution?.status === 'TODAY_COMPLETED'
        ? 'completedToday'
        : scheduleResolution?.status === 'SCHEDULE_SETUP_REQUIRED'
          ? 'setupRequired'
          : null;
  const isBlockedToday = scheduleResolution?.status === 'REST_DAY'
    || scheduleResolution?.status === 'ACTIVE_RECOVERY_DAY'
    || scheduleResolution?.status === 'TODAY_COMPLETED';
  const nextSession = prescription.status === 'SUCCESS' && isBlockedToday
    ? prescription.plan.sessions[(scheduleResolution as { nextSessionIndex: number }).nextSessionIndex] ?? null
    : null;
  const tLoose = t as unknown as LooseTranslate;
  const nextWorkoutLine = nextSession && isBlockedToday
    ? t('home:schedule.nextWorkout.value', {
        weekday: tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate((scheduleResolution as { nextWorkoutDate: string }).nextWorkoutDate)}`),
        session: resolveSessionDisplayName(tLoose, nextSession.name, nextSession.type),
      })
    : null;

  // Today's real locale-formatted calendar date. There is no fixed
  // week-of-program countdown because the lifecycle has no such fact.
  const today = new Date();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const todayLine = t('home:meta.todayLine', {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(today),
    day: new Intl.DateTimeFormat(locale, { day: '2-digit' }).format(today),
    month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(today),
  });

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          {/* greeting */}
          <View
            style={{
              paddingHorizontal: 22,
              paddingBottom: 18,
              paddingTop: 12,
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
            }}
          >
            <View>
              <MonoLabel>
                {todayLine.toUpperCase()}
              </MonoLabel>
              <Display size={34} style={{ marginTop: 8 }}>
                {t('home:greeting.casual').toUpperCase()}
              </Display>
              <Display size={34}>{localizedFirstName}.</Display>
            </View>
            <Pressable onPress={onOpenProfile} hitSlop={8}>
              <ProfileAvatar
                displayName={profile?.profile.name || firstName}
                photoURL={profile?.profile.photoURL}
                photoVersion={profile?.profile.photoVersion}
                size={46}
              />
            </Pressable>
          </View>

          {/* Real Training Level/Cycle state from Workout Lifecycle V2. */}
          <View style={{ paddingHorizontal: 22, marginBottom: 18 }}>
            <EvolutionCard viewModel={evolutionViewModel} onPress={onOpenEvolution} />
          </View>

          {/* TODAY POSTER */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <LinearGradient
              colors={TODAY_WORKOUT_THEME.gradients.poster}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 16,
                borderBottomRightRadius: 0,
                overflow: 'hidden',
                minHeight: 250,
                borderWidth: 1,
                borderColor: TODAY_WORKOUT_THEME.colors.primaryBorderQuiet,
                padding: 20,
                justifyContent: 'space-between',
              }}
            >
              <HudCorners color={TODAY_WORKOUT_THEME.colors.hudCorner} />
              <View>
                <Slash
                  accentColor={TODAY_WORKOUT_THEME.colors.primaryEmphasis}
                  textColor={TODAY_WORKOUT_THEME.colors.textFaint}
                >
                  {t('home:todayCard.kicker').toUpperCase()}
                </Slash>
                <Display
                  size={38}
                  color={TODAY_WORKOUT_THEME.colors.textPrimary}
                  style={{ marginTop: 12 }}
                >
                  {(showLoadingState
                    ? t('home:prescription.loadingState.title')
                    : generating
                      ? t('home:prescription.generatingState.title')
                      : scheduleOverrideKey
                        ? t(`home:schedule.${scheduleOverrideKey}.title`)
                        : firstSession
                          ? `${prescription.status === 'SUCCESS' ? prescription.plan.templateId : ''} · ${resolveSessionDisplayName(t as unknown as LooseTranslate, firstSession.name, firstSession.type)}`
                          : t(`home:prescription.${outcomeKey}.title` as 'home:prescription.unavailable.title')
                  ).toUpperCase()}
                </Display>
                {!scheduleOverrideKey && (
                  <Display size={38} color={TODAY_WORKOUT_THEME.colors.textPrimary}>
                    {(prescription.status === 'SUCCESS' ? prescription.plan.split : '').toUpperCase()}
                  </Display>
                )}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: 10.5,
                      color: TODAY_WORKOUT_THEME.colors.textSecondary,
                      letterSpacing: 1,
                    }}
                  >
                    {(showLoadingState
                      ? t('home:prescription.loadingState.body')
                      : generating
                        ? t('home:prescription.generatingState.body')
                        : scheduleOverrideKey
                          ? t(`home:schedule.${scheduleOverrideKey}.body`)
                          : prescription.status === 'SUCCESS'
                            ? t('home:todayCard.prescribedMeta', {
                                sessions: prescription.plan.prescribedTrainingFrequency
                                  ?? prescription.plan.prescribedStructuredDays,
                                exercises: firstSession?.exercises.length ?? 0,
                              })
                            : t(`home:prescription.${outcomeKey}.body` as 'home:prescription.unavailable.body')
                    ).toUpperCase()}
                  </Text>
                </View>
              </View>

              {isBlockedToday ? (
                nextWorkoutLine && (
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: 20,
                      paddingVertical: 13,
                      paddingHorizontal: 18,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: TODAY_WORKOUT_THEME.colors.primaryBorderQuiet,
                      backgroundColor: TODAY_WORKOUT_THEME.colors.surfaceMuted,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Icon name="calendar" size={14} color={TODAY_WORKOUT_THEME.colors.primaryEmphasis} />
                    <View>
                      <MonoLabel color={TODAY_WORKOUT_THEME.colors.textFaint}>
                        {t('home:schedule.nextWorkout.label').toUpperCase()}
                      </MonoLabel>
                      <Text
                        style={{
                          fontFamily: theme.fonts.uiBold,
                          fontSize: 13,
                          color: TODAY_WORKOUT_THEME.colors.textPrimary,
                          marginTop: 2,
                        }}
                      >
                        {nextWorkoutLine}
                      </Text>
                    </View>
                  </View>
                )
              ) : (
                <Pressable
                  onPress={onStart}
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: 20,
                    paddingVertical: 15,
                    paddingHorizontal: 26,
                    backgroundColor: TODAY_WORKOUT_THEME.colors.inverseSurface,
                    borderTopLeftRadius: 10,
                    borderTopRightRadius: 10,
                    borderBottomLeftRadius: 10,
                    borderBottomRightRadius: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    shadowColor: TODAY_WORKOUT_THEME.colors.inverseShadow,
                    shadowOpacity: 0.16,
                    shadowRadius: 20,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 8,
                  }}
                >
                  <Icon
                    name="play"
                    size={13}
                    color={TODAY_WORKOUT_THEME.colors.inverseForeground}
                  />
                  <Text
                    style={{
                      fontFamily: theme.fonts.display,
                      fontSize: 15,
                      letterSpacing: 1.5,
                      color: TODAY_WORKOUT_THEME.colors.inverseForeground,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t(prescription.status === 'SUCCESS' ? 'home:todayCard.start' : 'home:todayCard.review')}
                  </Text>
                </Pressable>
              )}
            </LinearGradient>
          </View>

          {/* No consistency/streak/volume/PR or future-workout preview is
              rendered until those claims have a production data source. */}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
