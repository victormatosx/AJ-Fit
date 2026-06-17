import React from 'react';
import { Pressable, View, Text, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts } from '../../theme/tokens';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  ghost?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function CtaButton({ children, onPress, ghost, disabled, style }: Props) {
  if (ghost) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={[
          {
            width: '100%',
            height: 56,
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            opacity: disabled ? 0.4 : 1,
          },
          style,
        ]}
      >
        {typeof children === 'string' ? (
          <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>{children}</Text>
        ) : (
          children
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[{ opacity: disabled ? 0.35 : 1 }, style]}
    >
      <LinearGradient
        colors={['#1f82ff', colors.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          width: '100%',
          height: 58,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          borderBottomLeftRadius: 12,
          borderBottomRightRadius: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          shadowColor: colors.accent,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.45,
          shadowRadius: 20,
          elevation: 8,
        }}
      >
        {typeof children === 'string' ? (
          <Text
            style={{
              color: '#fff',
              fontFamily: fonts.display,
              fontSize: 17,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function CtaText({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: '#fff',
        fontFamily: fonts.display,
        fontSize: 17,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}
