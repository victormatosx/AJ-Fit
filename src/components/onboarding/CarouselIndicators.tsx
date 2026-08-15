import React from 'react';
import { View } from 'react-native';
import { colors } from '../../theme/tokens';

export function CarouselIndicators({
  count,
  activeIndex,
}: {
  count: number;
  activeIndex: number;
}) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}
    >
      {Array.from({ length: count }).map((_, i) => {
        const active = i === activeIndex;
        return (
          <View
            key={i}
            style={{
              width: active ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: active ? colors.accentHi : colors.border,
            }}
          />
        );
      })}
    </View>
  );
}
