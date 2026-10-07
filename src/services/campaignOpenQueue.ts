type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};

export type PendingCampaignOpen = Readonly<{
  uid: string;
  campaignId: string;
  campaignRunId: string;
  createdAt: number;
}>;

const MAX_PENDING = 100;
const MAX_AGE_MS = 90 * 86400000;
const KEY_PREFIX = 'ajfit.campaign-opens.v1:';
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const identity = (item: PendingCampaignOpen) => `${item.campaignId}:${item.campaignRunId}`;

/** A small UID-scoped outbox; storage operations are serialized to prevent lost taps. */
export function createCampaignOpenQueue(storage: Storage, now: () => number = Date.now) {
  let storageWork: Promise<unknown> = Promise.resolve();
  const inflight = new Map<string, Promise<void>>();
  const locked = <T>(work: () => Promise<T>): Promise<T> => {
    const result = storageWork.catch(() => undefined).then(work);
    storageWork = result.catch(() => undefined);
    return result;
  };
  const key = (uid: string) => `${KEY_PREFIX}${uid}`;
  async function read(uid: string): Promise<PendingCampaignOpen[]> {
    const raw = await storage.getItem(key(uid));
    try {
      const parsed: unknown = JSON.parse(raw ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is PendingCampaignOpen =>
        item && item.uid === uid && safeId(item.campaignId) && safeId(item.campaignRunId)
        && typeof item.createdAt === 'number' && item.createdAt <= now()
        && now() - item.createdAt <= MAX_AGE_MS).slice(-MAX_PENDING);
    } catch { return []; }
  }
  return {
    enqueue(uid: string, campaignId: string, campaignRunId: string) {
      if (!safeId(uid) || !safeId(campaignId) || !safeId(campaignRunId)) return Promise.resolve();
      return locked(async () => {
        const pending = await read(uid);
        const entry = { uid, campaignId, campaignRunId, createdAt: now() };
        if (!pending.some((item) => identity(item) === identity(entry))) pending.push(entry);
        await storage.setItem(key(uid), JSON.stringify(pending.slice(-MAX_PENDING)));
      });
    },
    pending(uid: string) { return locked(() => read(uid)); },
    flush(uid: string, send: (item: PendingCampaignOpen) => Promise<unknown>) {
      if (!safeId(uid)) return Promise.resolve();
      const existing = inflight.get(uid);
      if (existing) return existing;
      const work = (async () => {
        for (const item of await locked(() => read(uid))) {
          try { await send(item); } catch { continue; }
          await locked(async () => {
            const latest = await read(uid);
            await storage.setItem(key(uid), JSON.stringify(latest.filter((entry) => identity(entry) !== identity(item))));
          });
        }
      })().finally(() => { inflight.delete(uid); });
      inflight.set(uid, work);
      return work;
    },
  };
}
