import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FatSecretApiError, FatSecretClient } from '../fatsecretClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('FatSecretClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    FatSecretClient.resetTokenCacheForTests();
  });
  afterEach(() => { vi.useRealTimers(); });

  function client(): FatSecretClient {
    return new FatSecretClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetchImpl: fetchMock as unknown as typeof fetch });
  }

  it('throws not_configured when either credential is blank — never silently proceeds with a missing secret', () => {
    expect(() => new FatSecretClient({ clientId: '', clientSecret: 'x', fetchImpl: fetchMock as unknown as typeof fetch }))
      .toThrow(FatSecretApiError);
    expect(() => new FatSecretClient({ clientId: 'x', clientSecret: '  ', fetchImpl: fetchMock as unknown as typeof fetch }))
      .toThrow(FatSecretApiError);
  });

  it('fetches an OAuth token before the first search and reuses it on the second call', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ foods: { food: [] } }))
      .mockResolvedValueOnce(jsonResponse({ foods: { food: [] } }));

    const c = client();
    await c.searchFoods('yopro morango');
    await c.searchFoods('coca-cola zero');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://oauth.fatsecret.com/connect/token');
    expect((tokenInit.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    const [searchUrl1] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [searchUrl2] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(searchUrl1).toContain('search_expression=yopro');
    expect(searchUrl2).toContain('region=BR');
    expect(searchUrl2).toContain('language=pt');
  });

  it('requests a fresh token once the cached one is near expiry', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ foods: { food: [] } }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-2', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ foods: { food: [] } }));

    const c = client();
    await c.searchFoods('big mac');
    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
    await c.searchFoods('del valle');

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('maps a 429 token response to a rate_limited FatSecretApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429));
    await expect(client().searchFoods('yopro')).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('maps a 500 search response to an unavailable FatSecretApiError without throwing on local search', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 503));
    await expect(client().searchFoods('yopro')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('maps a network failure (fetch throws) to unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client().searchFoods('yopro')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('resolves a barcode via food/barcode/find-by-id/v2', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ food_id: { value: '12345' } }));
    const result = await client().findByBarcode('7891000100103');
    expect(result).toEqual({ food_id: { value: '12345' } });
    const [barcodeUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(barcodeUrl).toContain('method=food.find_id_for_barcode');
    expect(barcodeUrl).toContain('barcode=7891000100103');
  });

  it('fetches the structured serving list via food.get.v2', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ food: { food_id: '33691', food_name: 'YoPRO Morango', servings: { serving: [
        { serving_id: '1', serving_description: '1 garrafa (250g)', metric_serving_amount: '250', metric_serving_unit: 'g', is_default: '1', calories: '200', protein: '25', carbohydrate: '20', fat: '5' },
      ] } } }));
    const result = await client().getFood('33691');
    expect(result.food?.servings?.serving).toMatchObject([{ serving_description: '1 garrafa (250g)', metric_serving_amount: '250' }]);
    const [foodGetUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(foodGetUrl).toContain('method=food.get.v2');
    expect(foodGetUrl).toContain('food_id=33691');
  });
});
