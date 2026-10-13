import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { logInfo } from '../../lib/logger';
import {
  checkHealthSpikeAvailability,
  readMostRecentWeight,
  requestHealthSpikePermissions,
  writeTestWorkout,
  type HealthSpikePlatformStatus,
  type HealthSpikeTestWorkoutResult,
  type HealthSpikeWeightReading,
} from './healthSpikeService';
import { isHealthSpikeQaPanelAllowed } from './healthSpikeGate';

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; value: T }
  | { status: 'error'; message: string };

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function HealthSpikeQaSheet({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const { theme } = useTheme();
  const [availability, setAvailability] = useState<AsyncState<HealthSpikePlatformStatus>>({ status: 'idle' });
  const [permissions, setPermissions] = useState<AsyncState<string>>({ status: 'idle' });
  const [weight, setWeight] = useState<AsyncState<HealthSpikeWeightReading | null>>({ status: 'idle' });
  const [workout, setWorkout] = useState<AsyncState<HealthSpikeTestWorkoutResult>>({ status: 'idle' });
  const [confirmingWrite, setConfirmingWrite] = useState(false);

  if (!isHealthSpikeQaPanelAllowed()) return null;

  const runAvailability = async () => {
    setAvailability({ status: 'loading' });
    try {
      const value = await checkHealthSpikeAvailability();
      setAvailability({ status: 'done', value });
    } catch (cause) {
      setAvailability({ status: 'error', message: errorMessage(cause) });
    }
  };

  const runPermissions = async () => {
    setPermissions({ status: 'loading' });
    try {
      const value = await requestHealthSpikePermissions();
      setPermissions({ status: 'done', value });
    } catch (cause) {
      setPermissions({ status: 'error', message: errorMessage(cause) });
    }
  };

  const runReadWeight = async () => {
    setWeight({ status: 'loading' });
    try {
      const value = await readMostRecentWeight();
      setWeight({ status: 'done', value });
    } catch (cause) {
      setWeight({ status: 'error', message: errorMessage(cause) });
    }
  };

  const runWriteTestWorkout = async () => {
    setConfirmingWrite(false);
    logInfo('healthSpike', 'spike_write_test_workout_confirmed', { platform: Platform.OS });
    setWorkout({ status: 'loading' });
    try {
      const value = await writeTestWorkout();
      setWorkout({ status: 'done', value });
    } catch (cause) {
      setWorkout({ status: 'error', message: errorMessage(cause) });
    }
  };

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
              HEALTH SPIKE (FASE 0)
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onDismiss} hitSlop={10}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1.5, color: theme.colors.textFaint }}>
                FECHAR
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 20 }}>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, color: theme.colors.textFaint }}>
              DEV/QA — spike técnico de validação, não é feature de produto. Nenhuma sincronização
              automática acontece aqui; cada botão dispara uma única chamada sob demanda.
            </Text>

            <SpikeAction
              theme={theme}
              title="1. Checar disponibilidade"
              description="isHealthDataAvailable() (iOS) / getSdkStatus() (Android)"
              onPress={() => void runAvailability()}
              state={availability}
              renderValue={(value) =>
                value.platform === 'ios'
                  ? `iOS — disponível: ${value.available ? 'SIM' : 'NÃO'}`
                  : value.platform === 'android'
                    ? `Android — ${value.sdkStatusLabel}`
                    : 'Plataforma não suportada (web/simulador sem Health)'
              }
            />

            <SpikeAction
              theme={theme}
              title="2. Pedir permissões"
              description="Abre o diálogo nativo do SO. iOS não revela quais categorias de leitura foram concedidas (limitação de plataforma)."
              onPress={() => void runPermissions()}
              state={permissions}
              renderValue={(value) => value}
            />

            <SpikeAction
              theme={theme}
              title="3. Ler peso mais recente"
              description="Leitura real do Apple Health / Health Connect — requer permissão concedida no passo 2."
              onPress={() => void runReadWeight()}
              state={weight}
              renderValue={(value) =>
                value
                  ? `${value.valueKg.toFixed(1)} kg em ${new Date(value.measuredAt).toLocaleString()} (fonte: ${value.sourceName ?? 'desconhecida'})`
                  : 'Nenhum registro de peso encontrado'
              }
            />

            <View
              style={{
                marginTop: 18,
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.colors.dangerText,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>
                4. Escrever treino de TESTE
              </Text>
              <Text style={{ marginTop: 4, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, color: theme.colors.textFaint }}>
                Grava um treino fictício de 1 minuto no Apple Health / Health Connect, rotulado
                &quot;[TESTE AJ Fit] Pode excluir&quot;. Esta ação escreve de verdade no app de saúde do
                dispositivo — exclua manualmente depois pelo app nativo de saúde.
              </Text>

              {!confirmingWrite ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmingWrite(true)}
                  style={({ pressed }) => ({
                    marginTop: 10,
                    paddingVertical: 10,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1, color: theme.colors.dangerText }}>
                    QUERO ESCREVER UM TREINO DE TESTE
                  </Text>
                </Pressable>
              ) : (
                <View style={{ marginTop: 10, gap: 8 }}>
                  <Text accessibilityRole="alert" style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12, color: theme.colors.dangerText }}>
                    Confirma a escrita de um registro de teste real no app de saúde do dispositivo?
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void runWriteTestWorkout()}
                      style={({ pressed }) => ({
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 8,
                        backgroundColor: pressed ? theme.colors.accentHi : theme.colors.accent,
                      })}
                    >
                      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12, color: '#FFFFFF' }}>Confirmar escrita</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setConfirmingWrite(false)}
                      style={({ pressed }) => ({ paddingVertical: 8, paddingHorizontal: 14, opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint }}>Cancelar</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {workout.status === 'loading' ? <ActivityIndicator style={{ marginTop: 10 }} color={theme.colors.textMuted} /> : null}
              {workout.status === 'done' ? (
                <Text style={{ marginTop: 10, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.success }}>
                  Escrito — id: {workout.value.recordId ?? '(sem id retornado)'} · {workout.value.startedAt} → {workout.value.endedAt}
                  {'\n'}Lembre-se de excluir esse registro de teste no app de saúde do dispositivo.
                </Text>
              ) : null}
              {workout.status === 'error' ? (
                <Text accessibilityRole="alert" style={{ marginTop: 10, fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.dangerText }}>
                  Falha: {workout.message}
                </Text>
              ) : null}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SpikeAction<T>({
  theme,
  title,
  description,
  onPress,
  state,
  renderValue,
}: {
  theme: ReturnType<typeof useTheme>['theme'];
  title: string;
  description: string;
  onPress: () => void;
  state: AsyncState<T>;
  renderValue: (value: T) => string;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>{title}</Text>
      <Text style={{ marginTop: 3, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, color: theme.colors.textFaint }}>
        {description}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={state.status === 'loading'}
        onPress={onPress}
        style={({ pressed }) => ({
          marginTop: 8,
          paddingVertical: 10,
          opacity: pressed ? 0.75 : state.status === 'loading' ? 0.5 : 1,
        })}
      >
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, letterSpacing: 1, color: theme.colors.accent }}>EXECUTAR</Text>
      </Pressable>
      {state.status === 'loading' ? <ActivityIndicator color={theme.colors.textMuted} /> : null}
      {state.status === 'done' ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textPrimary }}>{renderValue(state.value)}</Text>
      ) : null}
      {state.status === 'error' ? (
        <Text accessibilityRole="alert" style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.dangerText }}>
          Falha: {state.message}
        </Text>
      ) : null}
    </View>
  );
}
