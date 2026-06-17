import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../theme/tokens';

type Props = {
  value: number;
  segs?: number;
  style?: StyleProp<ViewStyle>;
};

export function SegBar({ value, segs = 14, style }: Props) {
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
                backgroundColor: '#fff',
                transform: [{ skewX: '-22deg' }],
                shadowColor: '#fff',
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
              colors={[colors.accent, colors.accentHi]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                flex: 1,
                height: 7,
                borderRadius: 1,
                transform: [{ skewX: '-22deg' }],
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
              backgroundColor: 'rgba(255,255,255,0.09)',
              transform: [{ skewX: '-22deg' }],
            }}
          />
        );
      })}
    </View>
  );
}
