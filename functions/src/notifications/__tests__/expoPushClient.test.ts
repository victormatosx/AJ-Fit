import { describe, expect, it, vi } from 'vitest';

import { createExpoPushClient } from '../expoPushClient';

function response(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as Response;
}

function message(index = 1) {
  return {
    to: `ExponentPushToken[token-${index}]`,
    title: 'QA',
    body: 'Fixed',
    data: { type: 'QA_TEST', notificationId: `qa-${index}` },
  };
}

describe('Expo push client', () => {
  it('parses accepted and rejected tickets in order', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response(200, {
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ],
    }));
    const client = createExpoPushClient({ fetchImpl, sleep: async () => undefined });

    await expect(client.send([message(1), message(2)])).resolves.toEqual([
      { ok: true, ticketId: 'ticket-1' },
      { ok: false, errorCode: 'DeviceNotRegistered' },
    ]);
  });

  it('chunks send requests at 100 without changing result order', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as unknown[];
      return response(200, {
        data: body.map((_, index) => ({ status: 'ok', id: `ticket-${index}` })),
      });
    });
    const client = createExpoPushClient({ fetchImpl, sleep: async () => undefined });
    const result = await client.send(Array.from({ length: 201 }, (_, index) => message(index)));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(201);
    expect(result.every((ticket) => ticket.ok)).toBe(true);
  });

  it.each([429, 500, 503])('retries retryable HTTP %s with exponential backoff', async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(status, {}))
      .mockResolvedValueOnce(response(200, { data: [{ status: 'ok', id: 'ticket' }] }));
    const sleep = vi.fn(async () => undefined);
    const client = createExpoPushClient({ fetchImpl, sleep, random: () => 0.5 });

    await expect(client.send([message()])).resolves.toEqual([{ ok: true, ticketId: 'ticket' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('retries a network failure and stops at the configured bound', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const sleep = vi.fn(async () => undefined);
    const client = createExpoPushClient({
      fetchImpl,
      sleep,
      maxHttpAttempts: 3,
      random: () => 0.5,
    });

    await expect(client.send([message()])).resolves.toEqual([
      { ok: false, errorCode: 'NETWORK_ERROR' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('classifies an aborted request as a timeout', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );
    const client = createExpoPushClient({
      fetchImpl,
      timeoutMs: 1,
      maxHttpAttempts: 1,
      sleep: async () => undefined,
    });
    await expect(client.send([message()])).resolves.toEqual([
      { ok: false, errorCode: 'TIMEOUT' },
    ]);
  });

  it('does not retry terminal HTTP 4xx', async () => {
    const fetchImpl = vi.fn(async () => response(400, {}));
    const client = createExpoPushClient({ fetchImpl, sleep: async () => undefined });
    await expect(client.send([message()])).resolves.toEqual([
      { ok: false, errorCode: 'HTTP_ERROR' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('adds an optional access token without requiring one by default', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response(200, {
      data: [{ status: 'ok', id: 'ticket' }],
    }));
    const client = createExpoPushClient({
      fetchImpl,
      accessToken: 'secret-from-environment',
      sleep: async () => undefined,
    });
    await client.send([message()]);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer secret-from-environment',
    });
  });

  it('parses success, provider failure and missing receipts', async () => {
    const fetchImpl = vi.fn(async () => response(200, {
      data: {
        a: { status: 'ok' },
        b: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    }));
    const receipts = await createExpoPushClient({
      fetchImpl,
      sleep: async () => undefined,
    }).getReceipts(['a', 'b', 'c']);

    expect(receipts.get('a')).toEqual({ status: 'ok' });
    expect(receipts.get('b')).toEqual({ status: 'error', errorCode: 'DeviceNotRegistered' });
    expect(receipts.get('c')).toEqual({ status: 'pending' });
  });
});
