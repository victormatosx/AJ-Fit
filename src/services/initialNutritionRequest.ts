import AsyncStorage from '@react-native-async-storage/async-storage';

export type InitialNutritionRequestState = {
  status: 'idle' | 'requesting' | 'retryable' | 'failed' | 'exhausted' | 'disabled' | 'queued';
  attempts: number;
  nextAt: number;
};
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
function ordered<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.catch(() => undefined).then(run); queue = result; return result;
}
const key = (uid: string) => `ajfit.initial-nutrition-request.v1:${uid}`;
export const subscribeInitialNutritionRequest = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export async function readInitialNutritionRequest(uid: string): Promise<InitialNutritionRequestState> {
  const raw = await AsyncStorage.getItem(key(uid));
  if (!raw) return { status: 'idle', attempts: 0, nextAt: 0 };
  const value = JSON.parse(raw) as InitialNutritionRequestState;
  if (!Number.isInteger(value.attempts) || value.attempts < 0 || !Number.isFinite(value.nextAt)
    || !['idle', 'requesting', 'retryable', 'failed', 'exhausted', 'disabled', 'queued'].includes(value.status)) throw new Error('INVALID_INITIAL_REQUEST_STATE');
  return value;
}
async function save(uid: string, state: InitialNutritionRequestState) {
  await AsyncStorage.setItem(key(uid), JSON.stringify(state));
  listeners.forEach((listener) => listener());
}
export function setInitialNutritionDisabled(uid: string): Promise<void> {
  return ordered(async () => {
    const state = await readInitialNutritionRequest(uid);
    if (state.status !== 'disabled') await save(uid, { ...state, status: 'disabled' });
  });
}
export function initialNutritionFailureIsTransient(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  if (/NUTRITION_CONTEXT_PENDING|NUTRITION_GENERATION_COOLDOWN/.test(value?.message ?? '')) return true;
  if (/NUTRITION_NOT_ENTITLED|email_verification_required|ACCOUNT_INACTIVE|INVALID_NUTRITION_CONTEXT/.test(value?.message ?? '')) return false;
  return !/permission-denied|invalid-argument|failed-precondition|unauthenticated/.test(value?.code ?? '');
}
/** Reserve on disk before the network call; crashes consume a bounded attempt, never a new AI job. */
export async function runInitialNutritionRequest(
  uid: string, request: () => Promise<{ generationId: string; status?: string }>, explicit = false,
): Promise<void> {
  const reserved = await ordered(async () => {
    const state = await readInitialNutritionRequest(uid);
    const now = Date.now();
    if (state.status === 'queued' || (state.status === 'requesting' && state.nextAt > now)) return null;
    if (!explicit && (state.status === 'failed' || state.attempts >= 3 || state.nextAt > now)) return null;
    const next: InitialNutritionRequestState = { status: 'requesting', attempts: explicit ? 1 : state.attempts + 1, nextAt: now + 120000 };
    await save(uid, next); return next;
  });
  if (!reserved) return;
  try {
    const result = await request();
    await ordered(() => save(uid, { ...reserved, nextAt: 0,
      status: result.generationId || result.status === 'skipped' ? 'queued' : result.status === 'disabled' ? 'disabled' : 'failed' }));
  } catch (error) {
    const transient = initialNutritionFailureIsTransient(error);
    await ordered(() => save(uid, { ...reserved, nextAt: transient ? Date.now() + 30000 : 0,
      status: !transient ? 'failed' : reserved.attempts >= 3 ? 'exhausted' : 'retryable' }));
  }
}

export function resolveInitialNutritionRequestPresentation(
  state: InitialNutritionRequestState | null, generationEnabled: boolean, profileReady: boolean, now = Date.now(),
): { kind: 'disabled' | 'failed' | 'waiting'; canRetry: boolean } {
  const active = state?.status === 'requesting' && state.nextAt > now;
  const disabled = !generationEnabled || state?.status === 'disabled';
  const failed = state?.status === 'failed' || state?.status === 'exhausted'
    || (state?.status === 'requesting' && !active && state.attempts >= 3);
  return { kind: disabled ? 'disabled' : failed ? 'failed' : 'waiting',
    canRetry: profileReady && generationEnabled && !active };
}
