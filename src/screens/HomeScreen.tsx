import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { darkTheme, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { getDisplayFirstName } from '../lib/userName';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { useUnits } from '../state/UnitsContext';
import { formatWorkoutLoadFromKg, workoutLoadUnit } from '../units/workoutLoadConversions';
import { useIsScreenActive } from '../state/ScreenActivity';
import type { PrescriptionResult } from '../workoutPrescription/types';
import { prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { weekdayOfLocalDate, type ScheduleResolution } from '../scheduleEngine';

/**
 * Ticker rows read from i18n keys. The values themselves are placeholder
 * mock stats until the analytics pipeline lands; when it does, replace this
 * static list with derived data. The i18n structure (label + value) stays.
 */
type TickerKey = 'streak' | 'weekVolume' | 'benchPr' | 'consistency' | 'nextLevel';
const TICKER_KEYS: Array<{ key: TickerKey; value: string }> = [
  { key: 'streak', value: '14' },
  { key: 'weekVolume', value: '12.4T' },
  { key: 'benchPr', value: '82.5' },
  { key: 'consistency', value: '92%' },
  { key: 'nextLevel', value: '12' },
];

function Ticker() {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  // Home is kept alive while inactive (docs/23_navegacao_e_lifecycle.md) —
  // without this guard the marquee's native-driven loop would keep running
  // forever on an invisible screen every time another tab is active.
  const isActive = useIsScreenActive();

  useEffect(() => {
    if (width === 0 || !isActive) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -width,
        duration: 18000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [width, x, isActive]);

  const items = useMemo(
    () =>
      TICKER_KEYS.map(({ key, value }) => {
        const label = t(`ticker.${key}` as 'ticker.streak').toUpperCase();
        // `nextLevel` interpolates a day count; other tickers show the raw
        // mock number as-is until real analytics wire in.
        const display = key === 'benchPr'
          ? `${formatWorkoutLoadFromKg(Number(value), resolvedUnits)}${workoutLoadUnit(resolvedUnits).toUpperCase()}`
          : key === 'nextLevel'
            ? t('ticker.nextLevelValue', { days: value })
            : value;
        return { label, value: display };
      }),
    [resolvedUnits, t],
  );

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={
        onLayout
          ? (e) => onLayout(e.nativeEvent.layout.width)
          : undefined
      }
      style={{ flexDirection: 'row', gap: 36, paddingRight: 36 }}
    >
      {items.map(({ label, value }, i) => (
        <Text
          key={i}
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            letterSpacing: 2,
            color: theme.colors.textFaint,
          }}
        >
          {label}{' '}
          <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.monoBold }}>{value}</Text>
        </Text>
      ))}
    </View>
  );

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.settingsGroupBorder,
        paddingVertical: 8,
        marginBottom: 18,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          transform: [{ translateX: x }],
          paddingLeft: 22,
        }}
      >
        {row((w) => setWidth(w))}
        {row()}
      </Animated.View>
    </View>
  );
}
const UPCOMING_KEYS = ['pull', 'legs', 'upper'] as const;
const CONSISTENCY_MOCK_STATES = ['done', 'done', 'done', 'rest', 'done', 'today', 'future'];

/** Mock date placeholder — will be derived from real state once the plan
 *  timeline pipeline is wired. Kept here so tokens are single-sourced. */
const MOCK_DATE = {
  weekday: 'Seg',
  day: '03',
  month: 'Jun',
  currentWeek: '04',
  totalWeeks: '12',
};

const CONSISTENCY_MOCK = { done: 4, total: 5 };

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
  onOpenConsistency,
  onOpenProfile,
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
  onOpenConsistency: () => void;
  onOpenProfile: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation(['home', 'profile']);
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
      : scheduleResolution?.status === 'TODAY_COMPLETED'
        ? 'completedToday'
        : scheduleResolution?.status === 'SCHEDULE_SETUP_REQUIRED'
          ? 'setupRequired'
          : null;
  const isBlockedToday = scheduleResolution?.status === 'REST_DAY' || scheduleResolution?.status === 'TODAY_COMPLETED';
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

  const dayInitials = t('consistency.dayInitials', {
    returnObjects: true,
  }) as string[];

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
                {t('home:meta.todayLine', MOCK_DATE).toUpperCase()}
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

          {/* ticker */}
          <Ticker />

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
              <OutlineNumber
                size={210}
                color={TODAY_WORKOUT_THEME.colors.decorativeOutline}
                style={{ position: 'absolute', bottom: -64, right: -16, opacity: 0.5 }}
              >
                04
              </OutlineNumber>
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
                                sessions: prescription.plan.prescribedStructuredDays,
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

          {/* consistency card (tap → monthly calendar) */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <Pressable onPress={onOpenConsistency}>
              <Card style={{ padding: 18 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Slash>{t('home:consistency.title').toUpperCase()}</Slash>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      style={{
                        fontFamily: theme.fonts.display,
                        fontSize: 22,
                        color: theme.colors.textPrimary,
                        textTransform: 'uppercase',
                      }}
                    >
                      {CONSISTENCY_MOCK.done}
                      <Text style={{ color: theme.colors.textFaint, fontSize: 15 }}>
                        /{CONSISTENCY_MOCK.total}
                      </Text>
                    </Text>
                    <Icon name="chevron-right" size={16} color={theme.colors.iconMuted} />
                  </View>
                </View>
                <SegBar value={0.8} segs={15} />
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
                  {dayInitials.map((d, i) => {
                    const s = CONSISTENCY_MOCK_STATES[i];
                    const bg =
                      s === 'done'
                        ? theme.chart.consistency.doneBackground
                        : s === 'today'
                          ? theme.colors.primary
                          : theme.colors.surfaceMuted;
                    return (
                      <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                        <View
                          style={{
                            height: 34,
                            width: '100%',
                            borderRadius: 8,
                            marginBottom: 5,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: bg,
                            borderWidth: 1,
                            borderColor:
                              s === 'today' ? theme.colors.primaryEmphasis : theme.colors.settingsGroupBorder,
                            shadowColor: s === 'today' ? theme.colors.primary : 'transparent',
                            shadowOpacity: s === 'today' ? 0.6 : 0,
                            shadowRadius: 8,
                            shadowOffset: { width: 0, height: 0 },
                            elevation: s === 'today' ? 4 : 0,
                          }}
                        >
                          {s === 'done' && <Icon name="check" size={13} color={theme.colors.primaryForeground} />}
                          {s === 'today' && <Icon name="bolt" size={13} color={theme.colors.primaryForeground} />}
                          {s === 'rest' && (
                            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 8, color: theme.colors.textFaint }}>
                              {t('home:consistency.restLabel').toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textFaint }}>
                          {d}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            </Pressable>
          </View>

          {/* twin stats */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16, flexDirection: 'row', gap: 12 }}>
            {([
              { key: 'streak', icon: 'flame', value: '14' },
              { key: 'volume', icon: 'dumbbell', value: '12.4' },
            ] as const).map((s) => {
              const label = t(`home:stats.${s.key}.label`).toUpperCase();
              const unit = t(`home:stats.${s.key}.unit`).toUpperCase();
              const note = t(`home:stats.${s.key}.note`);
              return (
                <Card key={s.key} style={{ flex: 1, padding: 16 }}>
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}
                  >
                    <MonoLabel>{label}</MonoLabel>
                    <Icon name={s.icon as IconName} size={14} color={theme.colors.primaryEmphasis} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                    <Text
                      style={{
                        fontFamily: theme.fonts.display,
                        fontSize: 34,
                        color: theme.colors.textPrimary,
                        transform: [{ skewX: '-8deg' }],
                      }}
                    >
                      {s.value}
                    </Text>
                    <MonoLabel>{unit}</MonoLabel>
                  </View>
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11, color: theme.colors.textMuted, marginTop: 6 }}>
                    {note}
                  </Text>
                </Card>
              );
            })}
          </View>

          {/* up next */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 18 }}>
            <Slash style={{ marginBottom: 12 }}>
              {t('home:upcoming.title').toUpperCase()}
            </Slash>
            {UPCOMING_KEYS.map((k) => {
              const item = t(`home:upcoming.items.${k}`, {
                returnObjects: true,
              }) as { day: string; name: string; duration: number; exercises: number };
              return (
                <View
                  key={k}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 13,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    marginBottom: 8,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.settingsGroupBorder,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: theme.fonts.display,
                      fontSize: 15,
                      color: theme.colors.indicatorInactive,
                      width: 38,
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.day}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.textPrimary }}>
                      {item.name}
                    </Text>
                    <Text
                      style={{
                        fontFamily: theme.fonts.mono,
                        fontSize: 10,
                        color: theme.colors.textFaint,
                        marginTop: 3,
                        letterSpacing: 1,
                      }}
                    >
                      {t('home:upcoming.meta', {
                        duration: item.duration,
                        exercises: item.exercises,
                      })}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={15} color={theme.colors.controlHighlight} />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
