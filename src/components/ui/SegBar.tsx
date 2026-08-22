import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';

type Props = {
  value: number;
  segs?: number;
  style?: StyleProp<ViewStyle>;
};

export function SegBar({ value, segs = 14, style }: Props) {
  const { theme } = useTheme();
  const on = Math.round(value * segs);
  return (
    <View style={[{ flexDirection: 'row', gap: 3 }, style]}>
      {Array.from({ length: segs }).map((_, i) => {
        const isOn = i < on;
        const isHot = i === on - 1;
        if (isHot) {
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: 7,
                borderRadius: 1,
                backgroundColor: theme.colors.progressHighlight,
                transform: [{ skewX: '-22deg' }],
                shadowColor: theme.colors.progressHighlight,
                shadowOpacity: 0.8,
                shadowRadius: 6,
              }}
            />
          );
        }
        if (isOn) {
          return (
            <LinearGradient
              key={i}
              colors={theme.gradients.progress}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                flex: 1,
                height: 7,
                borderRadius: 1,
                transform: [{ skewX: '-22deg' }],
                shadowColor: theme.colors.primary,
                shadowOpacity: 0.7,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 0 },
              }}
            />
          );
        }
        return (
          <View
            key={i}
            style={{
              flex: 1,
              height: 7,
              borderRadius: 1,
              backgroundColor: theme.colors.progressTrack,
              transform: [{ skewX: '-22deg' }],
            }}
          />
        );
      })}
    </View>
  );
}
