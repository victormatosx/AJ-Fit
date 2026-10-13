import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CtaButton, CtaText } from '../ui/CtaButton';
import { useTheme } from '../../theme';
import { useHealthIntegration } from '../../hooks/useHealthIntegration';
import { HealthProviderLogo } from './HealthProviderLogo';

/**
 * Fase 5 — the one explicit tap standing between "the user asked to connect
 * during the questionnaire" and the native permission dialog actually
 * opening. Never auto-opens on its own: `AppShell` only mounts this
 * component while `usePendingHealthIntegrationConfirmation` says it's owed
 * to the signed-in uid, and even then `health.connect()` only runs after
 * this sheet's own Connect button is pressed. Reuses `useHealthIntegration`
 * — the exact same Fase 1 hook `HealthIntegrationScreen` (Settings) uses —
 * so there is still only one connect/permission implementation in the app.
 */
export function PendingHealthIntegrationConfirmationSheet({
  uid,
  onResolved,
}: {
  uid: string;
  onResolved: () => void;
}) {
  const { t } = useTranslation(['health', 'common']);
  const { theme } = useTheme();
  const health = useHealthIntegration(uid);
  const [connecting, setConnecting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const provider = health.platform === 'android' ? 'Health Connect' : 'Apple Health';

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    await health.connect();
    if (!mountedRef.current) return;
    onResolved();
  };

  const handleDismiss = () => {
    if (connecting) return;
    onResolved();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleDismiss}>
      <Pressable
        onPress={connecting ? undefined : handleDismiss}
        style={{ flex: 1, backgroundColor: theme.colors.sheetBackdrop, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.sheetBackground,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: theme.colors.sheetBorder,
            padding: 22,
            paddingBottom: 28,
            gap: 14,
          }}
        >
          <View style={{ alignItems: 'center', gap: 12, marginBottom: 2 }}>
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 18,
                backgroundColor: theme.colors.surfaceElevated,
                borderWidth: 1,
                borderColor: theme.colors.cardBorder,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <HealthProviderLogo platform={health.platform} size={36} />
            </View>
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 17, color: theme.colors.textPrimary, textAlign: 'center' }}>
              {t('health:onboardingConfirmation.title', { provider })}
            </Text>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, lineHeight: 19, textAlign: 'center' }]}>
              {t('health:onboardingConfirmation.body', { provider })}
            </Text>
          </View>
          <CtaButton
            onPress={() => void handleConnect()}
            disabled={connecting}
            accessibilityLabel={t('health:onboardingConfirmation.connectAction', { provider })}
          >
            {connecting ? (
              <ActivityIndicator color={theme.colors.primaryForeground} />
            ) : (
              <CtaText>{t('health:onboardingConfirmation.connectAction', { provider })}</CtaText>
            )}
          </CtaButton>
          <Pressable
            onPress={handleDismiss}
            disabled={connecting}
            accessibilityRole="button"
            accessibilityLabel={t('health:onboardingConfirmation.skipAction')}
            style={({ pressed }) => ({ paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textFaint }}>
              {t('health:onboardingConfirmation.skipAction')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
