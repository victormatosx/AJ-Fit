import React from 'react';
import { Text, TextStyle, StyleProp, View, ViewStyle } from 'react-native';
import { colors, fonts } from '../../theme/tokens';

type Props = {
  children: React.ReactNode;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  skew?: boolean;
  numberOfLines?: number;
};

export function Display({
  children,
  size = 34,
  color = colors.text,
  style,
  skew = true,
  numberOfLines,
}: Props) {
  const inner = (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: fonts.display,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: size,
          lineHeight: size * 0.95,
          color,
          transform: skew ? [{ skewX: '-8deg' }] : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
  return inner;
}

export function Slash({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
      <Text
        style={{
          fontFamily: fonts.monoBold,
          fontSize: 10,
          letterSpacing: 2.5,
          color: colors.accentHi,
        }}
      >
        //
      </Text>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 2.5,
          color: colors.faint,
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Text>
    </View>
  );
}

export function MonoLabel({
  children,
  color = colors.faint,
  size = 10,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        {
          fontFamily: fonts.mono,
          fontSize: size,
          letterSpacing: 2,
          color,
          textTransform: 'uppercase',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
