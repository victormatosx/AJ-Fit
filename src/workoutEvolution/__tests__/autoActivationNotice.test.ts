import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { WorkoutLifecycleEvent } from '../../workoutLifecycle/types';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  },
}));

// Imports intentionally follow vi.mock so the storage dependency is replaced before module evaluation.
// eslint-disable-next-line import/first
import AsyncStorage from '@react-native-async-storage/async-storage';
// eslint-disable-next-line import/first
import {
  acknowledgeAutoActivationNotice,
  loadUnacknowledgedAutoActivationNotice,
  selectLatestAutoActivationNotice,
} from '../autoActivationNotice';

function event(input: {
  id: string;
  at: number;
  trigger?: 'AUTO' | 'MANUAL';
  type?: 'LEVEL_PROMOTION' | 'CYCLE_EVOLUTION' | 'MOTIVATIONAL_RENEWAL';
}): WorkoutLifecycleEvent<Timestamp> {
  return {
    eventId: input.id,
    type: input.type === 'LEVEL_PROMOTION' ? 'LEVEL_PROMOTED'
      : input.type === 'MOTIVATIONAL_RENEWAL' ? 'MOTIVATIONAL_RENEWAL_ACTIVATED' : 'EVOLUTION_ACTIVATED',
    occurredAt: Timestamp.fromMillis(input.at),
    cycleId: 'cycle', programInstanceId: 'instance', idempotencyKey: input.id,
    payload: { trigger: input.trigger ?? 'AUTO', evolutionType: input.type ?? 'CYCLE_EVOLUTION' },
    schemaVersion: 2,
  };
}

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe('auto activation UX acknowledgement', () => {
  it('selects the latest AUTO fact deterministically and ignores manual activation', () => {
    const notice = selectLatestAutoActivationNotice([
      event({ id: 'manual', at: 30, trigger: 'MANUAL' }),
      event({ id: 'older', at: 10, type: 'LEVEL_PROMOTION' }),
      event({ id: 'latest', at: 20, type: 'MOTIVATIONAL_RENEWAL' }),
    ]);
    expect(notice).toMatchObject({ eventId: 'latest', type: 'MOTIVATIONAL_RENEWAL' });
  });

  it('reappears before acknowledgement and stays hidden after acknowledgement/restart', async () => {
    const events = [event({ id: 'auto-1', at: 10 })];
    await expect(loadUnacknowledgedAutoActivationNotice('uid', events)).resolves.toMatchObject({ eventId: 'auto-1' });
    await acknowledgeAutoActivationNotice('uid', 'auto-1');
    await expect(loadUnacknowledgedAutoActivationNotice('uid', events)).resolves.toBeNull();
  });

  it('acknowledgement is idempotent', async () => {
    await acknowledgeAutoActivationNotice('uid', 'auto-1');
    await acknowledgeAutoActivationNotice('uid', 'auto-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(1);
  });

  it('does not hide a real activation when storage read fails', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(loadUnacknowledgedAutoActivationNotice('uid', [event({ id: 'auto-1', at: 10 })]))
      .resolves.toMatchObject({ eventId: 'auto-1' });
  });
});
