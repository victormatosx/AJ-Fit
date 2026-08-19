import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

export function ScreenBg({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.colors.background, overflow: 'hidden' },
        style,
      ]}
    >
      {children}
    </View>
  );
}
