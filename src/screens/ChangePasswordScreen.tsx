import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { PasswordField } from '../components/ui/PasswordField';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useChangePassword } from '../hooks/useChangePassword';
import {
  PASSWORD_POLICY_MAX_LENGTH,
  PASSWORD_POLICY_MIN_LENGTH,
} from '../lib/passwordPolicy';
import { colors, fonts, spacing, typography } from '../theme/tokens';
import { useScreenFocusEffect } from '../state/ScreenActivity';

export function ChangePasswordScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settings');
  const change = useChangePassword();
  const [currentVisible, setCurrentVisible] = useState(false);
  const [newVisible, setNewVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  useEffect(() => {
    if (!change.allowed) onBack();
  }, [change.allowed, onBack]);

  // ChangePasswordScreen is now persistent (docs/23_navegacao_e_
  // lifecycle.md §10) — the three password fields must never survive past
  // the moment the screen becomes inactive. This is the cleanup half of
  // useScreenFocusEffect (fires on every active->inactive transition, not
  // just unmount, which no longer happens for this screen); the three
  // setters already clear `issue`/`succeeded` too (useChangePassword's
  // internal `resetFeedback`), so nothing sensitive or stale is left behind.
  useScreenFocusEffect(() => {
    return () => {
      change.setCurrentPassword('');
      change.setNewPassword('');
      change.setConfirmation('');
      setCurrentVisible(false);
      setNewVisible(false);
      setConfirmationVisible(false);
    };
  });

  if (!change.allowed) return null;

  const toggleLabel = (field: string) =>
    t('security.changePassword.accessibility.toggleVisibility', { field });

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader
          title={t('security.changePassword.screenTitle')}
          onBack={onBack}
          disabled={change.submitting}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: spacing[5.5],
              paddingTop: spacing[4],
              paddingBottom: spacing[10],
            }}
          >
            <View
              style={{
                padding: spacing[4],
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.cardBg,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing[3],
              }}
            >
              <Icon name="shield" size={19} color={colors.accentHi} />
              <Text style={{ ...typography.body, color: colors.textSecondary, flex: 1 }}>
                {t('security.changePassword.description')}
              </Text>
            </View>

            <View style={{ marginTop: spacing[6], gap: spacing[5] }}>
              <PasswordField
                label={t('security.changePassword.fields.current')}
                placeholder={t('security.changePassword.placeholders.current')}
                value={change.currentPassword}
                onChangeText={change.setCurrentPassword}
                visible={currentVisible}
                onToggleVisibility={() => setCurrentVisible((value) => !value)}
                toggleAccessibilityLabel={toggleLabel(
                  t('security.changePassword.fields.current'),
                )}
                editable={!change.submitting}
                returnKeyType="next"
              />
              <PasswordField
                label={t('security.changePassword.fields.new')}
                placeholder={t('security.changePassword.placeholders.new')}
                value={change.newPassword}
                onChangeText={change.setNewPassword}
                visible={newVisible}
                onToggleVisibility={() => setNewVisible((value) => !value)}
                toggleAccessibilityLabel={toggleLabel(
                  t('security.changePassword.fields.new'),
                )}
                editable={!change.submitting}
                textContentType="newPassword"
                autoComplete="new-password"
                maxLength={PASSWORD_POLICY_MAX_LENGTH}
                returnKeyType="next"
              />
              <PasswordField
                label={t('security.changePassword.fields.confirmation')}
                placeholder={t('security.changePassword.placeholders.confirmation')}
                value={change.confirmation}
                onChangeText={change.setConfirmation}
                visible={confirmationVisible}
                onToggleVisibility={() => setConfirmationVisible((value) => !value)}
                toggleAccessibilityLabel={toggleLabel(
                  t('security.changePassword.fields.confirmation'),
                )}
                editable={!change.submitting}
                textContentType="newPassword"
                autoComplete="new-password"
                maxLength={PASSWORD_POLICY_MAX_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => void change.submit()}
              />
            </View>

            <Text
              style={{
                color: colors.faint,
                fontFamily: fonts.ui,
                fontSize: 12.5,
                lineHeight: 18,
                marginTop: spacing[3],
              }}
            >
              {t('security.changePassword.minimumLength', {
                count: PASSWORD_POLICY_MIN_LENGTH,
              })}
            </Text>

            {change.issue && (
              <Feedback
                tone="error"
                message={t(`security.changePassword.feedback.${change.issue}`, {
                  count: PASSWORD_POLICY_MIN_LENGTH,
                  max: PASSWORD_POLICY_MAX_LENGTH,
                })}
              />
            )}
            {change.succeeded && (
              <Feedback
                tone="success"
                message={t('security.changePassword.feedback.success')}
              />
            )}

            <CtaButton
              onPress={() => void change.submit()}
              disabled={change.submitting}
              style={{ marginTop: spacing[6] }}
            >
              {change.submitting ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <CtaText>{t('security.changePassword.actions.submit')}</CtaText>
              )}
            </CtaButton>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function Feedback({
  tone,
  message,
}: {
  tone: 'error' | 'success';
  message: string;
}) {
  const success = tone === 'success';
  const color = success ? colors.success : colors.dangerText;

  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={{
        marginTop: spacing[4],
        padding: spacing[3.5],
        borderRadius: 12,
        borderWidth: 1,
        borderColor: success ? 'rgba(34,197,94,0.35)' : 'rgba(240,86,63,0.35)',
        backgroundColor: success ? 'rgba(34,197,94,0.10)' : 'rgba(240,86,63,0.10)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[2.5],
      }}
    >
      <Icon name={success ? 'check' : 'alert-triangle'} size={17} color={color} />
      <Text style={{ ...typography.bodySmall, color, flex: 1 }}>{message}</Text>
    </View>
  );
}
