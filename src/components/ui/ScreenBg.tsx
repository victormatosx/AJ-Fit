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
  return (
    <View style={[styles.bg, style]}>
      {/* Soft top-left blue glow */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -200,
          left: -100,
          width: 500,
          height: 500,
          borderRadius: 250,
          backgroundColor: '#0a0530',
          opacity: 0.55,
        }}
      />
      {/* Soft bottom-right blue glow */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: -200,
          right: -100,
          width: 500,
          height: 500,
          borderRadius: 250,
          backgroundColor: '#051236',
          opacity: 0.55,
        }}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
});
