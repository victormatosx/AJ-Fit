import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { Card } from './Card';
import { Icon, IconName } from './Icon';
import { MonoLabel } from './Display';
import { colors, fonts } from '../../theme/tokens';

export function FoldableSection({
  icon,
  title,
  summary,
  defaultExpanded = false,
  children,
}: {
  icon?: IconName;
  title: string;
  summary?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const chevronRot = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(chevronRot, {
      toValue: open ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [open, chevronRot]);

  return (
    <Card style={{ overflow: 'hidden' }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 16,
          backgroundColor: pressed ? 'rgba(255,255,255,0.03)' : 'transparent',
        })}
      >
        {icon && (
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: 'rgba(11,112,249,0.14)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={icon} size={16} color={colors.accentHi} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: '#fff' }}>{title}</Text>
          {summary ? <MonoLabel style={{ marginTop: 3 }}>{summary}</MonoLabel> : null}
        </View>
        <Animated.View
          style={{
            transform: [
              {
                rotate: chevronRot.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '90deg'],
                }),
              },
            ],
          }}
        >
          <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.4)" />
        </Animated.View>
      </Pressable>
      {open && <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>{children}</View>}
    </Card>
  );
}
