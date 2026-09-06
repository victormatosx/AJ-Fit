import { describe, expect, it, vi } from 'vitest';

import {
  emitTrustedWorkoutLifecycleTelemetry,
  TRUSTED_TELEMETRY_RECEIPT_RETENTION_MS,
  trustedTelemetryReceiptExpiresAt,
  trustedTelemetryNameForLifecycleEvent,
} from '../trustedWorkoutLifecycleTelemetry';

describe('trusted workout lifecycle telemetry projection', () => {
  it('retains receipts beyond Pub/Sub\'s maximum 31-day redelivery horizon', () => {
    const claimedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(trustedTelemetryReceiptExpiresAt(claimedAt).getTime() - claimedAt.getTime())
      .toBe(TRUSTED_TELEMETRY_RECEIPT_RETENTION_MS);
    expect(TRUSTED_TELEMETRY_RECEIPT_RETENTION_MS).toBe(32 * 24 * 60 * 60 * 1000);
  });

  it('maps only authoritative lifecycle facts', () => {
    expect(trustedTelemetryNameForLifecycleEvent('LEVEL_PROMOTED')).toBe('level_promoted');
    expect(trustedTelemetryNameForLifecycleEvent('EVOLUTION_ACTIVATED')).toBe('evolution_activated');
    expect(trustedTelemetryNameForLifecycleEvent('PROGRAM_ADAPTED')).toBeNull();
  });

  it('emits only after claiming the persisted event correlation, then marks it delivered', async () => {
    const order: string[] = [];
    const sink = { log: vi.fn(() => order.push('log')) };
    const claims = {
      claim: vi.fn(async () => { order.push('claim'); return 'new' as const; }),
      markDelivered: vi.fn(async () => { order.push('markDelivered'); }),
    };
    await expect(emitTrustedWorkoutLifecycleTelemetry({
      eventId: 'evt-1', type: 'LEVEL_PROMOTED',
      payload: { evolutionType: 'LEVEL_PROMOTION', quality: 'GOOD', ignored: { pii: true } },
    }, { claims, sink })).resolves.toEqual({ emitted: true, name: 'level_promoted' });
    expect(order).toEqual(['claim', 'log', 'markDelivered']);
    expect(sink.log).toHaveBeenCalledWith('level_promoted', expect.objectContaining({
      trustLevel: 'TRUSTED_DOMAIN',
      domainEventType: 'LEVEL_PROMOTED',
      evolutionType: 'LEVEL_PROMOTION',
      quality: 'GOOD',
    }));
    expect(JSON.stringify(sink.log.mock.calls)).not.toContain('pii');
  });

  it('does not double-count an already-delivered trusted event', async () => {
    const sink = { log: vi.fn() };
    const claims = { claim: vi.fn(async () => 'delivered' as const), markDelivered: vi.fn() };
    await expect(emitTrustedWorkoutLifecycleTelemetry({
      eventId: 'evt-duplicate', type: 'EVOLUTION_ACTIVATED', payload: {},
    }, { claims, sink })).resolves.toEqual({ emitted: false, name: 'evolution_activated' });
    expect(sink.log).not.toHaveBeenCalled();
    expect(claims.markDelivered).not.toHaveBeenCalled();
  });

  it('ignores malformed and non-operational persisted events', async () => {
    const sink = { log: vi.fn() };
    const claims = { claim: vi.fn(async () => 'new' as const), markDelivered: vi.fn() };
    await expect(emitTrustedWorkoutLifecycleTelemetry({ type: 'LEVEL_PROMOTED' }, { claims, sink }))
      .resolves.toEqual({ emitted: false, name: null });
    await expect(emitTrustedWorkoutLifecycleTelemetry({ eventId: 'evt', type: 'PROGRAM_ADAPTED' }, { claims, sink }))
      .resolves.toEqual({ emitted: false, name: null });
    expect(claims.claim).not.toHaveBeenCalled();
    expect(sink.log).not.toHaveBeenCalled();
  });

  it('keeps the persisted domain transition independent of provider failure, and never marks delivery on a failed sink call', async () => {
    const claims = { claim: vi.fn(async () => 'new' as const), markDelivered: vi.fn() };
    const sink = { log: vi.fn(() => { throw new Error('provider-down'); }) };
    await expect(emitTrustedWorkoutLifecycleTelemetry({
      eventId: 'already-persisted', type: 'CYCLE_COMPLETED', payload: {},
    }, { claims, sink })).rejects.toThrow('provider-down');
    expect(claims.claim).toHaveBeenCalledOnce();
    expect(claims.markDelivered).not.toHaveBeenCalled();
  });

  it('retries the sink on redelivery of a still-pending receipt after a prior sink failure, without duplicating a delivered one', async () => {
    const sink = { log: vi.fn() };
    const claims = {
      claim: vi.fn(async (): Promise<'new' | 'pending' | 'delivered'> => 'pending'),
      markDelivered: vi.fn(async () => {}),
    };
    await expect(emitTrustedWorkoutLifecycleTelemetry({
      eventId: 'evt-retry', type: 'CYCLE_COMPLETED', payload: {},
    }, { claims, sink })).resolves.toEqual({ emitted: true, name: 'cycle_completed' });
    expect(sink.log).toHaveBeenCalledOnce();
    expect(claims.markDelivered).toHaveBeenCalledOnce();

    sink.log.mockClear();
    claims.markDelivered.mockClear();
    claims.claim.mockImplementation(async () => 'delivered');
    await expect(emitTrustedWorkoutLifecycleTelemetry({
      eventId: 'evt-retry', type: 'CYCLE_COMPLETED', payload: {},
    }, { claims, sink })).resolves.toEqual({ emitted: false, name: 'cycle_completed' });
    expect(sink.log).not.toHaveBeenCalled();
    expect(claims.markDelivered).not.toHaveBeenCalled();
  });
});
