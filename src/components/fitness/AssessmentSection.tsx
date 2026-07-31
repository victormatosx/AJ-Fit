import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { Slash } from '../ui/Display';

export function AssessmentSection({
  title,
  right,
  children,
  style,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ paddingHorizontal: 22, paddingTop: 26 }, style]}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Slash>{title}</Slash>
        {right}
      </View>
      {children}
    </View>
  );
}
