import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { MEASUREMENT_UNITS, type DisplayUnit, type MeasurementKind } from './unitDisplay';

/** Overall pill width, and the indicator geometry derived from it. */
const TOGGLE_WIDTH = 190;
const TRACK_PADDING = 4;
const INDICATOR_WIDTH = (TOGGLE_WIDTH - TRACK_PADDING * 2) / 2;
/** Slide timing from the design: 300ms with a slight overshoot. */
const SLIDE_MS = 300;
const SLIDE_EASING = Easing.bezier(0.3, 1.2, 0.5, 1);
const LABEL_PADDING_VERTICAL = 9;
/** Minimum comfortable touch height; made up with hitSlop, not with padding. */
const MIN_TOUCH_HEIGHT = 44;

/**
 * The CM/FT and KG/LB selector that sits above the ruler on every body
 * measurement question.
 *
 * It chooses how the measurement is *displayed* and nothing else — the
 * answer is stored in the same unit either way (see `unitDisplay.ts`). The
 * selection is held by the caller so that it can be shared between the two
 * weight steps without being persisted anywhere.
 */
export function UnitToggle({
  kind,
  value,
  onChange,
  reduceMotion = false,
  compact = false,
}: {
  kind: MeasurementKind;
  value: DisplayUnit;
  onChange: (next: DisplayUnit) => void;
  reduceMotion?: boolean;
  /** Short viewports tighten the gap below the pill. */
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const options = MEASUREMENT_UNITS[kind];
  const selectedIndex = Math.max(0, options.indexOf(value));

  const offset = useSharedValue(selectedIndex * INDICATOR_WIDTH);

  useEffect(() => {
    const target = selectedIndex * INDICATOR_WIDTH;
    offset.value = reduceMotion
      ? target
      : withTiming(target, { duration: SLIDE_MS, easing: SLIDE_EASING });
  }, [selectedIndex, reduceMotion, offset]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t(`units.groupLabel.${kind}`)}
      style={[
        styles.track,
        {
          marginBottom: compact ? 20 : 30,
          backgroundColor: theme.colors.choiceBackground,
          borderColor: theme.colors.choiceBorder,
        },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.indicator,
          {
            backgroundColor: theme.colors.primary,
            // Matches the design's `0 0 16 rgba(11,112,249,0.45)`. Android
            // ignores `shadow*`; the pill reads correctly there without it,
            // so it is simply absent rather than faked with a second layer.
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.45,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
          },
          indicatorStyle,
        ]}
      />
      {options.map((unit) => {
        const selected = unit === value;
        return (
          <Pressable
            key={unit}
            onPress={() => {
              if (!selected) onChange(unit);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={t(`units.full.${unit}`)}
            hitSlop={{
              top: Math.max(0, (MIN_TOUCH_HEIGHT - LABEL_PADDING_VERTICAL * 2) / 2),
              bottom: Math.max(0, (MIN_TOUCH_HEIGHT - LABEL_PADDING_VERTICAL * 2) / 2),
            }}
            style={styles.label}
          >
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 10.5,
                letterSpacing: 1.6,
                textAlign: 'center',
                color: selected ? theme.colors.primaryForeground : theme.colors.textSubtleStrong,
              }}
            >
              {t(`units.${unit}`).toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TOGGLE_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    padding: TRACK_PADDING,
    borderRadius: 999,
    borderWidth: 1,
  },
  indicator: {
    position: 'absolute',
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    left: TRACK_PADDING,
    width: INDICATOR_WIDTH,
    borderRadius: 999,
  },
  label: {
    flex: 1,
    paddingVertical: LABEL_PADDING_VERTICAL,
  },
});
