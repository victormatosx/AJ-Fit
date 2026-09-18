import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurTargetView, BlurView } from 'expo-blur';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { Display } from '../ui/Display';
import { radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { PhotoVaultIssue } from '../../lib/photoVaultErrors';
import type { PhotoVaultStatus } from '../../lib/photoVaultLock';
import { usePhotoVault } from '../../state/PhotoVaultContext';
import { PhotoVaultGallerySkeleton } from './PhotoVaultGallerySkeleton';

/**
 * What the user sees before the vault is open.
 *
 * Looks like the gallery itself — the caller renders the same header/footer
 * around this — with its content replaced by `PhotoVaultGallerySkeleton` (no
 * real photo data) and heavily blurred. The only control is a centered lock.
 * It never names a specific mechanism ("Face ID"), because the same build
 * runs on devices that will prompt for a fingerprint or screen lock instead.
 *
 * `BlurTargetView` + `blurTarget` + `blurMethod` are required for a REAL blur
 * on Android (SDK 56's `expo-blur`): without them Android only renders a flat
 * semi-transparent tint. `dimezisBlurViewSdk31Plus` gives a real blur on
 * Android 12+ and safely falls back to that flat tint on older Android
 * instead of paying for the slow RenderScript path — acceptable here because
 * the skeleton behind it never carries real data either way.
 *
 * When the vault is genuinely empty (never inferred from the locked-preview
 * cache — an account with real photos this device has not backfilled yet
 * must not be mistaken for one with none), a discreet, unblurred hint invites
 * the user to add their first photo. It sits above the blur so it stays
 * legible, and above the safe area so it never crowds the bottom navigation.
 */

interface Props {
  status: PhotoVaultStatus;
  issue: PhotoVaultIssue | null;
  onUnlock: () => void;
  /** Fires once the success animation finishes, so the caller can mount the real gallery. */
  onRevealComplete: () => void;
}

/** Issues that mean the device has nothing secure to authenticate with. */
const NOT_CONFIGURED: PhotoVaultIssue[] = [
  'vaultAuthNotConfigured',
  'vaultAuthNotEnrolled',
];

const LOCK_SIZE = 68;
const BLUR_INTENSITY = 28;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function useAuthErrorMessage(issue: PhotoVaultIssue | null): string | null {
  const { t } = useTranslation('home');

  switch (issue) {
    case 'vaultAuthCancelled':
      return t('progress.photos.authError.cancelled');
    case 'vaultAuthLockedOut':
      return t('progress.photos.authError.lockedOut');
    case 'vaultAuthUnavailable':
      return t('progress.photos.authError.unavailable');
    case 'vaultAuthFailed':
    case 'vaultUnlockFailed':
      return t('progress.photos.authError.failed');
    default:
      return null;
  }
}

export function PhotoVaultLockedState({
  status,
  issue,
  onUnlock,
  onRevealComplete,
}: Props) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { hasPhotoVaultContent, hasPhotoVaultContentReady } = usePhotoVault();
  const authenticating = status === 'authenticating';
  const notConfigured = issue !== null && NOT_CONFIGURED.includes(issue);
  const errorMessage = useAuthErrorMessage(issue);
  const [iconOpen, setIconOpen] = useState(false);
  const blurTargetRef = useRef<View | null>(null);
  /**
   * The vault is genuinely empty — never inferred from the locked-preview
   * cache being empty, which also happens for an account with real photos
   * that this device just has not backfilled yet. Reuses the same one-bit
   * signal the rest of the locked flow already trusts for this distinction.
   */
  const trulyEmpty = hasPhotoVaultContentReady && !hasPhotoVaultContent;

  const blurIntensity = useSharedValue(BLUR_INTENSITY);
  const shakeX = useSharedValue(0);
  const dangerFlash = useSharedValue(0);
  const successFlash = useSharedValue(0);

  const blurProps = useAnimatedProps(() => ({ intensity: blurIntensity.value }));

  const buttonStyle = useAnimatedStyle(() => {
    const backgroundColor =
      successFlash.value > 0
        ? interpolateColor(
            successFlash.value,
            [0, 1],
            [theme.colors.surfaceElevated, theme.colors.success],
          )
        : dangerFlash.value > 0
          ? interpolateColor(
              dangerFlash.value,
              [0, 1],
              [theme.colors.surfaceElevated, theme.colors.danger],
            )
          : theme.colors.surfaceElevated;

    const borderColor =
      successFlash.value > 0
        ? interpolateColor(
            successFlash.value,
            [0, 1],
            [theme.colors.primaryEmphasis, theme.colors.success],
          )
        : dangerFlash.value > 0
          ? interpolateColor(
              dangerFlash.value,
              [0, 1],
              [theme.colors.primaryEmphasis, theme.colors.danger],
            )
          : theme.colors.primaryEmphasis;

    return {
      backgroundColor,
      borderColor,
      transform: [{ translateX: shakeX.value }],
    };
  });

  // A real auth failure or cancellation: shake, flash red, tell a screen
  // reader — without reintroducing any visible error text.
  useEffect(() => {
    if (status !== 'locked' || !issue || notConfigured) return;

    shakeX.value = withSequence(
      withTiming(-8, { duration: 45 }),
      withTiming(8, { duration: 80 }),
      withTiming(-6, { duration: 80 }),
      withTiming(6, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
    dangerFlash.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(450, withTiming(0, { duration: 250 })),
    );
    if (errorMessage) AccessibilityInfo.announceForAccessibility(errorMessage);
    // Deliberately excludes `errorMessage`/`notConfigured`/the shared values:
    // this must re-run only when a NEW issue arrives while locked, not when
    // the translated message reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, status]);

  // Success: the lock flashes green, its icon swaps, the blur fades out, and
  // only then does the caller get to mount the real gallery.
  useEffect(() => {
    if (status !== 'unlocked') return;

    successFlash.value = withTiming(1, { duration: 150 });
    setIconOpen(true);
    blurIntensity.value = withDelay(
      200,
      withTiming(0, { duration: 400 }, (finished) => {
        if (finished) runOnJS(onRevealComplete)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // A background lock mid-transition must snap the visual back to locked
  // immediately — the skeleton has no real data either way, but the lock
  // must never be left looking open while the vault is not.
  useEffect(() => {
    if (status === 'unlocked') return;
    blurIntensity.value = BLUR_INTENSITY;
    successFlash.value = 0;
    setIconOpen(false);
  }, [status, blurIntensity, successFlash]);

  const handlePress = useCallback(() => {
    if (notConfigured) {
      void Linking.openSettings();
      return;
    }
    onUnlock();
  }, [notConfigured, onUnlock]);

  const accessibilityLabel = notConfigured
    ? t('progress.photos.notConfigured.openSettings')
    : t('progress.photos.a11y.unlock');

  return (
    <View style={{ flex: 1 }} accessibilityLabel={t('progress.photos.locked.title')}>
      <BlurTargetView ref={blurTargetRef} style={{ flex: 1 }}>
        <PhotoVaultGallerySkeleton />
      </BlurTargetView>

      <AnimatedBlurView
        blurTarget={blurTargetRef}
        blurMethod="dimezisBlurViewSdk31Plus"
        animatedProps={blurProps}
        tint={theme.mode === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.center} pointerEvents="box-none">
        <AnimatedPressable
          onPress={handlePress}
          disabled={authenticating}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: authenticating, busy: authenticating }}
          hitSlop={spacing[3]}
          style={[
            {
              width: LOCK_SIZE,
              height: LOCK_SIZE,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              opacity: authenticating ? theme.opacity.disabled : 1,
            },
            buttonStyle,
          ]}
        >
          <Icon
            name={iconOpen ? 'lock-open' : 'lock'}
            size={26}
            color={theme.colors.textPrimary}
            stroke={1.8}
          />
          {notConfigured ? (
            <View style={styles.badge}>
              <Icon name="alert-triangle" size={12} color={theme.colors.warning} />
            </View>
          ) : null}
        </AnimatedPressable>
      </View>

      {trulyEmpty ? (
        <View
          pointerEvents="none"
          style={[styles.emptyHint, { bottom: insets.bottom + spacing[6] }]}
        >
          <Display size={14} color={theme.colors.textMuted} skew={false} style={{ textAlign: 'center' }}>
            {t('progress.photos.locked.addPhotosHint').toUpperCase()}
          </Display>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1330',
  },
  emptyHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: sizes.screenGutter,
  },
});
