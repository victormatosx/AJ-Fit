/**
 * Fase 0 — spike técnico de validação de bibliotecas (não é código de produto).
 *
 * Isolado de propósito: nenhuma outra parte do app importa este módulo.
 * Serve apenas para provar, em dispositivo físico, que
 * `@kingstinct/react-native-healthkit` (iOS) e `react-native-health-connect`
 * (Android) instalam, pedem permissão e leem/escrevem um dado real.
 *
 * Seguro para apagar inteiro (pasta `src/dev/health/`) ao final da Fase 0.
 */
import { Platform } from 'react-native';

export type HealthSpikePlatformStatus =
  | { platform: 'ios'; available: boolean }
  | { platform: 'android'; sdkStatus: number; sdkStatusLabel: string }
  | { platform: 'unsupported' };

export type HealthSpikeWeightReading = {
  valueKg: number;
  measuredAt: string;
  sourceName: string | null;
};

export type HealthSpikeTestWorkoutResult = {
  platform: 'ios' | 'android';
  recordId: string | null;
  startedAt: string;
  endedAt: string;
};

export async function checkHealthSpikeAvailability(): Promise<HealthSpikePlatformStatus> {
  if (Platform.OS === 'ios') {
    const HealthKit = await import('@kingstinct/react-native-healthkit');
    return { platform: 'ios', available: HealthKit.isHealthDataAvailable() };
  }
  if (Platform.OS === 'android') {
    const HealthConnect = await import('react-native-health-connect');
    const status = await HealthConnect.getSdkStatus();
    return { platform: 'android', sdkStatus: status, sdkStatusLabel: healthConnectSdkStatusLabel(status) };
  }
  return { platform: 'unsupported' };
}

function healthConnectSdkStatusLabel(status: number): string {
  // https://github.com/matinzd/react-native-health-connect — SdkAvailabilityStatus constants.
  switch (status) {
    case 1:
      return 'SDK_UNAVAILABLE';
    case 2:
      return 'SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED';
    case 3:
      return 'SDK_AVAILABLE';
    default:
      return `DESCONHECIDO (${status})`;
  }
}

export async function requestHealthSpikePermissions(): Promise<string> {
  if (Platform.OS === 'ios') {
    const HealthKit = await import('@kingstinct/react-native-healthkit');
    const granted = await HealthKit.requestAuthorization({
      toRead: ['HKQuantityTypeIdentifierBodyMass'],
      toShare: ['HKWorkoutTypeIdentifier'],
    });
    // iOS nunca revela, por design, quais permissões de LEITURA foram concedidas —
    // `granted` aqui só confirma que o diálogo nativo foi exibido sem erro.
    return granted
      ? 'Diálogo de permissão exibido. iOS não informa quais categorias de leitura foram autorizadas (limitação de plataforma, não de implementação).'
      : 'Falha ao exibir o diálogo de permissão.';
  }
  if (Platform.OS === 'android') {
    const HealthConnect = await import('react-native-health-connect');
    const initialized = await HealthConnect.initialize();
    if (!initialized) return 'Health Connect não inicializou (app ausente/indisponível no dispositivo).';
    const granted = await HealthConnect.requestPermission([
      { accessType: 'read', recordType: 'Weight' },
      { accessType: 'write', recordType: 'ExerciseSession' },
    ]);
    // `getGrantedPermissions()` elsewhere may list MORE than requested here —
    // Health Connect persists per-package grants across reinstalls as long as
    // the app's package name doesn't change, so a permission granted to an
    // earlier test build (e.g. write:CyclingPedalingCadence from an earlier
    // iteration of this spike) keeps showing up until the user removes it in
    // the Health Connect app itself. It is not something this code requests.
    return `Permissões concedidas: ${granted.map((p) => `${p.accessType}:${p.recordType}`).join(', ') || 'nenhuma'}`;
  }
  return 'Plataforma não suportada.';
}

export async function readMostRecentWeight(): Promise<HealthSpikeWeightReading | null> {
  if (Platform.OS === 'ios') {
    const HealthKit = await import('@kingstinct/react-native-healthkit');
    const samples = await HealthKit.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
      unit: 'kg',
      limit: 1,
      ascending: false,
    });
    const latest = samples[0];
    if (!latest) return null;
    return {
      valueKg: latest.quantity,
      measuredAt: new Date(latest.endDate).toISOString(),
      sourceName: latest.sourceRevision?.source?.name ?? null,
    };
  }
  if (Platform.OS === 'android') {
    const HealthConnect = await import('react-native-health-connect');
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const { records } = await HealthConnect.readRecords('Weight', {
      timeRangeFilter: { operator: 'between', startTime: oneYearAgo.toISOString(), endTime: now.toISOString() },
    });
    if (records.length === 0) return null;
    const latest = records.reduce((a, b) => (new Date(a.time) > new Date(b.time) ? a : b));
    return {
      valueKg: latest.weight.inKilograms,
      measuredAt: latest.time,
      sourceName: latest.metadata?.dataOrigin ?? null,
    };
  }
  return null;
}

/**
 * Escreve um treino FICTÍCIO de ~1 minuto, rotulado como teste, para validar o
 * caminho de escrita. Só deve ser chamado a partir de uma ação explícita do
 * usuário (ver `HealthSpikeQaSheet`) — nunca automaticamente.
 */
export async function writeTestWorkout(): Promise<HealthSpikeTestWorkoutResult> {
  const end = new Date();
  const start = new Date(end.getTime() - 60_000);

  if (Platform.OS === 'ios') {
    const HealthKit = await import('@kingstinct/react-native-healthkit');
    const workout = await HealthKit.saveWorkoutSample(
      HealthKit.WorkoutActivityType.functionalStrengthTraining,
      [],
      start,
      end,
      undefined,
      { HKMetadataKeyWasUserEntered: true, ajfitSpikeTest: true },
    );
    return { platform: 'ios', recordId: workout.uuid, startedAt: start.toISOString(), endedAt: end.toISOString() };
  }
  if (Platform.OS === 'android') {
    const HealthConnect = await import('react-native-health-connect');
    const [recordId] = await HealthConnect.insertRecords([
      {
        recordType: 'ExerciseSession',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        exerciseType: 70, // ExerciseType.STRENGTH_TRAINING
        title: '[TESTE AJ Fit] Pode excluir',
        notes: 'Registro de teste criado pelo spike técnico da Fase 0. Seguro para excluir.',
      },
    ]);
    return { platform: 'android', recordId: recordId ?? null, startedAt: start.toISOString(), endedAt: end.toISOString() };
  }
  throw new Error('Plataforma não suportada.');
}
