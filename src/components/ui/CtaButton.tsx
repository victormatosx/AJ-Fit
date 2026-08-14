import React from 'react';
import {
  Pressable,
  View,
  Text,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, displayLineHeight, fonts } from '../../theme/tokens';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  ghost?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityState?: AccessibilityState;
  /**
   * Screen-reader label. Useful when the visible text is truncated, or when
   * the button renders an indicator instead of its label.
   */
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function CtaButton({
  children,
  onPress,
  ghost,
  disabled,
  style,
  accessibilityState,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const a11y = {
    accessibilityRole: 'button' as const,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState: {
      ...accessibilityState,
      disabled: Boolean(disabled || accessibilityState?.disabled),
    },
  };
  if (ghost) {
    return (
      <Pressable
        {...a11y}
        onPress={onPress}
        disabled={disabled}
        style={[
          {
            width: '100%',
            height: 58,
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
      {...a11y}
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
          shadowOpacity: disabled ? 0 : 0.45,
          shadowRadius: disabled ? 0 : 30,
          elevation: disabled ? 0 : 12,
        }}
      >
        {/* Top inner highlight: CSS uses inset 0 1px 0 rgba(255,255,255,0.35).
            RN has no inset shadow, so we overlay a 1px bright edge. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.35)',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          }}
        />
        {typeof children === 'string' ? (
          <Text
            style={{
              color: '#fff',
              fontFamily: fonts.display,
              fontSize: 17,
              lineHeight: displayLineHeight(17),
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              textAlign: 'center',
              textAlignVertical: 'center',
              includeFontPadding: false,
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
        lineHeight: displayLineHeight(17),
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        textAlign: 'center',
        textAlignVertical: 'center',
        includeFontPadding: false,
      }}
    >
      {children}
    </Text>
  );
}
