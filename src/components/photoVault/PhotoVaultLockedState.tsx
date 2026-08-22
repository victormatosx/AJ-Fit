import React from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { Display, MonoLabel } from '../ui/Display';
import { displayLineHeight, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { PhotoVaultIssue } from '../../lib/photoVaultErrors';
import { PhotoProgressIntro } from './PhotoProgressIntro';
import { PhotoVaultProtectedIntro } from './PhotoVaultProtectedIntro';

/**
 * What the user sees before the vault is open.
 *
 * Shows no private photos, vault count, real dates or previews. The sole
 * content hint is a uid-scoped boolean selecting between the aspirational and
 * protected generic compositions. It also never names a specific mechanism
 * ("Face ID"), because the same build runs on devices that will prompt for a
 * fingerprint or the screen lock instead.
 *
 * `PhotoProgressIntro` uses only bundled public illustrations. Nothing there
 * is derived from vault contents, and no protected image is fetched or
 * decrypted to be obscured — a blurred real photo would mean decrypting it,
 * which is exactly what the lock exists to prevent.
 */

interface Props {
  status: 'locked' | 'authenticating';
  issue: PhotoVaultIssue | null;
  hasContent: boolean;
  contentPresenceReady: boolean;
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

export function PhotoVaultLockedState({
  status,
  issue,
  hasContent,
  contentPresenceReady,
  onUnlock,
}: Props) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const authenticating = status === 'authenticating';
  const notConfigured = issue !== null && NOT_CONFIGURED.includes(issue);
  const errorMessage = useAuthErrorMessage(issue);

  const description = notConfigured
    ? t('progress.photos.notConfigured.description')
    : t('progress.photos.locked.description');
  const title = notConfigured
    ? t('progress.photos.notConfigured.title')
    : hasContent
      ? t('progress.photos.locked.title')
      : null;

  return (
    <View
      style={{
        flexGrow: 1,
        width: '100%',
        maxWidth: sizes.contentMaxWidth + GUTTER * 2,
        alignSelf: 'center',
        paddingHorizontal: GUTTER,
        paddingTop: spacing[2],
      }}
    >
      {contentPresenceReady ? (
        hasContent ? <PhotoVaultProtectedIntro /> : <PhotoProgressIntro />
      ) : (
        // Prevents an aspirational-frame flash while a persisted `true` is
        // being read on cold start. The stable private-area CTA stays usable.
        <View testID="photo-vault-content-presence-loading" style={{ flexGrow: 1 }} />
      )}

      <View style={{ paddingTop: spacing[6] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
          <Icon
            name={notConfigured ? 'alert-triangle' : 'lock'}
            size={16}
            color={theme.colors.primaryEmphasis}
          />
          <MonoLabel color={theme.colors.textFaint}>
            {t('progress.photos.locked.badge').toUpperCase()}
          </MonoLabel>
        </View>

        {title ? (
          // Role sits on the wrapper because `Display` renders styled text only.
          <View accessibilityRole="header" style={{ marginTop: spacing[3] }}>
            <Display size={26}>{title.toUpperCase()}</Display>
          </View>
        ) : null}

        <Text
          style={{
            color: theme.colors.textMuted,
            fontFamily: theme.fonts.ui,
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
              color: theme.colors.textSecondary,
              fontFamily: theme.fonts.ui,
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
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[2.5],
                }}
              >
                <ActivityIndicator color={theme.colors.primaryForeground} />
                <Text
                  style={{
                    color: theme.colors.primaryForeground,
                    fontFamily: theme.fonts.display,
                    fontSize: 17,
                    lineHeight: displayLineHeight(17),
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    includeFontPadding: false,
                  }}
                >
                  {t('progress.photos.locked.unlocking')}
                </Text>
              </View>
            ) : (
              t('progress.photos.locked.cta')
            )}
          </CtaButton>
        )}
      </View>
    </View>
  );
}
