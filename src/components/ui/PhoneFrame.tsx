import React from 'react';
import { View, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { Icon, type IconName } from './Icon';
import { MonoLabel } from './Display';
import { radii } from '../../theme/tokens';
import { useTheme } from '../../theme';

/** Modern-smartphone screen proportion (width / height). */
const SCREEN_ASPECT_RATIO = 9 / 19.5;
const BEZEL = 4;

/**
 * Minimal front-facing device frame: thin bezel, rounded corners, screenshot
 * filling almost the entire area. No 3D tilt, no home indicator/notch — kept
 * deliberately plain so the screenshot itself stays the focal point.
 */
export function PhoneFrame({
  width,
  image,
  placeholderIcon,
  placeholderLabel,
  accessibilityLabel,
  cropRatio = 1,
}: {
  width: number;
  image?: ImageSourcePropType;
  placeholderIcon: IconName;
  placeholderLabel: string;
  accessibilityLabel: string;
  /**
   * Fraction (0-1] of the full device screen height to show, measured from
   * the top. `1` shows the whole screen; `0.8` crops away the bottom 20% —
   * useful when the frame itself only needs to read as "a phone", not
   * reproduce a full screenshot edge-to-edge.
   */
  cropRatio?: number;
}) {
  const { theme } = useTheme();
  const fullHeight = width / SCREEN_ASPECT_RATIO;
  const height = fullHeight * cropRatio;
  // A crop should read as a genuine cut, not a rounded card — round only
  // the corners that are still the device's real top corners, and leave the
  // bottom edge flat where the screen was truncated.
  const cropped = cropRatio < 1;

  return (
    <View
      style={{
        width: width + BEZEL * 2,
        height: height + BEZEL + (cropped ? 0 : BEZEL),
        borderTopLeftRadius: radii.xxl + BEZEL,
        borderTopRightRadius: radii.xxl + BEZEL,
        borderBottomLeftRadius: cropped ? 0 : radii.xxl + BEZEL,
        borderBottomRightRadius: cropped ? 0 : radii.xxl + BEZEL,
        borderWidth: 2,
        borderBottomWidth: cropped ? 0 : 2,
        borderColor: theme.colors.borderStrong,
        backgroundColor: theme.colors.backgroundSecondary,
        padding: BEZEL,
        paddingBottom: cropped ? 0 : BEZEL,
        shadowColor: theme.colors.floatingShadow,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 22,
        elevation: 8,
      }}
    >
      <View
        style={{
          flex: 1,
          borderTopLeftRadius: radii.xxl,
          borderTopRightRadius: radii.xxl,
          borderBottomLeftRadius: cropped ? 0 : radii.xxl,
          borderBottomRightRadius: cropped ? 0 : radii.xxl,
          overflow: 'hidden',
          backgroundColor: theme.colors.surface,
        }}
      >
        {image ? (
          <Image
            source={image}
            accessible
            accessibilityLabel={accessibilityLabel}
            cachePolicy="memory-disk"
            contentFit="cover"
            contentPosition="top"
            transition={150}
            style={{ flex: 1 }}
          />
        ) : (
          <View
            accessible
            accessibilityLabel={accessibilityLabel}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                backgroundColor: theme.colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={placeholderIcon} size={20} color={theme.colors.primaryEmphasis} />
            </View>
            <MonoLabel color={theme.colors.textFaint} size={9}>
              {placeholderLabel}
            </MonoLabel>
          </View>
        )}
      </View>
    </View>
  );
}
