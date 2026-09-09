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
      'Falhou —',
      'Permissão',
      'Registro push',
      'Expo push token presente',
      'ATUALIZAR REGISTRO',
    ]) {
      expect(sheet).toContain(text);
    }
    expect(sheet).toContain('QA_PUSH_NOTIFICATION_TYPES.map');
  });

  it('resets async state by uid/visibility and cancels stale account results', () => {
    const sheet = read('src/dev/pushNotifications/PushNotificationQaSheet.tsx');
    expect(sheet).toContain('}, [uid, visible]);');
    expect(sheet).toContain('diagnosticOperation.current === current');
    expect(sheet).toContain('sendOperation.current !== current');
  });
});
