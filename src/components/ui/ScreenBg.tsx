import React from 'react';
import { View, StyleProp, ViewStyle, StyleSheet } from 'react-native';
import { colors } from '../../theme/tokens';

export function ScreenBg({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.bg, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
});
