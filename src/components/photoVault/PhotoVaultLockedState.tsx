import React from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';
import type { PhotoVaultIssue } from '../../lib/photoVaultErrors';

/**
 * What the user sees before the vault is open.
 *
 * Shows no photos, no count, no dates and no previews — nothing that could
 * leak the contents of a locked vault. It also never names a specific
 * mechanism ("Face ID"), because the same build runs on devices that will
 * prompt for a fingerprint or the screen lock instead.
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
    <View style={{ paddingHorizontal: 22, paddingTop: 40, alignItems: 'center' }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Icon name={notConfigured ? 'alert-triangle' : 'lock'} size={28} color={colors.text} />
      </View>

      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontFamily: fonts.uiSemi,
          fontSize: 18,
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        {title}
      </Text>

      <Text
        style={{
          color: colors.textSecondary,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
          marginBottom: 24,
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
            textAlign: 'center',
            marginBottom: 16,
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>
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
