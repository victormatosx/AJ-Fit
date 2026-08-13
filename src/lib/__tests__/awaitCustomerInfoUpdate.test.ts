import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { awaitCustomerInfoUpdate } from '../awaitCustomerInfoUpdate';

type FakeCustomerInfo = { premium: boolean; tag: string };

function makeDeps(refreshFinal = vi.fn().mockResolvedValue({ premium: false, tag: 'refresh' } as FakeCustomerInfo)) {
  const addListener = vi.fn<(listener: (info: FakeCustomerInfo) => void) => void>();
  const removeListener = vi.fn<(listener: (info: FakeCustomerInfo) => void) => void>();
  return {
    addListener,
    removeListener,
    refreshFinal,
    timeoutMs: 1000,
  };
}

describe('awaitCustomerInfoUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the listener update when the SDK pushes CustomerInfo before the timeout', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);

    expect(deps.addListener).toHaveBeenCalledTimes(1);
    const listener = deps.addListener.mock.calls[0][0];
    listener({ premium: true, tag: 'listener' });

    const result = await promise;
    expect(result).toEqual({ status: 'listener-update', customerInfo: { premium: true, tag: 'listener' } });
  });

  it('never calls refreshFinal when the listener resolves first', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);
    const listener = deps.addListener.mock.calls[0][0];
    listener({ premium: true, tag: 'listener' });
    await promise;

    expect(deps.refreshFinal).not.toHaveBeenCalled();
  });

  it('removes the listener exactly once after a successful listener update', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);
    const listener = deps.addListener.mock.calls[0][0];
    listener({ premium: false, tag: 'x' });
    await promise;

    expect(deps.removeListener).toHaveBeenCalledTimes(1);
    expect(deps.removeListener).toHaveBeenCalledWith(listener);
  });

  it('resolves with the SAME CustomerInfo the listener fired with even when premium is not active — never grants access itself', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);
    const listener = deps.addListener.mock.calls[0][0];
    listener({ premium: false, tag: 'no-premium' });

    const result = await promise;
    expect(result).toEqual({ status: 'listener-update', customerInfo: { premium: false, tag: 'no-premium' } });
  });

  it('resolves only ONCE even if the listener fires multiple times (second callback is a no-op)', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);
    const listener = deps.addListener.mock.calls[0][0];
    listener({ premium: false, tag: 'first' });
    listener({ premium: true, tag: 'second' });

    const result = await promise;
    expect(result).toEqual({ status: 'listener-update', customerInfo: { premium: false, tag: 'first' } });
    expect(deps.removeListener).toHaveBeenCalledTimes(1);
  });

  it('falls back to refreshFinal after the timeout when no listener update ever arrives', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(deps.refreshFinal).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'timeout-refresh', customerInfo: { premium: false, tag: 'refresh' } });
  });

  it('removes the listener on timeout, before calling refreshFinal', async () => {
    const deps = makeDeps();
    const promise = awaitCustomerInfoUpdate(deps);
    const listener = deps.addListener.mock.calls[0][0];

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(deps.removeListener).toHaveBeenCalledTimes(1);
    expect(deps.removeListener).toHaveBeenCalledWith(listener);
  });

  it('timeout + refreshFinal resolving WITH premium is surfaced as-is (caller decides premium, not this module)', async () => {
    const deps = makeDeps(vi.fn().mockResolvedValue({ premium: true, tag: 'final' }));
    const promise = awaitCustomerInfoUpdate(deps);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toEqual({ status: 'timeout-refresh', customerInfo: { premium: true, tag: 'final' } });
  });

  it('timeout + refreshFinal failing resolves with timeout-refresh-error, never a fabricated CustomerInfo, never a rejection', async () => {
    const boom = new Error('network down');
    const deps = makeDeps(vi.fn().mockRejectedValue(boom));
    const promise = awaitCustomerInfoUpdate(deps);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toEqual({ status: 'timeout-refresh-error', error: boom });
  });

  it('a listener update arriving AFTER the timeout has already started refreshing is ignored (settles only once)', async () => {
    let resolveRefresh: (value: FakeCustomerInfo) => void = () => {};
    const refreshFinal = vi.fn(
      () =>
        new Promise<FakeCustomerInfo>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const deps = makeDeps(refreshFinal);
    const promise = awaitCustomerInfoUpdate(deps);
    const listener = deps.addListener.mock.calls[0][0];

    await vi.advanceTimersByTimeAsync(1000);
    // Listener fires late, after timeout already fired and removed it — must be a no-op.
    listener({ premium: true, tag: 'too-late' });
    resolveRefresh({ premium: false, tag: 'final' });

    const result = await promise;
    expect(result).toEqual({ status: 'timeout-refresh', customerInfo: { premium: false, tag: 'final' } });
  });
});
