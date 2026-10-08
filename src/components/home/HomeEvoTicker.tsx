import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { useIsScreenActive } from '../../state/ScreenActivity';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { Streak } from '../../home/streak';
import { buildHomeEvoTickerItems, type HomeEvoTickerTranslate } from './homeEvoTickerItems';

const LOOP_DURATION_MS = 18000;
const ITEM_GAP = 36;

/**
 * Home-only HUD marquee (section 2.2 of the Home redesign). Deliberately a
 * separate component from `EvolutionTicker` (shared with `TreinoScreen.tsx`,
 * never edited for this redesign) — same underlying `EvolutionViewModel`,
 * different visual treatment and a wider set of real fields (streak,
 * numeric adherence, 30-day session count) that `EvolutionTicker`'s compact
 * card treatment never needed.
 */
export function HomeEvoTicker({
  viewModel,
  streak,
  sessionsLast30Days,
}: {
  viewModel: EvolutionViewModel;
  /** `null` while the dedicated streak read (`useHomeStreak`) hasn't resolved yet — that item is simply omitted, never shown as 0. */
  streak: Streak | null;
  /** Real count from the already-loaded 30-day frequency window — `null` while unavailable, item omitted. */
  sessionsLast30Days: number | null;
}) {
  const { t } = useTranslation(['home', 'evolution']);
  const { theme } = useTheme();
  const tLoose = t as unknown as HomeEvoTickerTranslate;

  const items = useMemo<string[]>(
    () => buildHomeEvoTickerItems(viewModel, streak, sessionsLast30Days, tLoose),
    [viewModel, streak, sessionsLast30Days, tLoose],
  );

  if (items.length === 0) return null;

  return (
    <View
      style={{
        marginHorizontal: -22,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.settingsGroupBorder,
        paddingVertical: 8,
        overflow: 'hidden',
      }}
    >
      <TickerMarquee items={items} accentColor={theme.colors.primaryEmphasis} fontFamily={theme.fonts.mono} />
    </View>
  );
}

function TickerMarquee({
  items,
  accentColor,
  fontFamily,
}: {
  items: string[];
  accentColor: string;
  fontFamily: string;
}) {
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
      Animated.timing(x, { toValue: -width, duration: LOOP_DURATION_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [width, x, isActive]);

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width) : undefined}
      style={{ flexDirection: 'row', gap: ITEM_GAP, paddingRight: ITEM_GAP }}
    >
      {items.map((item, i) => (
        <Text
          key={i}
          style={{ fontFamily, fontSize: 10, letterSpacing: 2, color: accentColor }}
        >
          {item}
        </Text>
      ))}
    </View>
  );

  return (
    <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: x }], paddingLeft: 22 }}>
      {row((w) => setWidth(w))}
      {row()}
    </Animated.View>
  );
}
