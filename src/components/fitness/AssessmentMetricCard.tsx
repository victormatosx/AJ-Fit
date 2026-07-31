import React from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { colors, fonts } from '../../theme/tokens';

export function AssessmentMetricCard({
  label,
  value,
  unit,
  icon,
  size = 'lg',
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: IconName;
  size?: 'lg' | 'sm';
  style?: StyleProp<ViewStyle>;
}) {
  const big = size === 'lg';
  return (
    <Card style={[{ padding: big ? 15 : 10 }, style]}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: big ? 10 : 6,
        }}
      >
        <MonoLabel size={big ? 10 : 8}>{label}</MonoLabel>
        {icon && <Icon name={icon} size={big ? 14 : 11} color={colors.accentHi} />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: big ? 26 : 16,
            color: '#fff',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {value}
        </Text>
        {unit ? <MonoLabel size={big ? 10 : 8}>{unit}</MonoLabel> : null}
      </View>
    </Card>
  );
}
