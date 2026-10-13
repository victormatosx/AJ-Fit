import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { useHealthIntegration } from '../../hooks/useHealthIntegration';
import { isHealthIntegrationQaPanelAllowed } from './healthIntegrationQaGate';

function describeAvailability(availability: ReturnType<typeof useHealthIntegration>['availability']): string {
  switch (availability.status) {
    case 'unknown':
      return 'DESCONHECIDA';
    case 'checking':
      return 'VERIFICANDO...';
    case 'available':
      return 'DISPONÍVEL';
    case 'unsupported':
      return 'PLATAFORMA NÃO SUPORTADA';
    case 'unavailable':
      return `INDISPONÍVEL (${availability.reason}${availability.message ? `: ${availability.message}` : ''})`;
  }
}

function describeAuthorization(authorization: ReturnType<typeof useHealthIntegration>['authorization']): string {
  if (!authorization) return '—';
  if (authorization.platform === 'unsupported') return 'N/A';
  if (authorization.platform === 'ios') {
    return 'iOS não informa permissões de leitura concedidas (limitação de plataforma) — use a intenção do usuário como sinal, nunca isto.';
  }
  return authorization.granted.length > 0
    ? authorization.granted.map((p) => `${p.accessType}:${p.recordType}`).join(', ')
    : 'nenhuma permissão concedida';
}

function describeIntent(intent: ReturnType<typeof useHealthIntegration>['intent']): string {
  return { not_configured: 'NÃO CONFIGURADO', enabled: 'HABILITADO PELO USUÁRIO', disabled: 'DESABILITADO PELO USUÁRIO' }[intent];
}

export function HealthIntegrationQaSheet({
  visible,
  uid,
  onDismiss,
}: {
  visible: boolean;
  uid: string | null;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const health = useHealthIntegration(visible ? uid : null);

  if (!isHealthIntegrationQaPanelAllowed()) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable
        onPress={onDismiss}
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
            paddingBottom: 24,
            maxHeight: '92%',
          }}
        >
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: theme.colors.sheetDivider,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.8, color: theme.colors.textFaint }}>
              HEALTH INTEGRATION (FASE 1)
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onDismiss} hitSlop={10}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.5, color: theme.colors.textFaint }}>
                FECHAR
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 20 }}>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, color: theme.colors.textFaint }}>
              DEV/QA — exercita a camada de serviço de produção (`healthIntegration.ts` +
              `healthIntegrationPreferences.ts` + `useHealthIntegration`), não a lib crua. Nenhuma
              tela definitiva usa isso ainda.
            </Text>

            {!uid ? (
              <Text style={{ marginTop: 14, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.dangerText }}>
                Nenhum usuário autenticado — a preferência de conexão precisa de um uid.
              </Text>
            ) : null}

            <Row theme={theme} label="Plataforma" value={health.platform.toUpperCase()} />
            <Row theme={theme} label="Disponibilidade" value={describeAvailability(health.availability)} />
            <Row theme={theme} label="Permissões (OS)" value={describeAuthorization(health.authorization)} multiline />
            <Row theme={theme} label="Intenção salva" value={describeIntent(health.intent)} />

            {health.loading ? <ActivityIndicator style={{ marginTop: 14 }} color={theme.colors.textMuted} /> : null}
            {health.errorCode ? (
              <Text accessibilityRole="alert" style={{ marginTop: 12, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.dangerText }}>
                Erro: {health.errorCode}
              </Text>
            ) : null}

            <View style={{ marginTop: 18, gap: 10 }}>
              <QaButton
                theme={theme}
                label={health.requestingPermissions ? 'Conectando...' : 'Conectar (salva intenção + pede permissão)'}
                disabled={!uid || health.requestingPermissions}
                onPress={() => void health.connect()}
              />
              <QaButton
                theme={theme}
                label="Desconectar (só a intenção local)"
                disabled={!uid}
                onPress={() => void health.disconnect()}
              />
              <QaButton theme={theme} label="Atualizar disponibilidade/permissões" onPress={() => void health.refresh()} />
              <QaButton theme={theme} label="Abrir ajustes nativos de saúde" onPress={() => void health.openNativeSettings()} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ theme, label, value, multiline }: { theme: ReturnType<typeof useTheme>['theme']; label: string; value: string; multiline?: boolean }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.2, color: theme.colors.textFaint }}>
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          marginTop: 3,
          fontFamily: theme.fonts.ui,
          fontSize: multiline ? 12 : 13,
          lineHeight: multiline ? 16 : undefined,
          color: theme.colors.textPrimary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function QaButton({
  theme,
  label,
  onPress,
  disabled,
}: {
  theme: ReturnType<typeof useTheme>['theme'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 11,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.sheetBorder,
        backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>{label}</Text>
    </Pressable>
  );
}
