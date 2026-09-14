import React from 'react';
import { Text, TextStyle, StyleProp, View, ViewStyle } from 'react-native';
import { displayLineHeight } from '../../theme/tokens';
import { useTheme } from '../../theme';

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
  color,
  style,
  skew = true,
  numberOfLines,
}: Props) {
  const { theme } = useTheme();
  const resolvedColor = color ?? theme.colors.textPrimary;
  const inner = (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: theme.fonts.display,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: size,
          lineHeight: displayLineHeight(size),
          color: resolvedColor,
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
  accentColor,
  textColor,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accentColor?: string;
  textColor?: string;
}) {
  const { theme } = useTheme();

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
      <Text
        style={{
          fontFamily: theme.fonts.monoBold,
          fontSize: 10,
          letterSpacing: 2.5,
          color: accentColor ?? theme.colors.primaryEmphasis,
        }}
      >
        //
      </Text>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          letterSpacing: 2.5,
          color: textColor ?? theme.colors.textFaint,
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
  color,
  size = 10,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  color?: string;
  size?: number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { theme } = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: theme.fonts.mono,
          fontSize: size,
          letterSpacing: 2,
          color: color ?? theme.colors.textFaint,
          textTransform: 'uppercase',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
