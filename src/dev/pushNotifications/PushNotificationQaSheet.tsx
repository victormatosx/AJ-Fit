import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import {
  loadQaPushDiagnostics,
  QA_PUSH_NOTIFICATION_TYPES,
  qaPushErrorMessage,
  qaPushUnavailableMessage,
  refreshQaPushRegistration,
  sendQaPushNotification,
  type QaPushDiagnostics,
  type QaPushNotificationType,
} from '../../services/qaPushNotification';
import { isPushNotificationQaPanelAllowed } from './qaPanelGate';

export const QA_PUSH_TYPE_LABELS: Record<QaPushNotificationType, string> = {
  QA_TEST: 'QA Test',
  WORKOUT_DAY: 'Dia de treino',
  RECOVERY_DAY: 'Dia de recuperação',
  MISSED_WORKOUT: 'Treino perdido',
  EVOLUTION_UNLOCKED: 'Evolução desbloqueada',
  PROGRAM_UPDATED: 'Programa atualizado',
  EVOLUTION_APPROACHING: 'Próxima evolução',
  BILLING_ISSUE: 'Problema com assinatura',
  PREMIUM_ENDED: 'Premium encerrado',
};

type DiagnosticState =
  | { status: 'loading' }
  | { status: 'ready'; value: QaPushDiagnostics }
  | { status: 'error'; message: string };
type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; detail: string }
  | { status: 'failed'; message: string };

const permissionLabel = (value: QaPushDiagnostics['permission']) => ({
  granted: 'CONCEDIDA',
  denied: 'NEGADA',
  'not-determined': 'NÃO SOLICITADA',
  unsupported: 'NÃO SUPORTADA',
  error: 'ERRO',
}[value]);

const registrationLabel = (value: QaPushDiagnostics['registration']) => ({
  synced: 'SINCRONIZADO',
  throttled: 'SINCRONIZADO',
  deferred: 'PENDENTE',
  unsupported: 'NÃO SUPORTADO',
  'stale-identity': 'CONTA ALTERADA',
  failed: 'FALHOU',
}[value]);

function dispatchDetail(status: string, acceptedCount?: number): string | null {
  if (status === 'NO_ELIGIBLE_DEVICE') return null;
  if (status === 'SUPPRESSED_BY_POLICY' || status === 'SUPPRESSED_BY_PREFERENCE') return null;
  if (status === 'FAILED_TERMINAL' || status === 'FAILED_RETRY_EXHAUSTED') return null;
  if (status === 'PENDING_RECEIPTS') {
    return `Ticket aceito${typeof acceptedCount === 'number' ? ` (${acceptedCount})` : ''}; receipt pendente.`;
  }
  if (status === 'CONFIRMED') return 'Receipt confirmado.';
  if (status === 'DUPLICATE') return 'Solicitação já processada; nenhum envio duplicado.';
  return `Dispatch criado (${status}).`;
}

export function PushNotificationQaSheet({
  visible,
  uid,
  onDismiss,
}: {
  visible: boolean;
  uid: string;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState<QaPushNotificationType>('QA_TEST');
  const [diagnostics, setDiagnostics] = useState<DiagnosticState>({ status: 'loading' });
  const [sendState, setSendState] = useState<SendState>({ status: 'idle' });
  const diagnosticOperation = useRef(0);
  const sendOperation = useRef(0);

  useEffect(() => {
    const current = ++diagnosticOperation.current;
    sendOperation.current += 1;
    setSelected('QA_TEST');
    setSendState({ status: 'idle' });
    if (!visible) return;
    setDiagnostics({ status: 'loading' });
    void loadQaPushDiagnostics(uid).then((value) => {
      if (diagnosticOperation.current === current) setDiagnostics({ status: 'ready', value });
    }).catch((cause) => {
      if (diagnosticOperation.current === current) {
        setDiagnostics({ status: 'error', message: qaPushErrorMessage(cause) });
      }
    });
    return () => {
      diagnosticOperation.current += 1;
      sendOperation.current += 1;
    };
  }, [uid, visible]);

  if (!isPushNotificationQaPanelAllowed()) return null;

  const refreshRegistration = async () => {
    const current = ++diagnosticOperation.current;
    setDiagnostics({ status: 'loading' });
    try {
      const value = await refreshQaPushRegistration(uid);
      if (diagnosticOperation.current === current) setDiagnostics({ status: 'ready', value });
    } catch (cause) {
      if (diagnosticOperation.current === current) {
        setDiagnostics({ status: 'error', message: qaPushErrorMessage(cause) });
      }
    }
  };

  const send = async () => {
    const unavailableMessage = diagnostics.status === 'ready'
      ? qaPushUnavailableMessage(diagnostics.value.support.reasonCode)
      : null;
    if (unavailableMessage) {
      setSendState({ status: 'failed', message: unavailableMessage });
      return;
    }
    const current = ++sendOperation.current;
    setSendState({ status: 'sending' });
    try {
      const result = await sendQaPushNotification(selected);
      if (sendOperation.current !== current) return;
      const detail = dispatchDetail(result.status, result.acceptedCount);
      setSendState(detail
        ? { status: 'sent', detail }
        : {
            status: 'failed',
            message: result.status === 'NO_ELIGIBLE_DEVICE'
              ? 'Dispatch criado, mas nenhum device elegível foi encontrado. Atualize o registro.'
              : `O dispatch terminou sem envio (${result.status}). Consulte os logs das Functions.`,
          });
    } catch (cause) {
      if (sendOperation.current === current) {
        setSendState({ status: 'failed', message: qaPushErrorMessage(cause) });
      }
    }
  };

  const diagnosticRows = diagnostics.status === 'ready' ? [
    { label: 'Permissão', value: permissionLabel(diagnostics.value.permission) },
    { label: 'Registro push', value: registrationLabel(diagnostics.value.registration) },
    { label: 'Expo push token presente', value: diagnostics.value.expoPushTokenPresent ? 'SIM' : 'NÃO' },
  ] : [];
  const pushUnavailableMessage = diagnostics.status === 'ready'
    ? qaPushUnavailableMessage(diagnostics.value.support.reasonCode)
    : null;
  const sendDisabled = sendState.status === 'sending' || pushUnavailableMessage !== null;

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
          <View style={{
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: 14,
            borderBottomWidth: 1,
            borderColor: theme.colors.sheetDivider,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.8, color: theme.colors.textFaint }}>
              PUSH NOTIFICATIONS
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onDismiss} hitSlop={10}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.5, color: theme.colors.textFaint }}>
                FECHAR
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 20 }}>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, color: theme.colors.textFaint }}>
              DEV/QA. Envia para a conta autenticada pelo pipeline remoto real. Não cria fatos de produto.
            </Text>

            <Text style={{ marginTop: 18, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.4, color: theme.colors.textFaint }}>
              DIAGNÓSTICO
            </Text>
            {diagnostics.status === 'loading' ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={theme.colors.textMuted} />
            ) : null}
            {diagnosticRows.map((row) => (
              <View key={row.label} style={{
                flexDirection: 'row', justifyContent: 'space-between', gap: 12,
                paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.sheetDivider,
              }}>
                <Text style={{ flex: 1, fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint }}>{row.label}</Text>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.textPrimary }}>{row.value}</Text>
              </View>
            ))}
            {diagnostics.status === 'error' ? (
              <Text accessibilityRole="alert" style={{ marginTop: 10, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.dangerText }}>
                {diagnostics.message}
              </Text>
            ) : null}
            {pushUnavailableMessage ? (
              <Text accessibilityRole="alert" style={{ marginTop: 10, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, color: theme.colors.dangerText }}>
                {pushUnavailableMessage}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={diagnostics.status === 'loading'}
              onPress={() => void refreshRegistration()}
              style={({ pressed }) => ({
                marginTop: 10, paddingVertical: 10, opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1, color: theme.colors.accent }}>
                ATUALIZAR REGISTRO
              </Text>
            </Pressable>

            <Text style={{ marginTop: 16, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.4, color: theme.colors.textFaint }}>
              TIPO
            </Text>
            <View style={{ marginTop: 8, borderWidth: 1, borderColor: theme.colors.sheetBorder, borderRadius: 12, overflow: 'hidden' }}>
              {QA_PUSH_NOTIFICATION_TYPES.map((type, index) => {
                const active = selected === type;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={QA_PUSH_TYPE_LABELS[type]}
                    onPress={() => {
                      setSelected(type);
                      setSendState({ status: 'idle' });
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      backgroundColor: active ? theme.colors.accentSoft : pressed ? theme.colors.surfacePressed : 'transparent',
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderColor: theme.colors.sheetDivider,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    })}
                  >
                    <View style={{
                      width: 10, height: 10, borderRadius: 5, borderWidth: 1,
                      borderColor: active ? theme.colors.accent : theme.colors.textFaint,
                      backgroundColor: active ? theme.colors.accent : 'transparent',
                    }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>
                        {QA_PUSH_TYPE_LABELS[type]}
                      </Text>
                      <Text style={{ marginTop: 2, fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.textFaint }}>
                        {type}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar notificação"
              accessibilityState={{ disabled: sendDisabled }}
              disabled={sendDisabled}
              onPress={() => void send()}
              style={({ pressed }) => ({
                marginTop: 18,
                minHeight: 48,
                borderRadius: 12,
                backgroundColor: pressed ? theme.colors.accentHi : theme.colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: sendDisabled ? 0.5 : 1,
              })}
            >
              {sendState.status === 'sending' ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: '#FFFFFF' }}>Enviando...</Text>
                </View>
              ) : (
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: '#FFFFFF' }}>Enviar notificação</Text>
              )}
            </Pressable>

            {sendState.status === 'sent' ? (
              <View style={{ marginTop: 12 }}>
                <Text accessibilityRole="alert" style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.success }}>
                  Enviada — Dispatch criado
                </Text>
                <Text style={{ marginTop: 3, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint }}>
                  {sendState.detail}
                </Text>
              </View>
            ) : null}
            {sendState.status === 'failed' ? (
              <Text accessibilityRole="alert" style={{ marginTop: 12, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.dangerText }}>
                Falhou — {sendState.message}
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
