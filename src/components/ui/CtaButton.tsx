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
import { displayLineHeight } from '../../theme/tokens';
import { useTheme, type AppTheme } from '../../theme';

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
  /**
   * Overrides the active app theme. Only for surfaces pinned to a fixed art
   * direction — Home's Today card is Dark in both themes
   * (`TODAY_WORKOUT_THEME`), so the CTAs inside it must be handed that theme
   * instead of resolving the live one. Omitted everywhere else, which keeps
   * the ordinary `useTheme()` behavior untouched.
   */
  theme?: AppTheme;
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
  theme: themeOverride,
}: Props) {
  const { theme: activeTheme } = useTheme();
  const theme = themeOverride ?? activeTheme;
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
            backgroundColor: theme.colors.surfaceElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
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
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.uiSemi,
              fontSize: 14,
            }}
          >
            {children}
          </Text>
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
        colors={theme.gradients.brand}
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
          shadowColor: theme.shadows.accent.shadowColor,
          shadowOffset: theme.shadows.accent.shadowOffset,
          shadowOpacity: disabled ? 0 : theme.shadows.accent.shadowOpacity,
          shadowRadius: disabled ? 0 : theme.shadows.accent.shadowRadius,
          elevation: disabled ? 0 : theme.shadows.accent.elevation,
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
            backgroundColor: theme.colors.controlHighlight,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          }}
        />
        {typeof children === 'string' ? (
          <Text
            style={{
              color: theme.colors.primaryForeground,
              fontFamily: theme.fonts.display,
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

export function CtaText({
  children,
  theme: themeOverride,
  numberOfLines,
}: {
  children: React.ReactNode;
  /** Same purpose as `CtaButton`'s own `theme` — see its doc comment. */
  theme?: AppTheme;
  /**
   * Lets a long label wrap instead of overflowing the button's fixed height.
   * Omitted keeps the single-line default every existing caller relies on.
   */
  numberOfLines?: number;
}) {
  const { theme: activeTheme } = useTheme();
  const theme = themeOverride ?? activeTheme;

  return (
    <Text
      numberOfLines={numberOfLines}
      style={{
        flexShrink: 1,
        color: theme.colors.primaryForeground,
        fontFamily: theme.fonts.display,
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
