import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useIsScreenActive } from '../../state/ScreenActivity';
import type { EvolutionProgressTickerItem } from './evolutionProgressTickerItems';

const LOOP_DURATION_MS = 18000;
const ITEM_GAP = 36;

/**
 * Evolução's own compact info band — same visual contract as
 * `EvolutionTicker` (Treino/Home) and Dieta's `NutritionTicker`: hairline
 * border, infinite marquee, label (faint)/value (accent) pairs. Not a
 * shared import — each screen's ticker is built from that screen's own
 * real data, by established convention (see `EvolutionTicker.tsx`'s own
 * doc comment).
 */
export function EvolutionProgressTicker({ items }: { items: EvolutionProgressTickerItem[] }) {
  const { theme } = useTheme();
  if (items.length === 0) return null;

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.settingsGroupBorder,
        paddingVertical: 8,
        overflow: 'hidden',
      }}
    >
      <TickerMarquee items={items} />
    </View>
  );
}

function TickerMarquee({ items }: { items: EvolutionProgressTickerItem[] }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  // Evolução is kept alive while inactive, same as Home/Treino — without
  // this guard the native-driven loop would keep running forever on an
  // invisible screen whenever another tab is active.
  const isActive = useIsScreenActive();

  useEffect(() => {
    if (width === 0 || !isActive) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -width,
        duration: LOOP_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [width, x, isActive]);

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width) : undefined}
      style={{ flexDirection: 'row', gap: ITEM_GAP, paddingRight: ITEM_GAP }}
    >
      {items.map(({ label, value }, i) => (
        <Text
          key={i}
          style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, color: theme.colors.textFaint }}
        >
          {label.toUpperCase()}{' '}
          <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.monoBold }}>
            {value.toUpperCase()}
          </Text>
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
