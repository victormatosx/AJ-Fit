import React from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type { PhotoVaultIssue } from '../../lib/photoVaultErrors';

/**
 * What the user sees before the vault is open.
 *
 * Shows no photos, no count, no dates and no previews — nothing that could
 * leak the contents of a locked vault. It also never names a specific
 * mechanism ("Face ID"), because the same build runs on devices that will
 * prompt for a fingerprint or the screen lock instead.
 *
 * The lattice below is deliberately a fixed decoration, not a representation
 * of the gallery: it is the same six frames whether the user has zero photos
 * or two hundred. Nothing here is derived from vault contents, and no image is
 * fetched or decrypted to be obscured — a blurred real photo would mean
 * decrypting it, which is exactly what the lock exists to prevent.
 */

interface Props {
  status: 'locked' | 'authenticating';
  issue: PhotoVaultIssue | null;
  onUnlock: () => void;
}

/** Issues that mean the device has nothing secure to authenticate with. */
const NOT_CONFIGURED: PhotoVaultIssue[] = [
  'vaultAuthNotConfigured',
  'vaultAuthNotEnrolled',
];

const GUTTER = sizes.screenGutter;

/**
 * Maps an internal issue onto user-facing copy. Native error codes never
 * reach the screen.
 */
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

/** Static placeholder frames. Count and content are constants, never data. */
function LockedLattice() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}
    >
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View
          key={index}
          style={{
            width: `${100 / 3 - 3}%`,
            aspectRatio: 0.78,
            borderRadius: 10,
            borderWidth: sizes.hairline,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            opacity: 1 - index * 0.12,
          }}
        />
      ))}
    </View>
  );
}

export function PhotoVaultLockedState({ status, issue, onUnlock }: Props) {
  const { t } = useTranslation('home');
  const authenticating = status === 'authenticating';
  const notConfigured = issue !== null && NOT_CONFIGURED.includes(issue);
  const errorMessage = useAuthErrorMessage(issue);

  const title = notConfigured
    ? t('progress.photos.notConfigured.title')
    : t('progress.photos.locked.title');
  const description = notConfigured
    ? t('progress.photos.notConfigured.description')
    : t('progress.photos.locked.description');

  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[2] }}>
      <LockedLattice />

      <View
        style={{
          height: sizes.hairline,
          backgroundColor: colors.border,
          marginTop: spacing[7],
          marginBottom: spacing[6],
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
        <Icon name={notConfigured ? 'alert-triangle' : 'lock'} size={16} color={colors.accentHi} />
        <MonoLabel color={colors.faint}>
          {t('progress.photos.locked.badge').toUpperCase()}
        </MonoLabel>
      </View>

      {/* Role sits on the wrapper because `Display` renders styled text only. */}
      <View accessibilityRole="header" style={{ marginTop: spacing[3] }}>
        <Display size={26}>{title.toUpperCase()}</Display>
      </View>

      <Text
        style={{
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 21,
          marginTop: spacing[2.5],
          marginBottom: spacing[6],
        }}
      >
        {description}
      </Text>

      {errorMessage && !notConfigured ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.textSecondary,
            fontFamily: fonts.ui,
            fontSize: 13,
            marginBottom: spacing[4],
          }}
        >
          {errorMessage}
        </Text>
      ) : null}

      {notConfigured ? (
        <CtaButton
          ghost
          onPress={() => {
            // Deep-links to the OS settings; AJ Fit never offers to create a
            // passcode of its own.
            void Linking.openSettings();
          }}
          accessibilityLabel={t('progress.photos.notConfigured.openSettings')}
        >
          {t('progress.photos.notConfigured.openSettings')}
        </CtaButton>
      ) : (
        <CtaButton
          onPress={onUnlock}
          disabled={authenticating}
          style={{ alignSelf: 'stretch' }}
          accessibilityLabel={t('progress.photos.a11y.unlock')}
        >
          {authenticating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
              <ActivityIndicator color={colors.text} />
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                {t('progress.photos.locked.unlocking')}
              </Text>
            </View>
          ) : (
            t('progress.photos.locked.cta')
          )}
        </CtaButton>
      )}
    </View>
  );
}
