import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';

export function CarouselIndicators({
  count,
  activeIndex,
}: {
  count: number;
  activeIndex: number;
}) {
  const { theme } = useTheme();

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
              backgroundColor: active ? theme.colors.primaryEmphasis : theme.colors.border,
            }}
          />
        );
      })}
    </View>
  );
}
