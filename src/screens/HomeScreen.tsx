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
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';
import { getDisplayFirstName } from '../lib/userName';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';

/**
 * Ticker rows read from i18n keys. The values themselves are placeholder
 * mock stats until the analytics pipeline lands; when it does, replace this
 * static list with derived data. The i18n structure (label + value) stays.
 */
type TickerKey = 'streak' | 'weekVolume' | 'benchPr' | 'consistency' | 'nextLevel';
const TICKER_KEYS: Array<{ key: TickerKey; value: string }> = [
  { key: 'streak', value: '14' },
  { key: 'weekVolume', value: '12.4T' },
  { key: 'benchPr', value: '82.5KG' },
  { key: 'consistency', value: '92%' },
  { key: 'nextLevel', value: '12' },
];

function Ticker() {
  const { t } = useTranslation('home');
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width === 0) return;
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
  }, [width, x]);

  const items = useMemo(
    () =>
      TICKER_KEYS.map(({ key, value }) => {
        const label = t(`ticker.${key}` as 'ticker.streak').toUpperCase();
        // `nextLevel` interpolates a day count; other tickers show the raw
        // mock number as-is until real analytics wire in.
        const display =
          key === 'nextLevel'
            ? t('ticker.nextLevelValue', { days: value })
            : value;
        return { label, value: display };
      }),
    [t],
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
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: 2,
            color: colors.faint,
          }}
        >
          {label}{' '}
          <Text style={{ color: colors.accentHi, fontFamily: fonts.monoBold }}>{value}</Text>
        </Text>
      ))}
    </View>
  );

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
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

const TODAY_MOCK_META = { duration: 58, exercises: 8, kcal: 420 };
const CONSISTENCY_MOCK = { done: 4, total: 5 };

export function HomeScreen({
  onStart,
  onOpenConsistency,
}: {
  onStart: () => void;
  onOpenConsistency: () => void;
}) {
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
            <ProfileAvatar
              displayName={profile?.profile.name || firstName}
              photoURL={profile?.profile.photoURL}
              photoVersion={profile?.profile.photoVersion}
              size={46}
            />
          </View>

          {/* ticker */}
          <Ticker />

          {/* TODAY POSTER */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <LinearGradient
              colors={['#0a1a55', '#051042', '#04021c']}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 16,
                borderBottomRightRadius: 0,
                overflow: 'hidden',
                minHeight: 250,
                borderWidth: 1,
                borderColor: 'rgba(11,112,249,0.3)',
                padding: 20,
                justifyContent: 'space-between',
              }}
            >
              <HudCorners />
              <OutlineNumber
                size={210}
                style={{ position: 'absolute', bottom: -64, right: -16, opacity: 0.5 }}
              >
                04
              </OutlineNumber>
              <View>
                <Slash>{t('home:todayCard.kicker').toUpperCase()}</Slash>
                <Display size={38} style={{ marginTop: 12 }}>
                  {t('home:mock.today.type').toUpperCase()} —
                </Display>
                <Display size={38}>{t('home:mock.today.focus').toUpperCase()}</Display>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10.5,
                      color: 'rgba(255,255,255,0.65)',
                      letterSpacing: 1,
                    }}
                  >
                    {t('home:todayCard.meta', TODAY_MOCK_META).toUpperCase()}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={onStart}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 20,
                  paddingVertical: 15,
                  paddingHorizontal: 26,
                  backgroundColor: '#fff',
                  borderTopLeftRadius: 10,
                  borderTopRightRadius: 10,
                  borderBottomLeftRadius: 10,
                  borderBottomRightRadius: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  shadowColor: '#fff',
                  shadowOpacity: 0.16,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: 10 },
                  elevation: 8,
                }}
              >
                <Icon name="play" size={13} color="#020010" />
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 15,
                    letterSpacing: 1.5,
                    color: '#020010',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('home:todayCard.start')}
                </Text>
              </Pressable>
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
                        fontFamily: fonts.display,
                        fontSize: 22,
                        color: '#fff',
                        textTransform: 'uppercase',
                      }}
                    >
                      {CONSISTENCY_MOCK.done}
                      <Text style={{ color: colors.faint, fontSize: 15 }}>
                        /{CONSISTENCY_MOCK.total}
                      </Text>
                    </Text>
                    <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.4)" />
                  </View>
                </View>
                <SegBar value={0.8} segs={15} />
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
                  {dayInitials.map((d, i) => {
                    const s = CONSISTENCY_MOCK_STATES[i];
                    const bg =
                      s === 'done'
                        ? 'rgba(11,112,249,0.3)'
                        : s === 'today'
                          ? colors.accent
                          : 'rgba(255,255,255,0.04)';
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
                              s === 'today' ? colors.accentHi : 'rgba(255,255,255,0.06)',
                            shadowColor: s === 'today' ? colors.accent : 'transparent',
                            shadowOpacity: s === 'today' ? 0.6 : 0,
                            shadowRadius: 8,
                            shadowOffset: { width: 0, height: 0 },
                            elevation: s === 'today' ? 4 : 0,
                          }}
                        >
                          {s === 'done' && <Icon name="check" size={13} color="#fff" />}
                          {s === 'today' && <Icon name="bolt" size={13} color="#fff" />}
                          {s === 'rest' && (
                            <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.faint }}>
                              {t('home:consistency.restLabel').toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.faint }}>
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
                    <Icon name={s.icon as IconName} size={14} color={colors.accentHi} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                    <Text
                      style={{
                        fontFamily: fonts.display,
                        fontSize: 34,
                        color: '#fff',
                        transform: [{ skewX: '-8deg' }],
                      }}
                    >
                      {s.value}
                    </Text>
                    <MonoLabel>{unit}</MonoLabel>
                  </View>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.mute, marginTop: 6 }}>
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
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.06)',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 15,
                      color: 'rgba(255,255,255,0.3)',
                      width: 38,
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.day}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>
                      {item.name}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.mono,
                        fontSize: 10,
                        color: colors.faint,
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
                  <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.35)" />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
