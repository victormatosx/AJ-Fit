import React from 'react';
import { Image, View } from 'react-native';

const LOGO = require('../../../assets/aj-logo.png');

type Props = {
  size?: number;
  glow?: boolean;
};

export function AJMark({ size = 96, glow = true }: Props) {
  return (
    <View
      style={
        glow
          ? {
              shadowColor: '#0b70f9',
              shadowOpacity: 0.65,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 0 },
            }
          : undefined
      }
    >
      <Image
        source={LOGO}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}
