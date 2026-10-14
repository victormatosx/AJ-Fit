import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';

import { Display } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';

/**
 * Wraps a real (but demo-data-fed) panel with a blurred, dimmed preview and a
 * centered unlock message — used by `BodyEvolutionView`/`LoadsEvolutionView`
 * when the account has no real data yet for that panel.
 *
 * The demo content behind the blur is never interactive and never announced
 * to a screen reader: it exists purely to show the shape of the real feature,
 * not to be touched. The message (icon, title, description, CTA) is plain
 * text over the blur — no card — and is centered in the full height the
 * caller gives this component (its parent chain sizes that to the visible
 * screen, via `ProgressScreen`'s `scrollEnabled`/`flexGrow` toggle), so it's
 * already centered on screen the moment the user lands here, with nothing to
 * scroll past. `overflow: hidden` crops the (purely decorative) demo content
 * to that same height instead of letting it dictate a taller, scrollable one.
 *
 * `fillHeight` (default `true`) picks which of those two layouts applies.
 * Pass `false` when locking a sub-section that sits alongside real,
 * unlocked content in the same screen (e.g. a composition block below an
 * already-real weight hero) — the root then sizes to its demo children
 * instead of stretching to the full available height, so it doesn't swallow
 * the sibling content's space.
 */

const BLUR_INTENSITY = 26;

interface Props {
  title: string;
  description: string;
  ctaLabel?: string;
  onPress?: () => void;
  fillHeight?: boolean;
  children: React.ReactNode;
}

export function EvolutionLockedPreview({ title, description, ctaLabel, onPress, fillHeight = true, children }: Props) {
  const { theme } = useTheme();
  const blurTargetRef = useRef<View | null>(null);

  return (
    <View style={[styles.root, fillHeight ? styles.rootFill : styles.rootInline]} accessibilityLabel={title}>
      {/* Fill-height mode stretches this to the flex:1 root regardless of
          content size; inline mode leaves it in normal flow so its natural
          (demo) content height is what gives `root` a height to begin with. */}
      <BlurTargetView ref={blurTargetRef} style={fillHeight ? StyleSheet.absoluteFill : undefined}>
        <View
          style={{ opacity: 0.45 }}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {children}
        </View>
      </BlurTargetView>

      <BlurView
        blurTarget={blurTargetRef}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={BLUR_INTENSITY}
        tint={theme.mode === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.message}>
          <Icon name="lock" size={26} color={theme.colors.primaryEmphasis} />
          <Display size={18} style={{ textAlign: 'center' }}>{title}</Display>
          <Text
            style={{
              fontFamily: theme.fonts.ui,
              fontSize: 13,
              lineHeight: 19,
              color: theme.colors.textMuted,
              textAlign: 'center',
            }}
          >
            {description}
          </Text>
          {ctaLabel && onPress ? (
            <Pressable
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              style={{
                marginTop: spacing[1],
                minHeight: sizes.controlMd,
                justifyContent: 'center',
                paddingHorizontal: spacing[5],
                borderRadius: radii.control,
                backgroundColor: theme.colors.primary,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.primaryForeground }}>
                {ctaLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    overflow: 'hidden',
  },
  rootFill: {
    flex: 1,
  },
  rootInline: {
    alignSelf: 'stretch',
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sizes.screenGutter,
  },
  message: {
    maxWidth: 280,
    alignItems: 'center',
    gap: spacing[3],
  },
});
