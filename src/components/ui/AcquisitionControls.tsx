import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { AJ_RISE, AJ_SHEET_RISE } from '../aj/ajMomentTiming';
import { useTheme } from '../../theme';

/**
 * The control vocabulary shared by the four acquisition screens —
 * Questionnaire, Plan, account creation and Paywall.
 *
 * These are deliberately NOT the app's general-purpose controls. `CtaButton`
 * is a 58pt, gradient, uppercase display button used across the authenticated
 * app, and the approved acquisition design calls for something else entirely:
 * a flat 12pt-radius accent button with sentence-case semibold UI type. Those
 * are two different buttons, not one button with a flag — restyling the shared
 * one would silently redress Home, Workout, Settings and every other screen
 * that never asked to change.
 *
 * Everything here is presentation. No control reads app state, and none of
 * them decides whether it should be enabled — callers pass `disabled` from
 * their own existing rule.
 */

/** Full-width primary action. The design's `padding 17 / radius 12 / accent`. */
export function AqPrimaryButton({
  label,
  onPress,
  disabled,
  /** Secondary line under the label, for disclosures the design places inside the button. */
  supportLabel,
  /** The Plan and Paywall CTAs carry an accent glow; the questionnaire's does not. */
  glow,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  supportLabel?: string | null;
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[
        {
          width: '100%',
          paddingVertical: 17,
          paddingHorizontal: 16,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          opacity: disabled ? theme.opacity.disabled : 1,
          ...(glow
            ? {
                shadowColor: theme.colors.primaryGlowSoft,
                shadowOpacity: 1,
                shadowRadius: 26,
                shadowOffset: { width: 0, height: 0 },
              }
            : null),
        },
        style,
      ]}
    >
      <Text
        style={[
          {
            fontFamily: theme.fonts.uiSemi,
            fontSize: 15.5,
            color: theme.colors.primaryForeground,
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
      {supportLabel ? (
        <Text
          style={{
            fontFamily: theme.fonts.uiMed,
            fontSize: 12,
            color: theme.colors.textActionSupport,
          }}
        >
          {supportLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Outlined action — social sign-in, "not now", "try again". */
export function AqSecondaryButton({
  label,
  onPress,
  disabled,
  icon,
  style,
  textStyle,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[
        {
          width: '100%',
          paddingVertical: 15,
          paddingHorizontal: 16,
          borderRadius: theme.radii.md,
          borderWidth: 1,
          borderColor: theme.colors.fieldBorderStrong,
          backgroundColor: theme.colors.surface,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        style,
      ]}
    >
      {icon}
      <Text
        style={[
          { fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Quiet textual action — "skip", "I'd rather not say", "switch to login". */
export function AqTextAction({
  label,
  onPress,
  disabled,
  underline,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  underline?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[{ alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 }, style]}
    >
      <Text
        style={{
          fontFamily: theme.fonts.uiSemi,
          fontSize: 14,
          color: theme.colors.textSubtle,
          textDecorationLine: underline ? 'underline' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The design's segmented control: a pill track with an accent thumb that
 * slides between the options rather than appearing under the new one.
 *
 * Used for the Plan's Training/Diet tabs and, when an offering has exactly two
 * packages, for the Paywall's period selector. The thumb is positioned from
 * the measured track width, so it stays aligned under any text scale.
 */
export function AqSegmented({
  options,
  selectedId,
  onSelect,
  /** `tab` for panel switching, `radio` for a choice between values. */
  role = 'tab',
  accessibilityLabel,
  /** Mono labels, as the unit selector uses. */
  mono,
  /**
   * Where the badge sits relative to its label.
   *
   * `stacked` (default) keeps the tab/selector shape the Plan screen uses.
   * `chip` is the Paywall's: an inline pill beside the label, which is what
   * the approved design draws on the period selector.
   */
  badgeVariant = 'stacked',
  /** Track corner radius. The Paywall's selector is a 14pt rectangle, not a pill. */
  trackRadius,
  /** Thumb corner radius — follows the track unless the design insets it (14 → 10). */
  thumbRadius,
  style,
}: {
  options: { id: string; label: string; badge?: string | null }[];
  selectedId: string;
  onSelect: (id: string) => void;
  role?: 'tab' | 'radio';
  accessibilityLabel?: string;
  mono?: boolean;
  badgeVariant?: 'stacked' | 'chip';
  trackRadius?: number;
  thumbRadius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));
  const slot = options.length > 0 ? (trackWidth - 8) / options.length : 0;
  const thumb = useRef(new Animated.Value(selectedIndex)).current;

  useEffect(() => {
    const animation = Animated.timing(thumb, {
      toValue: selectedIndex,
      duration: AQ_SEGMENTED_SLIDE_MS,
      // A touch of overshoot, so the thumb arrives rather than stops.
      easing: Easing.bezier(0.3, 1.2, 0.5, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [selectedIndex, thumb]);

  return (
    <View
      accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: 'row',
          padding: 4,
          borderRadius: trackRadius ?? theme.radii.pill,
          backgroundColor: theme.colors.surfaceMuted,
          borderWidth: 1,
          borderColor: theme.colors.divider,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {trackWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 4,
            width: slot,
            borderRadius: thumbRadius ?? trackRadius ?? theme.radii.pill,
            backgroundColor: theme.colors.primary,
            shadowColor: theme.colors.primaryGlowSoft,
            shadowOpacity: 1,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
            transform: [
              {
                translateX: thumb.interpolate({
                  inputRange: options.map((_, index) => index),
                  outputRange: options.map((_, index) => index * slot),
                }),
              },
            ],
          }}
        />
      ) : null}

      {options.map((option) => {
        const selected = option.id === selectedId;
        const chip = badgeVariant === 'chip';
        return (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option.id)}
            accessibilityRole={role}
            accessibilityState={{ selected }}
            accessibilityLabel={
              option.badge ? `${option.label}, ${option.badge}` : option.label
            }
            style={{
              flex: 1,
              paddingVertical: chip ? 11 : 10,
              flexDirection: chip ? 'row' : 'column',
              gap: chip ? 7 : 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: mono ? theme.fonts.mono : theme.fonts.uiSemi,
                fontSize: mono ? 10.5 : chip ? 14.5 : 14,
                letterSpacing: mono ? 1 : 0,
                color: selected ? theme.colors.primaryForeground : theme.colors.textMuted,
              }}
            >
              {option.label}
            </Text>
            {option.badge ? (
              chip ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 5,
                    backgroundColor: selected
                      ? theme.colors.primaryForegroundSurface
                      : theme.colors.primarySurface,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: theme.fonts.uiBold,
                      fontSize: 10.5,
                      color: selected
                        ? theme.colors.primaryForeground
                        : theme.colors.primaryEmphasis,
                    }}
                  >
                    {option.badge}
                  </Text>
                </View>
              ) : (
                <Text
                  style={{
                    marginTop: 2,
                    fontFamily: theme.fonts.mono,
                    fontSize: 9.5,
                    letterSpacing: 0.8,
                    color: selected ? theme.colors.primaryForeground : theme.colors.primaryEmphasis,
                  }}
                >
                  {option.badge}
                </Text>
              )
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** How long the segmented thumb takes to slide between options. */
const AQ_SEGMENTED_SLIDE_MS = 320;

/** The mono kicker the design puts above a title or a section. */
export function AqMonoLabel({
  children,
  color,
  style,
}: {
  children: string;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { theme } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: theme.fonts.mono,
          fontSize: 10,
          letterSpacing: 1.8,
          color: color ?? theme.colors.textLabelFaint,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * Content entering a step or a sheet: opacity 0→1 with a 14pt lift. The
 * design staggers siblings by 40–60ms, which is what `delay` is for.
 *
 * Distinct from `RiseIn` (600ms, used for the authenticated app's section
 * cascades) only in duration and distance — both are the same gesture, and the
 * numbers live in `AJ_RISE` so the acquisition surfaces agree with each other.
 */
export function AqRise({
  children,
  delay = 0,
  duration = AJ_RISE.durationMs,
  translateY = AJ_RISE.translateY,
  reduceMotion = false,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  translateY?: number;
  reduceMotion?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return () => undefined;
    }
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [anim, delay, duration, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [translateY, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The design's bottom sheet: anchored to the bottom edge, 28pt top corners, a
 * centred handle, and a rise on arrival. Used for the Plan, Auth and Paywall
 * surfaces and for the questionnaire's safety notice.
 */
export function AqSheet({
  children,
  delay = 0,
  reduceMotion = false,
  /** The safety notice uses the alternate, one-step-lighter sheet colour. */
  alternate,
  /**
   * Drops the grab handle, the rounded top and the top border, for a caller
   * whose sheet IS the screen rather than a panel risen over one — there is no
   * edge left to round and nothing to grab.
   */
  flush,
  /** Measured top edge, which AJ needs in order to perch on it. */
  onSheetLayout,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  reduceMotion?: boolean;
  alternate?: boolean;
  flush?: boolean;
  onSheetLayout?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return () => undefined;
    }
    const [b1, b2, b3, b4] = AJ_SHEET_RISE.bezier;
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: AJ_SHEET_RISE.durationMs,
      delay,
      easing: Easing.bezier(b1, b2, b3, b4),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [anim, delay, reduceMotion]);

  return (
    <Animated.View
      onLayout={(event) => onSheetLayout?.(event.nativeEvent.layout.height)}
      style={[
        {
          backgroundColor: alternate ? theme.colors.sheetBackgroundAlt : theme.colors.background,
          borderTopLeftRadius: flush ? 0 : 28,
          borderTopRightRadius: flush ? 0 : 28,
          borderTopWidth: flush ? 0 : 1,
          borderTopColor: theme.colors.divider,
          paddingTop: 28,
          paddingHorizontal: 22,
          paddingBottom: 34,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [AJ_SHEET_RISE.translateY, 0],
              }),
            },
          ],
        },
        style,
      ]}
    >
      {flush ? null : (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            marginLeft: -18,
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.textPrimary,
          }}
        />
      )}
      {children}
    </Animated.View>
  );
}
