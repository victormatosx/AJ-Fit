import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();

  return (
    <LinearGradient
      colors={theme.gradients.glass}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        {
          borderRadius: theme.radii.xl,
          borderWidth: 1,
          borderColor: theme.colors.cardBorder,
        },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
}

export function HudCorners({ color }: { color?: string }) {
  const { theme } = useTheme();
  const resolvedColor = color ?? theme.colors.hudCorner;

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
          borderColor: resolvedColor,
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
          borderColor: resolvedColor,
        }}
      />
    </>
  );
}
