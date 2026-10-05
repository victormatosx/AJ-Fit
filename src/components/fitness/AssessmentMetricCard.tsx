import React, { useEffect } from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';

/** Same breathing pulse used elsewhere for "still loading" placeholders
 * (0.75↔1, 1100ms, ease-in-out) — one consistent, deliberately subtle idiom. */
function ValueSkeleton({ width, height }: { width: number; height: number }) {
  const { theme } = useTheme();
  const opacity = useSharedValue(0.75);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.75, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: 4, backgroundColor: theme.colors.surfaceQuiet }, animatedStyle]}
    />
  );
}

export function AssessmentMetricCard({
  label,
  value,
  unit,
  icon,
  size = 'lg',
  style,
  loading = false,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: IconName;
  size?: 'lg' | 'sm';
  style?: StyleProp<ViewStyle>;
  /** Keeps the card, label and icon exactly as normal — only the value (and
   * unit) swap for a same-sized skeleton. Never render a real `value` (e.g.
   * "0") just because the caller hasn't got fresh data yet; pass `loading`
   * instead. */
  loading?: boolean;
}) {
  const { theme } = useTheme();
  const big = size === 'lg';
  const fontSize = big ? 26 : 16;
  // Shared between the real value and its skeleton so swapping one for the
  // other never changes this row's (or the whole card's) height — a mismatch
  // here was exactly what shifted the surrounding grid when data arrived.
  const valueLineHeight = displayLineHeight(fontSize);
  return (
    <Card style={[{ padding: big ? 15 : 10 }, style]}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: big ? 10 : 6,
        }}
      >
        <MonoLabel size={big ? 10 : 8}>{label}</MonoLabel>
        {icon && (
          <Icon name={icon} size={big ? 14 : 11} color={theme.colors.primaryEmphasis} />
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        {loading ? (
          <ValueSkeleton width={fontSize} height={valueLineHeight} />
        ) : (
          <>
            <Text
              style={{
                fontFamily: theme.fonts.display,
                fontSize,
                lineHeight: valueLineHeight,
                color: theme.colors.textPrimary,
                transform: [{ skewX: '-8deg' }],
              }}
            >
              {value}
            </Text>
            {unit ? <MonoLabel size={big ? 10 : 8}>{unit}</MonoLabel> : null}
          </>
        )}
      </View>
    </Card>
  );
}
