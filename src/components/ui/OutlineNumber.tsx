import React from 'react';
import { Text, StyleProp, TextStyle } from 'react-native';
import { fonts } from '../../theme/tokens';

/**
 * Faux outline text — RN doesn't support text-stroke. We fake it with a
 * very transparent fill and tight letter spacing. Works for the background
 * giant numbers/letters on splash, onboarding, plan card, etc.
 */
export function OutlineNumber({
  children,
  size = 200,
  color = 'rgba(255,255,255,0.22)',
  style,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        {
          fontFamily: fonts.display,
          fontSize: size,
          lineHeight: size * 0.9,
          letterSpacing: 0.5,
          color: 'transparent',
          textShadowColor: color,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 1.2,
        },
        style,
      ]}
      selectable={false}
    >
      {children}
    </Text>
  );
}
