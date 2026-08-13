import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ReauthenticationProvider } from '../../lib/authProviders';
import { colors, fonts, spacing } from '../../theme/tokens';
import { CtaButton, CtaText } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { PasswordField } from '../ui/PasswordField';

type Props = {
  providers: readonly ReauthenticationProvider[];
  password: string;
  passwordVisible: boolean;
  busyProvider: ReauthenticationProvider | null;
  disabled: boolean;
  onChangePassword: (value: string) => void;
  onTogglePassword: () => void;
  onConfirm: (provider: ReauthenticationProvider) => void;
};

/** Renders every linked identity method without inferring providerData order. */
export function ReauthenticationMethods({
  providers,
  password,
  passwordVisible,
  busyProvider,
  disabled,
  onChangePassword,
  onTogglePassword,
  onConfirm,
}: Props) {
  const { t } = useTranslation('settings');
  const hasPassword = providers.includes('password');

  return (
    <View style={{ gap: spacing[3] }}>
      {hasPassword ? (
        <PasswordField
          label={t('security.twoFactor.reauth.passwordLabel')}
          placeholder={t('security.twoFactor.reauth.passwordPlaceholder')}
          value={password}
          onChangeText={onChangePassword}
          visible={passwordVisible}
          onToggleVisibility={onTogglePassword}
          toggleAccessibilityLabel={t(
            'security.twoFactor.reauth.togglePassword',
          )}
          editable={!disabled}
          returnKeyType="done"
          onSubmitEditing={() => onConfirm('password')}
        />
      ) : null}

      {hasPassword ? (
        <CtaButton
          onPress={() => onConfirm('password')}
          disabled={disabled}
        >
          {busyProvider === 'password' ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <CtaText>
              {t('security.twoFactor.reauth.continueWithPassword')}
            </CtaText>
          )}
        </CtaButton>
      ) : null}

      {providers.includes('google') ? (
        <FederatedButton
          provider="google"
          busy={busyProvider === 'google'}
          disabled={disabled}
          onPress={() => onConfirm('google')}
        />
      ) : null}

      {providers.includes('apple') ? (
        <FederatedButton
          provider="apple"
          busy={busyProvider === 'apple'}
          disabled={disabled}
          onPress={() => onConfirm('apple')}
        />
      ) : null}
    </View>
  );
}

function FederatedButton({
  provider,
  busy,
  disabled,
  onPress,
}: {
  provider: 'google' | 'apple';
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <CtaButton ghost onPress={onPress} disabled={disabled}>
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          <Icon name={provider} size={18} color={colors.text} />
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.uiSemi,
              fontSize: 14,
            }}
          >
            {t(
              provider === 'google'
                ? 'security.twoFactor.reauth.continueWithGoogle'
                : 'security.twoFactor.reauth.continueWithApple',
            )}
          </Text>
        </>
      )}
    </CtaButton>
  );
}
