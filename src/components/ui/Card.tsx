import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../theme/tokens';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.015)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        {
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
}

export function HudCorners({ color = 'rgba(77,163,255,0.65)' }: { color?: string }) {
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          width: 14,
          height: 14,
          borderTopWidth: 1.5,
          borderLeftWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          width: 14,
          height: 14,
          borderBottomWidth: 1.5,
          borderRightWidth: 1.5,
          borderColor: color,
        }}
      />
    </>
  );
}
