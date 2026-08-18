import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

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
        contentFit="contain"
        cachePolicy="memory"
        transition={0}
      />
    </View>
  );
}
