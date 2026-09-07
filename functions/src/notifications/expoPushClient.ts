const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_HTTP_ATTEMPTS = 3;
const EXPO_SEND_BATCH_LIMIT = 100;
const EXPO_RECEIPT_BATCH_LIMIT = 1_000;

export interface ExpoOutboundMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}
export type ExpoTicketResult =
  | { ok: true; ticketId: string }
  | { ok: false; errorCode: string };

export type ExpoReceiptResult =
  | { status: 'ok' }
  | { status: 'error'; errorCode: string }
  | { status: 'pending'; errorCode?: string };

export interface ExpoPushClient {
  send(messages: ExpoOutboundMessage[]): Promise<ExpoTicketResult[]>;
  getReceipts(ticketIds: string[]): Promise<Map<string, ExpoReceiptResult>>;
}

type FetchLike = typeof fetch;
type PostResult =
  | { ok: true; json: unknown }
  | { ok: false; errorCode: string };

interface ExpoPushClientDependencies {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxHttpAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  /**
   * Optional enhanced-security credential. Production must supply this from a
   * secret-backed backend environment; it is never required for local work.
   */
  accessToken?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function retryableTransportError(errorCode: string): boolean {
  return ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'].includes(errorCode);
}

function retryDelay(attempt: number, random: () => number): number {
  const base = Math.min(4_000, 250 * (2 ** Math.max(0, attempt - 1)));
  return Math.floor(base * (0.75 + random() * 0.5));
}

async function postOnce(
  fetchImpl: FetchLike,
  timeoutMs: number,
  accessToken: string | undefined,
  url: string,
  body: unknown,
): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      return {
        ok: false,
        errorCode: cause instanceof Error && cause.name === 'AbortError'
          ? 'TIMEOUT'
          : 'NETWORK_ERROR',
      };
    }

    if (!response.ok) {
      if (response.status === 429) return { ok: false, errorCode: 'RATE_LIMITED' };
      if (response.status >= 500) return { ok: false, errorCode: 'SERVER_ERROR' };
      return { ok: false, errorCode: 'HTTP_ERROR' };
    }

    try {
      return { ok: true, json: await response.json() };
    } catch {
      return { ok: false, errorCode: 'INVALID_RESPONSE' };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(
  dependencies: Required<Pick<ExpoPushClientDependencies, 'fetchImpl' | 'timeoutMs' | 'maxHttpAttempts' | 'sleep' | 'random'>> & {
    accessToken?: string;
  },
  url: string,
  body: unknown,
): Promise<PostResult> {
  let last: PostResult = { ok: false, errorCode: 'NETWORK_ERROR' };
  for (let attempt = 1; attempt <= dependencies.maxHttpAttempts; attempt += 1) {
    last = await postOnce(
      dependencies.fetchImpl,
      dependencies.timeoutMs,
      dependencies.accessToken,
      url,
      body,
    );
    if (last.ok || !retryableTransportError(last.errorCode)) return last;
    if (attempt < dependencies.maxHttpAttempts) {
      await dependencies.sleep(retryDelay(attempt, dependencies.random));
    }
  }
  return last;
}

function providerError(value: unknown, fallback: string): string {
  if (isRecord(value) && isRecord(value.details) && typeof value.details.error === 'string') {
    return value.details.error;
  }
  return fallback;
}

export function createExpoPushClient(
  provided: ExpoPushClientDependencies = {},
): ExpoPushClient {
  const dependencies = {
    fetchImpl: provided.fetchImpl ?? fetch,
    timeoutMs: provided.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxHttpAttempts: provided.maxHttpAttempts ?? DEFAULT_MAX_HTTP_ATTEMPTS,
    sleep: provided.sleep ?? ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
    random: provided.random ?? Math.random,
    accessToken: provided.accessToken ?? process.env.EXPO_ACCESS_TOKEN,
  };

  return {
    async send(messages) {
      const results: ExpoTicketResult[] = [];
      for (const batch of chunk(messages, EXPO_SEND_BATCH_LIMIT)) {
        const outcome = await postJson(
          dependencies,
          EXPO_PUSH_SEND_URL,
          batch.map((message) => ({
            to: message.to,
            title: message.title,
            body: message.body,
            data: message.data,
            priority: 'default',
          })),
        );
        if (!outcome.ok) {
          results.push(...batch.map(() => ({ ok: false as const, errorCode: outcome.errorCode })));
          continue;
        }

        const tickets = isRecord(outcome.json) && Array.isArray(outcome.json.data)
          ? outcome.json.data
          : null;
        if (!tickets || tickets.length !== batch.length) {
          results.push(...batch.map(() => ({ ok: false as const, errorCode: 'INVALID_RESPONSE' })));
          continue;
        }

        for (const ticket of tickets) {
          if (isRecord(ticket) && ticket.status === 'ok' && typeof ticket.id === 'string') {
            results.push({ ok: true, ticketId: ticket.id });
          } else {
            results.push({ ok: false, errorCode: providerError(ticket, 'UNKNOWN_TICKET_ERROR') });
          }
        }
      }
      return results;
    },

    async getReceipts(ticketIds) {
      const receipts = new Map<string, ExpoReceiptResult>();
      for (const batch of chunk(ticketIds, EXPO_RECEIPT_BATCH_LIMIT)) {
        const outcome = await postJson(dependencies, EXPO_PUSH_RECEIPTS_URL, { ids: batch });
        if (!outcome.ok) {
          for (const id of batch) {
            receipts.set(id, retryableTransportError(outcome.errorCode)
              ? { status: 'pending', errorCode: outcome.errorCode }
              : { status: 'error', errorCode: outcome.errorCode });
          }
          continue;
        }

        const data = isRecord(outcome.json) && isRecord(outcome.json.data)
          ? outcome.json.data
          : null;
        for (const id of batch) {
          const receipt = data?.[id];
          if (!isRecord(receipt)) {
            receipts.set(id, { status: 'pending' });
          } else if (receipt.status === 'ok') {
            receipts.set(id, { status: 'ok' });
          } else {
            receipts.set(id, {
              status: 'error',
              errorCode: providerError(receipt, 'UNKNOWN_RECEIPT_ERROR'),
            });
          }
        }
      }
      return receipts;
    },
  };
}
