import { describe, expect, it, vi } from 'vitest';
import { OffLiveApiError, fetchOffProductByBarcode } from '../offLiveClient';

function fakeFetch(response: Partial<Response> & { jsonValue?: unknown }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonValue,
  }) as unknown as typeof fetch;
}

describe('fetchOffProductByBarcode', () => {
  it('returns the product when OFF has it', async () => {
    const fetchImpl = fakeFetch({ jsonValue: { status: 1, product: { code: '7891000100103', product_name: 'Nescau' } } });
    const product = await fetchOffProductByBarcode('7891000100103', fetchImpl);
    expect(product).toMatchObject({ code: '7891000100103', product_name: 'Nescau' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('7891000100103'), expect.any(Object));
  });

  it('returns null when OFF reports status 0 (unknown barcode) — never thrown, routine outcome', async () => {
    const fetchImpl = fakeFetch({ jsonValue: { status: 0 } });
    expect(await fetchOffProductByBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('returns null on HTTP 404', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 404, jsonValue: null });
    expect(await fetchOffProductByBarcode('0000000000000', fetchImpl)).toBeNull();
  });

  it('throws OffLiveApiError(unavailable) on a 5xx', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 503, jsonValue: null });
    await expect(fetchOffProductByBarcode('123', fetchImpl)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('throws OffLiveApiError(unavailable) when the transport itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    await expect(fetchOffProductByBarcode('123', fetchImpl)).rejects.toBeInstanceOf(OffLiveApiError);
  });

  it('throws OffLiveApiError(invalid_response) on an unparseable body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) as unknown as typeof fetch;
    await expect(fetchOffProductByBarcode('123', fetchImpl)).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
