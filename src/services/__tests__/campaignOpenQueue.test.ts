import { describe, expect, it, vi } from 'vitest';
import { createCampaignOpenQueue } from '../campaignOpenQueue';

function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); },
  };
  return { storage, data };
}

describe('durable campaign open outbox', () => {
  it('survives a new queue instance, retries offline, and records a logical open once', async () => {
    const { storage } = fixture();
    const first = createCampaignOpenQueue(storage, () => 1000);
    await first.enqueue('user-a', 'campaign', 'campaign.100');
    await first.enqueue('user-a', 'campaign', 'campaign.100');
    expect(await first.pending('user-a')).toHaveLength(1);
    await first.flush('user-a', async () => { throw new Error('offline'); });
    const restarted = createCampaignOpenQueue(storage, () => 2000);
    const send = vi.fn(async () => ({ recorded: true }));
    await restarted.flush('user-a', send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await restarted.pending('user-a')).toEqual([]);
    await restarted.flush('user-a', send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps pending events bound to their recipient UID', async () => {
    const { storage } = fixture();
    const queue = createCampaignOpenQueue(storage, () => 1000);
    await queue.enqueue('user-a', 'campaign', 'campaign.100');
    const send = vi.fn(async () => undefined);
    await queue.flush('user-b', send);
    expect(send).not.toHaveBeenCalled();
    expect(await queue.pending('user-a')).toHaveLength(1);
  });
});
