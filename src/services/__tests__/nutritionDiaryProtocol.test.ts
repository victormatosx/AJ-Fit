import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planSnapshotClientEnabled, registerPlanSnapshotOption, sendDiaryCommand, usesTransactionalDiary } from '../nutritionDiaryProtocol';
const f = vi.hoisted(() => ({ storage: new Map<string, string>(), callable: vi.fn(), next: 0, enrolled: false }));
vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'synthetic-uid' } } }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: async () => ({ exists: () => f.enrolled }) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `synthetic-request-${++f.next}` }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => f.callable }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (k: string) => f.storage.get(k) ?? null,
  setItem: async (k: string, v: string) => { f.storage.set(k, v); },
  removeItem: async (k: string) => { f.storage.delete(k); },
} }));
vi.mock('../../nutrition/ui/localDate', () => ({ todayLocalDate: () => '2026-10-18', deviceTimeZone: () => 'America/Sao_Paulo' }));
beforeEach(() => { f.storage.clear(); f.callable.mockReset().mockResolvedValue({ data: {} }); f.enrolled = false; });
afterEach(() => vi.unstubAllEnvs());
describe('persistent diary command transport', () => {
  it('enables registration for every authenticated UID, while non-enrolled manual operations stay legacy', async () => {
    vi.stubEnv('EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED', 'true');
    expect(planSnapshotClientEnabled('synthetic-uid')).toBe(true);
    expect(planSnapshotClientEnabled('other-uid')).toBe(true);
    expect(planSnapshotClientEnabled(null)).toBe(false);
    expect(planSnapshotClientEnabled('')).toBe(false);
    expect(await usesTransactionalDiary('synthetic-uid')).toBe(false);
    expect(await usesTransactionalDiary('other-uid')).toBe(false);
    f.enrolled = true;
    expect(await usesTransactionalDiary('synthetic-uid')).toBe(true);
    vi.stubEnv('EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false');
    expect(planSnapshotClientEnabled('synthetic-uid')).toBe(false);
    expect(await usesTransactionalDiary('synthetic-uid')).toBe(true);
  });
  it('sends a reference only and joins simultaneous taps', async () => {
    const a = registerPlanSnapshotOption('synthetic-uid', { origin: 'plan', documentId: 'plan-a' }, 'lunch-1', 'lunch');
    const b = registerPlanSnapshotOption('synthetic-uid', { origin: 'plan', documentId: 'plan-a' }, 'lunch-1', 'lunch');
    expect(a).toBe(b); await a;
    expect(f.callable).toHaveBeenCalledTimes(1);
    expect(f.callable.mock.calls[0][0]).toEqual({ action: 'register_option', origin: 'plan', documentId: 'plan-a', optionId: 'lunch-1', slot: 'lunch',
      localDate: '2026-10-18', timezone: 'America/Sao_Paulo', requestId: expect.any(String), expectedUid: 'synthetic-uid' });
  });
  it('retains a timed-out request in storage and reuses it after module restart', async () => {
    f.callable.mockRejectedValueOnce(new Error('timeout'));
    const p = { action: 'remove', localDate: '2026-10-18', timezone: 'UTC', slot: 'lunch', itemId: 'entry-a' };
    await expect(sendDiaryCommand('synthetic-uid', p)).rejects.toThrow('timeout');
    const request = f.callable.mock.calls[0][0].requestId; expect(f.storage.size).toBe(1);
    vi.resetModules(); const restarted = await import('../nutritionDiaryProtocol');
    await restarted.sendDiaryCommand('synthetic-uid', p);
    expect(f.callable.mock.calls[1][0].requestId).toBe(request); expect(f.storage.size).toBe(0);
  });
  it('does not reuse requests belonging to another UID', async () => {
    await expect(sendDiaryCommand('different-uid', { action: 'remove' })).rejects.toThrow('DIARY_ACCOUNT_CHANGED');
    expect(f.callable).not.toHaveBeenCalled();
  });
  it('defaults OFF, but enrolled accounts keep using the backend when the flag is disabled', async () => {
    vi.stubEnv('EXPO_PUBLIC_NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false'); expect(await usesTransactionalDiary('synthetic-uid')).toBe(false);
    f.enrolled = true; expect(await usesTransactionalDiary('synthetic-uid')).toBe(true);
  });
});
