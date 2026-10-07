import { describe, expect, it, vi } from 'vitest';

vi.mock('../../attribution/adminAuth', () => ({ requireAdminUid: vi.fn(async (request: { auth?: { uid?: string } }) => {
  if (!request.auth?.uid) throw new Error('admin_role_required');
  return request.auth.uid;
}) }));

import { adminSaveCampaignHandler, nextOccurrence, parseDefinition, spreadDueAt } from '../campaigns';
import { assertValidDispatchRequest } from '../contentPolicy';

const valid = {
  name: 'Campanha',
  content: { 'pt-BR': { title: 'Olá', body: 'Volte ao AJ Fit' }, destination: 'home' },
  audience: { kind: 'language', language: 'pt-BR' },
  schedule: { kind: 'once', startAt: '2026-10-08T13:00:00.000Z', timezone: 'America/Sao_Paulo' },
};

describe('campaign contracts', () => {
  it('accepts an incomplete draft and rejects it at scheduling validation', () => {
    expect(parseDefinition({ name: 'Rascunho' }, false)).toEqual({ name: 'Rascunho' });
    expect(() => parseDefinition({ name: 'Rascunho' }, true)).toThrow('campaign_content_required');
  });
  it('rejects arbitrary destinations and malformed audiences', () => {
    expect(() => parseDefinition({ ...valid, content: { ...valid.content, destination: 'https://evil.example' } }, true)).toThrow('campaign_destination_invalid');
    expect(() => parseDefinition({ ...valid, audience: { kind: 'uids', uids: ['a/b'] } }, true)).toThrow('campaign_uids_invalid');
    expect(() => parseDefinition({ ...valid, audience: { kind: 'uids', uids: ['..'] } }, true)).toThrow('campaign_uids_invalid');
  });
  it('caps explicit UIDs below Firestore document limits', () => {
    const uids = Array.from({ length: 3001 }, (_, index) => `user-${index}`);
    expect(() => parseDefinition({ ...valid, audience: { kind: 'uids', uids } }, true)).toThrow('campaign_uids_invalid');
    expect(() => parseDefinition({ ...valid, audience: { kind: 'uids', uids: uids.slice(0, 3000) } }, true)).not.toThrow();
    const oversized = Array.from({ length: 3000 }, (_, index) => `${String(index).padStart(4, '0')}${'x'.repeat(110)}`);
    expect(() => parseDefinition({ ...valid, audience: { kind: 'uids', uids: oversized } }, true)).toThrow('campaign_uids_invalid');
  });
  it('rejects content the dispatcher cannot send before scheduling', () => {
    expect(() => parseDefinition({ ...valid, content: { ...valid.content, 'pt-BR': { title: 'bad\u0001', body: 'body' } } }, true)).toThrow('campaign_content_title_control_character');
  });
  it('requires canonical UTC instants coherent with the recurring wall clock', () => {
    expect(() => parseDefinition({ ...valid, schedule: { ...valid.schedule, startAt: '2026-10-08T10:00' } }, true)).toThrow('campaign_schedule_invalid');
    expect(() => parseDefinition({ ...valid, schedule: { ...valid.schedule, startAt: '2026-02-30T13:00:00.000Z' } }, true)).toThrow('campaign_schedule_invalid');
    expect(() => parseDefinition({ ...valid, schedule: { kind: 'daily', startAt: '2026-03-08T07:30:00.000Z', timezone: 'America/New_York', localTime: '02:30' } }, true)).toThrow('campaign_time_mismatch');
  });
  it('handles timezone and recurrence limits across DST', () => {
    const schedule = { kind: 'daily' as const, startAt: '2026-03-07T00:00:00.000Z', timezone: 'America/New_York', localTime: '09:00', maxOccurrences: 2 };
    expect(new Date(nextOccurrence(schedule, Date.parse('2026-03-07T00:00:00Z'))!).toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(new Date(nextOccurrence(schedule, Date.parse('2026-03-07T14:00:00Z'))!).toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(nextOccurrence({ ...schedule, endAt: '2026-03-07T23:59:59.000Z' }, Date.parse('2026-03-07T14:00:00Z'))).toBeNull();
    const fallback = { ...schedule, startAt: '2026-10-31T00:00:00.000Z', localTime: '01:30' };
    const first = nextOccurrence(fallback, Date.parse('2026-11-01T00:00:00Z'))!;
    expect(new Date(first).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(new Date(nextOccurrence(fallback, first)!).toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });
  it('uses stable per-recipient times within the window', () => {
    const a = spreadDueAt('run', 'uid', 100000, 480).toMillis();
    expect(a).toBe(spreadDueAt('run', 'uid', 100000, 480).toMillis());
    expect(a).toBeGreaterThanOrEqual(100000);
    expect(a).toBeLessThan(100000 + 480 * 60000);
  });
  it('preserves the dispatcher content policy and allows only typed campaign payloads', () => {
    const request = { uid: 'uid', notificationId: 'CAMPAIGN:run', type: 'CAMPAIGN' as const, category: 'WORKOUTS_AND_REMINDERS' as const, sourceIdentity: 'campaign:run', idempotencyKey: 'campaign:id:run:uid', title: 'Olá', body: 'Volte', intent: 'campaign', data: { campaignId: 'id', campaignRunId: 'run', destination: 'home' } };
    expect(() => assertValidDispatchRequest(request)).not.toThrow();
    expect(() => assertValidDispatchRequest({ ...request, data: { ...request.data, destination: 'settings' } })).toThrow('campaign_payload_invalid');
  });
  it('requires admin authorization before writing a draft', async () => {
    const create = vi.fn(async () => undefined);
    const db = { collection: () => ({ doc: () => ({ id: 'new', create }) }) };
    await expect(adminSaveCampaignHandler({ auth: null, data: { definition: { name: 'Draft' } } } as never, db as never)).rejects.toThrow('admin_role_required');
    expect(create).not.toHaveBeenCalled();
    await expect(adminSaveCampaignHandler({ auth: { uid: 'admin' }, data: { definition: { name: 'Draft' } } } as never, db as never)).resolves.toEqual({ id: 'new', version: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
