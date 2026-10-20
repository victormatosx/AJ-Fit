import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurTargetView, BlurView } from 'expo-blur';
import Animated, {
  interpolateColor,
  runOnJS,
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
 * The brief transition shown while the gallery is opening.
 *
 * The gallery opens directly — there is no biometric prompt, passcode or
 * unlock screen — so this is a LOADING state, not a gate: it looks like the
 * gallery itself (the caller renders the same header/footer around this) with
 * its content replaced by `PhotoVaultGallerySkeleton` (no real photo data)
 * and heavily blurred, and the whole layer simply fades out once the session
 * opens. No lock control is offered, because there is nothing for the user to
 * unlock.
 *
 * The reveal fades this layer's OPACITY and holds the blur at full strength
 * for all of it — never the other way around. Animating the blur's intensity
 * down to zero instead would spend the whole transition making the skeleton
 * progressively legible, ending on several frames of a sharp grid of
 * placeholder tiles (or of cached, already-degraded previews) sitting under
 * the real header, which reads as the gallery rendering wrong rather than as
 * a screen opening.
 *
 * A retry control appears ONLY if opening the session fails for a genuine
 * technical reason (temporary files that could not be cleared, the native
 * app-switcher guard refusing to install, the app backgrounding mid-open).
 * Those are rare and recoverable, and without this the screen would have no
 * way forward.
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
  /** Retries opening the session after a technical failure. */
  onUnlock: () => void;
  /** Fires once the reveal finishes, so the caller can mount the real gallery. */
  onRevealComplete: () => void;
}

const RETRY_SIZE = 68;
const BLUR_INTENSITY = 28;
/**
 * How long this layer takes to clear once the session is open.
 *
 * Short on purpose: opening the vault no longer waits on an OS prompt, so
 * this is the only thing standing between the tap and the gallery.
 */
const REVEAL_DURATION = 180;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  /**
   * One message for every failure the caller still reports: each is a
   * technical problem the user can only respond to by retrying, and naming
   * the internal cause would say nothing useful. Authentication-specific
   * copy (locked out, not enrolled, no passcode set) became unreachable when
   * the gallery stopped requiring an OS authentication step.
   */
  const errorMessage = t('progress.photos.authError.failed');
  const blurTargetRef = useRef<View | null>(null);
  /**
   * The vault is genuinely empty — never inferred from the locked-preview
   * cache being empty, which also happens for an account with real photos
   * that this device just has not backfilled yet. Reuses the same one-bit
   * signal the rest of the flow already trusts for this distinction.
   */
  const trulyEmpty = hasPhotoVaultContentReady && !hasPhotoVaultContent;
  /** A failure the user can act on, rather than a session still opening. */
  const showRetry = status === 'locked' && issue !== null;

  const revealOpacity = useSharedValue(1);
  const shakeX = useSharedValue(0);
  const dangerFlash = useSharedValue(0);

  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));

  const retryStyle = useAnimatedStyle(() => ({
    backgroundColor:
      dangerFlash.value > 0
        ? interpolateColor(
            dangerFlash.value,
            [0, 1],
            [theme.colors.surfaceElevated, theme.colors.danger],
          )
        : theme.colors.surfaceElevated,
    borderColor:
      dangerFlash.value > 0
        ? interpolateColor(
            dangerFlash.value,
            [0, 1],
            [theme.colors.primaryEmphasis, theme.colors.danger],
          )
        : theme.colors.primaryEmphasis,
    transform: [{ translateX: shakeX.value }],
  }));

  // A real failure: shake, flash red, tell a screen reader — without
  // rendering any visible error text.
  useEffect(() => {
    if (status !== 'locked' || !issue) return;

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
    AccessibilityInfo.announceForAccessibility(errorMessage);
    // Deliberately excludes `errorMessage`/the shared values: this must re-run
    // only when a NEW issue arrives, not when the translated message reference
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, status]);

  // The session is open: fade this layer out — blurred the whole way — and
  // only then does the caller get to mount the real gallery.
  useEffect(() => {
    if (status !== 'unlocked') return;

    revealOpacity.value = withTiming(0, { duration: REVEAL_DURATION }, (finished) => {
      if (finished) runOnJS(onRevealComplete)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // A background lock mid-transition must snap the visual back immediately —
  // the skeleton has no real data either way, but this layer must never be
  // left faded out while the session is closed.
  useEffect(() => {
    if (status === 'unlocked') return;
    revealOpacity.value = 1;
  }, [status, revealOpacity]);

  return (
    <Animated.View
      style={[{ flex: 1 }, revealStyle]}
      accessibilityLabel={t('progress.photos.locked.title')}
    >
      <BlurTargetView ref={blurTargetRef} style={{ flex: 1 }}>
        <PhotoVaultGallerySkeleton />
      </BlurTargetView>

      <BlurView
        blurTarget={blurTargetRef}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={BLUR_INTENSITY}
        tint={theme.mode === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {showRetry ? (
        <View style={styles.center} pointerEvents="box-none">
          <AnimatedPressable
            onPress={onUnlock}
            accessibilityRole="button"
            accessibilityLabel={t('progress.photos.list.retry')}
            testID="photo-vault-open-retry"
            hitSlop={spacing[3]}
            style={[
              {
                width: RETRY_SIZE,
                height: RETRY_SIZE,
                borderRadius: radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
              },
              retryStyle,
            ]}
          >
            <Icon name="refresh" size={26} color={theme.colors.textPrimary} stroke={1.8} />
          </AnimatedPressable>
        </View>
      ) : null}

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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: sizes.screenGutter,
  },
});
