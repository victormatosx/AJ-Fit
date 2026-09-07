import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { useIsScreenActive } from '../../state/ScreenActivity';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import { buildEvolutionTickerContent, type EvolutionTickerContent, type TickerItem, type TickerTranslate } from '../../workoutEvolution/tickerItems';

const LOOP_DURATION_MS = 18000;
const ITEM_GAP = 36;

/**
 * Compact evolution surface for the Home — the marquee identity of the
 * historical Home `Ticker` (commit d24319b), rebuilt on top of the real
 * `EvolutionViewModel` instead of its old hardcoded mock stats. Presentation
 * only: never recomputes eligibility/level/cycle/adherence (docs product
 * audit "EvolutionTicker" §I).
 */
export function EvolutionTicker({
  viewModel,
  onPress,
}: {
  viewModel: EvolutionViewModel;
  onPress?: () => void;
}) {
  const { t } = useTranslation('evolution');
  const { theme } = useTheme();
  const tLoose = t as unknown as TickerTranslate;
  const content = useMemo(() => buildEvolutionTickerContent(viewModel, tLoose), [viewModel, tLoose]);

  if (content.mode === 'HIDDEN') return null;

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
      {content.mode === 'MARQUEE' ? (
        <TickerMarquee items={content.items} />
      ) : content.mode === 'ACTION' ? (
        <TickerAction content={content} onPress={onPress} />
      ) : (
        <View style={{ paddingHorizontal: 22 }}>
          <MonoLabel>{content.text}</MonoLabel>
        </View>
      )}
    </View>
  );
}

function TickerMarquee({ items }: { items: TickerItem[] }) {
  const { theme } = useTheme();
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
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            letterSpacing: 2,
            color: theme.colors.textFaint,
          }}
        >
          {label ? `${label.toUpperCase()} ` : ''}
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

function TickerAction({
  content,
  onPress,
}: {
  content: Extract<EvolutionTickerContent, { mode: 'ACTION' }>;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={content.accessibilityLabel}
      hitSlop={4}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Icon name={content.icon} size={14} color={theme.colors.primaryEmphasis} />
        <View style={{ flexShrink: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: theme.fonts.monoBold,
              fontSize: 10,
              letterSpacing: 1.5,
              color: theme.colors.primaryEmphasis,
            }}
          >
            {content.headline.toUpperCase()}
          </Text>
          {content.earnedLevelNote ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 9,
                letterSpacing: 1,
                color: theme.colors.textFaint,
                marginTop: 2,
              }}
            >
              {content.earnedLevelNote.toUpperCase()}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <Text
          style={{
            fontFamily: theme.fonts.monoBold,
            fontSize: 10,
            letterSpacing: 1,
            color: theme.colors.primaryEmphasis,
          }}
        >
          {content.ctaLabel.toUpperCase()}
        </Text>
        <Icon name="chevron-right" size={12} color={theme.colors.primaryEmphasis} />
      </View>
    </Pressable>
  );
}
