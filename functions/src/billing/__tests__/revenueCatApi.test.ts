import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RevenueCatApiError, RevenueCatV2Client } from '../revenueCatApi';

const loggerMocks = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logInfo: loggerMocks.logInfo,
  logWarn: loggerMocks.logWarn,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validEntitlements(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'list',
    items: [
      {
        object: 'entitlement',
        id: 'ent-premium',
        lookup_key: 'premium',
        products: {
          object: 'list',
          items: [{ object: 'product', id: 'prod-monthly', store_identifier: 'monthly.store' }],
          next_page: null,
        },
      },
    ],
    next_page: null,
    ...overrides,
  };
}

function validSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'subscription',
    id: 'sub-1',
    customer_id: 'customer-1',
    original_customer_id: 'customer-1',
    product_id: 'prod-monthly',
    starts_at: 1_000,
    current_period_starts_at: 2_000,
    current_period_ends_at: 3_000,
    ends_at: null,
    gives_access: true,
    pending_payment: false,
    auto_renewal_status: 'will_renew',
    status: 'active',
    entitlements: validEntitlements(),
    environment: 'sandbox',
    store: 'app_store',
    ...overrides,
  };
}

function subscriptionsPage(
  subscription: Record<string, unknown> = validSubscription(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    object: 'list',
    items: [subscription],
    next_page: null,
    ...overrides,
  };
}

describe('RevenueCatV2Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads and validates every subscriptions/entitlements page from API V2', async () => {
    const entitlement = (id: string, lookupKey: string, nextPage: string | null = null) => ({
      object: 'list',
      items: [
        {
          object: 'entitlement',
          id,
          lookup_key: lookupKey,
          products: {
            object: 'list',
            items: [{ object: 'product', id: 'prod-monthly', store_identifier: 'monthly.store' }],
            next_page: null,
          },
        },
      ],
      next_page: nextPage,
    });
    const subscription = (id: string, entitlements: unknown) => ({
      object: 'subscription',
      id,
      customer_id: 'customer-1',
      original_customer_id: 'customer-1',
      product_id: 'prod-monthly',
      starts_at: 1_000,
      current_period_starts_at: 2_000,
      current_period_ends_at: 3_000,
      ends_at: null,
      gives_access: true,
      pending_payment: false,
      auto_renewal_status: 'will_renew',
      status: 'active',
      entitlements,
      environment: 'sandbox',
      store: 'app_store',
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [
            subscription(
              'sub-1',
              entitlement(
                'ent-other',
                'other',
                '/v2/projects/test/subscriptions/sub-1/entitlements?starting_after=ent-other',
              ),
            ),
          ],
          next_page:
            '/v2/projects/test/customers/customer-1/subscriptions?starting_after=sub-1&environment=sandbox',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(entitlement('ent-premium', 'premium')))
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [subscription('sub-2', entitlement('ent-premium-2', 'premium'))],
          next_page: null,
        }),
      ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const result = await client.getCustomerSubscriptions('customer-1', 'sandbox');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'sub-1',
      givesAccess: true,
      environment: 'sandbox',
      store: 'app_store',
      entitlements: [
        { id: 'ent-other', lookupKey: 'other' },
        { id: 'ent-premium', lookupKey: 'premium' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.revenuecat.com/v2/projects/test/customers/customer-1/subscriptions?limit=100&environment=sandbox',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
  });

  it('does not reinterpret a subscription 404 as an empty subscription list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('missing-customer')).rejects.toMatchObject({
      kind: 'not_found',
      statusCode: 404,
    });
  });

  it('rejects an incomplete subscription object instead of inventing access state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        object: 'list',
        items: [{ object: 'subscription', id: 'incomplete-subscription' }],
        next_page: null,
      }),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('customer-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('accepts an entitlement without products and normalizes it to an empty array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        subscriptionsPage(
          validSubscription({
            entitlements: validEntitlements({
              items: [{ object: 'entitlement', id: 'ent-premium', lookup_key: 'premium' }],
            }),
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const result = await client.getCustomerSubscriptions('customer-1');

    expect(result[0].entitlements).toEqual([
      { id: 'ent-premium', lookupKey: 'premium', products: [] },
    ]);
  });

  it('accepts a null entitlement products value and normalizes it to an empty array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        subscriptionsPage(
          validSubscription({
            entitlements: validEntitlements({
              items: [
                {
                  object: 'entitlement',
                  id: 'ent-premium',
                  lookup_key: 'premium',
                  products: null,
                },
              ],
            }),
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const result = await client.getCustomerSubscriptions('customer-1');

    expect(result[0].entitlements).toEqual([
      { id: 'ent-premium', lookupKey: 'premium', products: [] },
    ]);
  });

  it('preserves strict parsing for a valid entitlement products list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(subscriptionsPage())) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const result = await client.getCustomerSubscriptions('customer-1');

    expect(result[0].entitlements[0].products).toEqual([
      { id: 'prod-monthly', storeIdentifier: 'monthly.store' },
    ]);
  });

  it('continues rejecting a present entitlement products value with the wrong type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        subscriptionsPage(
          validSubscription({
            entitlements: validEntitlements({
              items: [
                {
                  object: 'entitlement',
                  id: 'ent-premium',
                  lookup_key: 'premium',
                  products: 'invalid',
                },
              ],
            }),
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('customer-1')).rejects.toMatchObject({
      kind: 'invalid_response',
      validationFailure: {
        validationFailureCode: 'entitlement.products_object_invalid',
        expectedType: 'list_object',
        receivedType: 'string',
      },
    });
  });

  it('continues rejecting a malformed entitlement products list object', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        subscriptionsPage(
          validSubscription({
            entitlements: validEntitlements({
              items: [
                {
                  object: 'entitlement',
                  id: 'ent-premium',
                  lookup_key: 'premium',
                  products: { object: 'list', items: 'invalid', next_page: null },
                },
              ],
            }),
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('customer-1')).rejects.toMatchObject({
      kind: 'invalid_response',
      validationFailure: {
        validationFailureCode: 'entitlement.products_invalid',
        expectedType: 'array',
        receivedType: 'string',
      },
    });
  });

  it('parses a production-shaped four-subscription response when products is omitted', async () => {
    const entitlementWithoutProducts = validEntitlements({
      items: [{ object: 'entitlement', id: 'ent-premium', lookup_key: 'premium' }],
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        object: 'list',
        items: [
          validSubscription({ id: 'sub-1', entitlements: entitlementWithoutProducts }),
          validSubscription({ id: 'sub-2' }),
          validSubscription({ id: 'sub-3' }),
          validSubscription({ id: 'sub-4' }),
        ],
        next_page: null,
      }),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const result = await client.getCustomerSubscriptions('customer-1', 'sandbox');

    expect(result).toHaveLength(4);
    expect(result[0].entitlements[0]).toEqual({
      id: 'ent-premium',
      lookupKey: 'premium',
      products: [],
    });
    expect(loggerMocks.logWarn).not.toHaveBeenCalled();
  });

  it('logs only the sanitized response shape without changing a valid result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ...subscriptionsPage(),
        ignored_private_value: 'body-secret-must-not-appear',
      }),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'api-secret-must-not-appear',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('private-customer-id', 'sandbox')).resolves.toHaveLength(
      1,
    );

    expect(loggerMocks.logInfo).toHaveBeenCalledWith('billing:revenuecat-api', 'v2_response_shape', {
      operation: 'customer_subscriptions',
      pageIndex: 0,
      httpStatus: 200,
      responseObject: 'list',
      itemsIsArray: true,
      itemsCount: 1,
      nextPagePresence: true,
      nextPageType: 'null',
    });
    expect(loggerMocks.logWarn).not.toHaveBeenCalled();

    const serializedLogs = JSON.stringify([
      ...loggerMocks.logInfo.mock.calls,
      ...loggerMocks.logWarn.mock.calls,
    ]);
    expect(serializedLogs).not.toContain('api-secret-must-not-appear');
    expect(serializedLogs).not.toContain('body-secret-must-not-appear');
    expect(serializedLogs).not.toContain('private-customer-id');
    expect(serializedLogs).not.toContain('Authorization');
  });

  it('preserves invalid_response and logs the exact sanitized validation rule', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        subscriptionsPage(
          validSubscription({
            id: 'private-subscription-id',
            product_id: { private: 'body-secret-must-not-appear' },
          }),
        ),
      ),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'api-secret-must-not-appear',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('private-customer-id')).rejects.toMatchObject({
      kind: 'invalid_response',
      validationFailure: {
        validationFailureCode: 'subscription.product_id_invalid',
        expectedType: 'string_or_null',
        receivedType: 'object',
      },
    });
    expect(loggerMocks.logWarn).toHaveBeenCalledWith(
      'billing:revenuecat-api',
      'v2_response_validation_failure',
      {
        operation: 'customer_subscriptions',
        pageIndex: 0,
        httpStatus: 200,
        validationFailureCode: 'subscription.product_id_invalid',
        expectedType: 'string_or_null',
        receivedType: 'object',
      },
    );

    const serializedLogs = JSON.stringify([
      ...loggerMocks.logInfo.mock.calls,
      ...loggerMocks.logWarn.mock.calls,
    ]);
    expect(serializedLogs).not.toContain('api-secret-must-not-appear');
    expect(serializedLogs).not.toContain('body-secret-must-not-appear');
    expect(serializedLogs).not.toContain('private-customer-id');
    expect(serializedLogs).not.toContain('private-subscription-id');
    expect(serializedLogs).not.toContain('Authorization');
  });

  it.each([
    [
      'subscriptions.items_not_array',
      { object: 'list', items: { invalid: true }, next_page: null },
    ],
    [
      'subscriptions.next_page_invalid',
      subscriptionsPage(validSubscription(), { next_page: 123 }),
    ],
    [
      'subscription.status_invalid',
      subscriptionsPage(validSubscription({ status: null })),
    ],
    [
      'subscription.gives_access_invalid',
      subscriptionsPage(validSubscription({ gives_access: 'true' })),
    ],
    [
      'subscription.current_period_ends_at_invalid',
      subscriptionsPage(validSubscription({ current_period_ends_at: '3000' })),
    ],
    [
      'subscription.environment_invalid',
      subscriptionsPage(validSubscription({ environment: 'SANDBOX' })),
    ],
    [
      'entitlements.items_not_array',
      subscriptionsPage(validSubscription({ entitlements: validEntitlements({ items: {} }) })),
    ],
    [
      'entitlement.lookup_key_invalid',
      subscriptionsPage(
        validSubscription({
          entitlements: validEntitlements({
            items: [
              {
                object: 'entitlement',
                id: 'ent-premium',
                lookup_key: 123,
                products: { object: 'list', items: [], next_page: null },
              },
            ],
          }),
        }),
      ),
    ],
    [
      'entitlement.products_invalid',
      subscriptionsPage(
        validSubscription({
          entitlements: validEntitlements({
            items: [
              {
                object: 'entitlement',
                id: 'ent-premium',
                lookup_key: 'premium',
                products: { object: 'list', items: {}, next_page: null },
              },
            ],
          }),
        }),
      ),
    ],
    [
      'pagination.url_invalid',
      subscriptionsPage(validSubscription(), {
        next_page: 'https://example.invalid/v2/projects/test/customers/customer-1/subscriptions',
      }),
    ],
  ])('continues rejecting the same invalid payload: %s', async (failureCode, body) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body)) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('customer-1')).rejects.toMatchObject({
      kind: 'invalid_response',
      validationFailure: { validationFailureCode: failureCode },
    });
  });

  it('attributes a paginated entitlement validation failure to its endpoint and page', async () => {
    const firstPage = subscriptionsPage(
      validSubscription({
        entitlements: validEntitlements({
          next_page:
            '/v2/projects/test/subscriptions/sub-1/entitlements?starting_after=ent-premium',
        }),
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse({ object: 'list', items: {}, next_page: null })) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerSubscriptions('customer-1')).rejects.toMatchObject({
      kind: 'invalid_response',
      validationFailure: { validationFailureCode: 'entitlements.items_not_array' },
    });
    expect(loggerMocks.logWarn).toHaveBeenCalledWith(
      'billing:revenuecat-api',
      'v2_response_validation_failure',
      expect.objectContaining({
        operation: 'subscription_entitlements',
        pageIndex: 0,
        httpStatus: 200,
        validationFailureCode: 'entitlements.items_not_array',
        expectedType: 'array',
        receivedType: 'object',
      }),
    );
  });

  it('P: searches customers and reads aliases using only the injected HTTP mock', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [{ object: 'customer', id: 'customer-1' }],
          next_page: null,
          url: '/v2/projects/test/customers',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [
            { object: 'customer.alias', id: 'firebase-old', created_at: 1 },
            { object: 'customer.alias', id: 'firebase-current', created_at: 2 },
          ],
          next_page: null,
          url: '/v2/projects/test/customers/customer-1/aliases',
        }),
      ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const result = await client.getCustomerIdentityGraph('firebase-old');

    expect(result).toEqual({
      customerIds: ['customer-1'],
      aliases: ['firebase-old', 'firebase-current'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.revenuecat.com/v2/projects/test/customers?search=firebase-old&limit=100',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
  });

  it.each([429, 500, 503])('I: classifies HTTP %s as a temporary failure', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, status)) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerIdentityGraph('firebase-old')).rejects.toMatchObject({
      kind: 'temporary',
      statusCode: status,
    });
  });

  it('fails closed when search returns a profile whose aliases do not contain the lookup id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [{ object: 'customer', id: 'customer-from-unrelated-search-field' }],
          next_page: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [{ object: 'customer.alias', id: 'different-app-user-id' }],
          next_page: null,
        }),
      ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerIdentityGraph('firebase-old')).resolves.toEqual({
      customerIds: [],
      aliases: [],
    });
  });

  it('I: aborts at the explicit timeout and classifies it as temporary', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      timeoutMs: 5,
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerIdentityGraph('firebase-old')).rejects.toMatchObject({
      kind: 'temporary',
    });
  });

  it.each([401, 403])('J: classifies HTTP %s as an authentication failure', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, status)) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerIdentityGraph('firebase-old')).rejects.toMatchObject({
      kind: 'authentication',
      statusCode: status,
    });
  });

  it('treats HTTP 404 as a definitive empty identity result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerIdentityGraph('firebase-old')).resolves.toEqual({
      customerIds: [],
      aliases: [],
    });
  });

  it('rejects a malformed successful response instead of trusting its JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ object: 'list', items: [{ id: 123 }] })) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    const request = client.getCustomerIdentityGraph('firebase-old');
    await expect(request).rejects.toBeInstanceOf(RevenueCatApiError);
    await expect(request).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('classifies syntactically invalid JSON as an invalid upstream response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{not-json', { status: 200 })) as unknown as typeof fetch;
    const client = new RevenueCatV2Client({
      apiKey: 'unit-test-secret',
      projectId: 'test',
      fetchImpl: fetchMock,
    });

    await expect(client.getCustomerIdentityGraph('firebase-old')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
