import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isPushNotificationQaPanelAllowed } from '../pushNotifications/qaPanelGate';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
});

describe('Push Notifications DEV/QA panel', () => {
  it('is hidden outside DEV even if its component is accidentally mounted', () => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    expect(isPushNotificationQaPanelAllowed()).toBe(false);
    expect(read('src/dev/pushNotifications/PushNotificationQaSheet.tsx'))
      .toContain('if (!isPushNotificationQaPanelAllowed()) return null;');
  });

  it('is mounted only under the Settings Developer gate and authenticated user', () => {
    const settings = read('src/screens/SettingsScreen.tsx');
    expect(settings).toContain('pushNotificationQaPanelAllowed && user');
    expect(settings).toContain('key={user.uid}');
    expect(settings).toContain('label: \'Push Notifications\'');
  });

  it('renders selector, loading/success/failure and permission diagnostics', () => {
    const sheet = read('src/dev/pushNotifications/PushNotificationQaSheet.tsx');
    for (const text of [
      'Enviar notificação',
      'Enviando...',
      'Enviada — Dispatch criado',
      'Falha ao enviar —',
      'Permissão',
      'Registro push',
      'Expo push token presente',
      'ATUALIZAR REGISTRO',
      'Sentimos sua falta',
      'Hora de voltar',
      'Registrar evolução',
      'Atualizar avaliação',
      'Comparar evolução',
      'Semana concluída',
      'Sequência de semanas',
    ]) {
      expect(sheet).toContain(text);
    }
    expect(sheet).toContain('QA_PUSH_NOTIFICATION_TYPES.map');
  });

  it('wires press, selected type, loading, success and failure to visible states', () => {
    const sheet = read('src/dev/pushNotifications/PushNotificationQaSheet.tsx');
    expect(sheet).toContain('onPress={() => {');
    expect(sheet).toContain('void send();');
    expect(sheet).toContain('sendQaPushNotification(selected)');
    expect(sheet).toContain("setSendState({ status: 'sending' })");
    expect(sheet).toContain("status: 'sent'");
    expect(sheet).toContain("status: 'failed'");
    expect(sheet).toContain('accessibilityRole="alert"');
  });

  it('emits every safe DEV client stage and never includes a uid/token field', () => {
    const sheet = read('src/dev/pushNotifications/PushNotificationQaSheet.tsx');
    const client = read('src/services/qaPushNotification.ts');
    const eventSources = [
      [sheet, 'qa_push_send_pressed'],
      [sheet, 'qa_push_send_started'],
      [client, 'qa_push_callable_invoking'],
      [client, 'qa_push_callable_succeeded'],
      [client, 'qa_push_callable_failed'],
    ] as const;

    for (const [source, event] of eventSources) {
      const eventIndex = source.indexOf(`'${event}'`);
      const callStart = source.lastIndexOf('logInfo(', eventIndex);
      const callEnd = source.indexOf(');', eventIndex);
      const logCall = source.slice(callStart, callEnd + 2);

      expect(eventIndex).toBeGreaterThanOrEqual(0);
      expect(callStart).toBeGreaterThanOrEqual(0);
      expect(callEnd).toBeGreaterThan(eventIndex);
      expect(logCall).not.toMatch(/\buid\s*:/);
      expect(logCall).not.toMatch(/expoPushToken\s*:/);
      expect(logCall).not.toMatch(/installationSecret\s*:/);
    }
  });

  it('disables send and shows the concrete support failure instead of failing silently', () => {
    const sheet = read('src/dev/pushNotifications/PushNotificationQaSheet.tsx');
    expect(sheet).toContain('qaPushUnavailableMessage(diagnostics.value.support.reasonCode)');
    expect(sheet).toContain('disabled={sendDisabled}');
    expect(sheet).toContain('accessibilityRole="alert"');
    expect(sheet).toContain("setSendState({ status: 'failed', message: unavailableMessage })");
  });

  it('resets async state by uid/visibility and cancels stale account results', () => {
    const sheet = read('src/dev/pushNotifications/PushNotificationQaSheet.tsx');
    expect(sheet).toContain('}, [uid, visible]);');
    expect(sheet).toContain('diagnosticOperation.current === current');
    expect(sheet).toContain('sendOperation.current !== current');
  });
});
