import { defineSecret } from 'firebase-functions/params';
import { REVENUECAT_PROJECT_ID } from './constants';
import { logWarn } from '../lib/logger';

/** Server-only RevenueCat V2 secret. Bound to revenueCatWebhook in index.ts. */
export const REVENUECAT_API_SECRET_KEY = defineSecret('REVENUECAT_API_SECRET_KEY');

const REVENUECAT_V2_BASE_URL = 'https://api.revenuecat.com';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_LIST_PAGES = 20;
const SCOPE = 'billing:revenuecat-api';

type RevenueCatDiagnosticOperation = 'customer_subscriptions' | 'subscription_entitlements';

interface RevenueCatDiagnosticContext {
  operation: RevenueCatDiagnosticOperation;
  pageIndex: number;
}

interface RevenueCatValidationFailure {
  validationFailureCode: string;
  expectedType: string;
  receivedType: string;
}

interface RevenueCatListValidationCodes {
  object: string;
  items: string;
  item: string;
  nextPage: string;
}

const GENERIC_LIST_VALIDATION_CODES: RevenueCatListValidationCodes = {
  object: 'response.object_invalid',
  items: 'response.items_not_array',
  item: 'response.item_invalid',
  nextPage: 'response.next_page_invalid',
};

const SUBSCRIPTIONS_LIST_VALIDATION_CODES: RevenueCatListValidationCodes = {
  object: 'subscriptions.object_invalid',
  items: 'subscriptions.items_not_array',
  item: 'subscriptions.item_invalid',
  nextPage: 'subscriptions.next_page_invalid',
};

const ENTITLEMENTS_LIST_VALIDATION_CODES: RevenueCatListValidationCodes = {
  object: 'entitlements.object_invalid',
  items: 'entitlements.items_not_array',
  item: 'entitlements.item_invalid',
  nextPage: 'entitlements.next_page_invalid',
};

const ENTITLEMENT_PRODUCTS_LIST_VALIDATION_CODES: RevenueCatListValidationCodes = {
  object: 'entitlement.products_object_invalid',
  items: 'entitlement.products_invalid',
  item: 'entitlement.product_invalid',
  nextPage: 'entitlement.products_next_page_invalid',
};

export type RevenueCatApiErrorKind =
  | 'temporary'
  | 'authentication'
  | 'configuration'
  | 'invalid_response'
  | 'not_found';

/** Sanitized error: it never retains response bodies, headers, or API keys. */
export class RevenueCatApiError extends Error {
  diagnosticLogged = false;

  constructor(
    public readonly kind: RevenueCatApiErrorKind,
    public readonly statusCode?: number,
    public readonly validationFailure?: RevenueCatValidationFailure,
  ) {
    super(`RevenueCat API request failed (${kind})`);
    this.name = 'RevenueCatApiError';
  }
}

export interface RevenueCatCustomerIdentityGraph {
  customerIds: string[];
  aliases: string[];
}

export interface RevenueCatIdentityApi {
  getCustomerIdentityGraph(lookupId: string): Promise<RevenueCatCustomerIdentityGraph>;
}

export type RevenueCatSubscriptionEnvironment = 'production' | 'sandbox';

export interface RevenueCatSubscriptionEntitlementProduct {
  id: string;
  storeIdentifier: string;
}

export interface RevenueCatSubscriptionEntitlement {
  id: string;
  lookupKey: string;
  products: RevenueCatSubscriptionEntitlementProduct[];
}

/** Validated subset of RevenueCat's V2 Subscription model used by AJ Fit. */
export interface RevenueCatSubscription {
  id: string;
  customerId: string;
  originalCustomerId: string;
  productId: string | null;
  startsAtMs: number;
  currentPeriodStartsAtMs: number;
  currentPeriodEndsAtMs: number | null;
  endsAtMs: number | null;
  givesAccess: boolean;
  pendingPayment: boolean;
  autoRenewalStatus: string;
  status: string;
  entitlements: RevenueCatSubscriptionEntitlement[];
  environment: RevenueCatSubscriptionEnvironment;
  store: string;
}

export interface RevenueCatSubscriptionApi extends RevenueCatIdentityApi {
  getCustomerSubscriptions(
    customerId: string,
    environment?: RevenueCatSubscriptionEnvironment,
  ): Promise<RevenueCatSubscription[]>;
}

export interface RevenueCatV2ClientOptions {
  apiKey: string;
  projectId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RevenueCatListPage {
  items: Array<Record<string, unknown>>;
  nextPage: string | null;
}

interface RevenueCatFetchedListPage extends RevenueCatListPage {
  httpStatus: number;
}

interface ParsedRevenueCatSubscription {
  subscription: Omit<RevenueCatSubscription, 'entitlements'>;
  entitlements: RevenueCatSubscriptionEntitlement[];
  nextEntitlementsPage: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalidResponse(
  validationFailureCode: string,
  expectedType: string,
  received: unknown,
): RevenueCatApiError {
  return new RevenueCatApiError('invalid_response', undefined, {
    validationFailureCode,
    expectedType,
    receivedType: receivedType(received),
  });
}

function logValidationFailure(
  error: unknown,
  context: RevenueCatDiagnosticContext,
  httpStatus?: number,
): void {
  if (
    !(error instanceof RevenueCatApiError) ||
    error.kind !== 'invalid_response' ||
    error.validationFailure === undefined ||
    error.diagnosticLogged
  ) {
    return;
  }

  error.diagnosticLogged = true;
  logWarn(SCOPE, 'v2_response_validation_failure', {
    ...context,
    httpStatus,
    ...error.validationFailure,
  });
}

function parseListPage(
  value: unknown,
  codes: RevenueCatListValidationCodes = GENERIC_LIST_VALIDATION_CODES,
): RevenueCatListPage {
  if (!isRecord(value) || value.object !== 'list') {
    throw invalidResponse(codes.object, 'list_object', isRecord(value) ? value.object : value);
  }

  if (!Array.isArray(value.items)) {
    throw invalidResponse(codes.items, 'array', value.items);
  }

  const items = value.items;
  if (!items.every(isRecord)) {
    const invalidItemIndex = items.findIndex((item) => !isRecord(item));
    throw invalidResponse(codes.item, 'object', items[invalidItemIndex]);
  }

  const nextPageValue = value.next_page;
  if (nextPageValue !== undefined && nextPageValue !== null && typeof nextPageValue !== 'string') {
    throw invalidResponse(codes.nextPage, 'string_or_null_or_absent', nextPageValue);
  }

  return {
    items,
    nextPage: typeof nextPageValue === 'string' && nextPageValue.length > 0 ? nextPageValue : null,
  };
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  validationFailureCode: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidResponse(validationFailureCode, 'non_empty_string', value);
  }
  return value.trim();
}

function requiredBoolean(
  record: Record<string, unknown>,
  field: string,
  validationFailureCode: string,
): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') throw invalidResponse(validationFailureCode, 'boolean', value);
  return value;
}

function requiredTimestampMs(
  record: Record<string, unknown>,
  field: string,
  validationFailureCode: string,
): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidResponse(validationFailureCode, 'non_negative_integer', value);
  }
  return value;
}

function nullableTimestampMs(
  record: Record<string, unknown>,
  field: string,
  validationFailureCode: string,
): number | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidResponse(validationFailureCode, 'non_negative_integer_or_null', value);
  }
  return value;
}

function parseEntitlementProducts(value: unknown): RevenueCatSubscriptionEntitlementProduct[] {
  if (value === undefined || value === null) return [];

  const page = parseListPage(value, ENTITLEMENT_PRODUCTS_LIST_VALIDATION_CODES);
  return page.items.map((item) => ({
    id: requiredString(item, 'id', 'entitlement.product.id_invalid'),
    storeIdentifier: requiredString(
      item,
      'store_identifier',
      'entitlement.product.store_identifier_invalid',
    ),
  }));
}

function parseSubscriptionEntitlements(value: unknown): {
  items: RevenueCatSubscriptionEntitlement[];
  nextPage: string | null;
} {
  const page = parseListPage(value, ENTITLEMENTS_LIST_VALIDATION_CODES);
  const items = page.items.map((item) => {
    if (item.object !== 'entitlement') {
      throw invalidResponse('entitlement.object_invalid', 'entitlement_object', item.object);
    }
    return {
      id: requiredString(item, 'id', 'entitlement.id_invalid'),
      lookupKey: requiredString(item, 'lookup_key', 'entitlement.lookup_key_invalid'),
      products: parseEntitlementProducts(item.products),
    };
  });
  return { items, nextPage: page.nextPage };
}

function parseSubscription(value: Record<string, unknown>): ParsedRevenueCatSubscription {
  if (value.object !== 'subscription') {
    throw invalidResponse('subscription.object_invalid', 'subscription_object', value.object);
  }

  const productIdValue = value.product_id;
  if (productIdValue !== null && typeof productIdValue !== 'string') {
    throw invalidResponse('subscription.product_id_invalid', 'string_or_null', productIdValue);
  }

  const environment = requiredString(value, 'environment', 'subscription.environment_invalid');
  if (environment !== 'production' && environment !== 'sandbox') {
    throw invalidResponse(
      'subscription.environment_invalid',
      'production_or_sandbox',
      environment,
    );
  }

  const entitlementPage = parseSubscriptionEntitlements(value.entitlements);
  return {
    subscription: {
      id: requiredString(value, 'id', 'subscription.id_invalid'),
      customerId: requiredString(value, 'customer_id', 'subscription.customer_id_invalid'),
      originalCustomerId: requiredString(
        value,
        'original_customer_id',
        'subscription.original_customer_id_invalid',
      ),
      productId: typeof productIdValue === 'string' ? productIdValue.trim() || null : null,
      startsAtMs: requiredTimestampMs(value, 'starts_at', 'subscription.starts_at_invalid'),
      currentPeriodStartsAtMs: requiredTimestampMs(
        value,
        'current_period_starts_at',
        'subscription.current_period_starts_at_invalid',
      ),
      currentPeriodEndsAtMs: nullableTimestampMs(
        value,
        'current_period_ends_at',
        'subscription.current_period_ends_at_invalid',
      ),
      endsAtMs: nullableTimestampMs(value, 'ends_at', 'subscription.ends_at_invalid'),
      givesAccess: requiredBoolean(
        value,
        'gives_access',
        'subscription.gives_access_invalid',
      ),
      pendingPayment: requiredBoolean(
        value,
        'pending_payment',
        'subscription.pending_payment_invalid',
      ),
      autoRenewalStatus: requiredString(
        value,
        'auto_renewal_status',
        'subscription.auto_renewal_status_invalid',
      ),
      status: requiredString(value, 'status', 'subscription.status_invalid'),
      environment,
      store: requiredString(value, 'store', 'subscription.store_invalid'),
    },
    entitlements: entitlementPage.items,
    nextEntitlementsPage: entitlementPage.nextPage,
  };
}

/**
 * Minimal server-side RevenueCat REST API V2 client. It supports the
 * identity fallback (customer search + every alias page) and the complete
 * subscriptions/entitlements read used after a resolved TRANSFER. HTTP,
 * pagination, and schema handling remain isolated here so policy stays pure
 * and unit-testable.
 */
export class RevenueCatV2Client implements RevenueCatSubscriptionApi {
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RevenueCatV2ClientOptions) {
    const apiKey = options.apiKey.trim();
    const projectId = (options.projectId ?? REVENUECAT_PROJECT_ID).trim();
    if (!apiKey || !projectId) {
      throw new RevenueCatApiError('configuration');
    }

    this.apiKey = apiKey;
    this.projectId = projectId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getCustomerIdentityGraph(lookupId: string): Promise<RevenueCatCustomerIdentityGraph> {
    const normalizedLookupId = lookupId.trim();
    if (!normalizedLookupId) return { customerIds: [], aliases: [] };

    const searchPath =
      `/v2/projects/${encodeURIComponent(this.projectId)}/customers` +
      `?search=${encodeURIComponent(normalizedLookupId)}&limit=100`;
    let searchPage: RevenueCatListPage;
    try {
      searchPage = await this.getListPage(searchPath);
    } catch (error) {
      if (error instanceof RevenueCatApiError && error.kind === 'not_found') {
        return { customerIds: [], aliases: [] };
      }
      throw error;
    }
    const searchedCustomerIds = searchPage.items.map((item) => {
      if (item.object !== 'customer' || typeof item.id !== 'string' || !item.id.trim()) {
        throw new RevenueCatApiError('invalid_response');
      }
      return item.id.trim();
    });

    // Identifier searches are documented as a single page. A next page here
    // means the response did not obey that contract; fail closed rather than
    // silently ignoring possible matching profiles.
    if (searchPage.nextPage !== null) {
      throw new RevenueCatApiError('invalid_response');
    }

    const customerIds = new Set<string>();
    const aliases = new Set<string>();
    for (const customerId of searchedCustomerIds) {
      let customerAliases: string[];
      try {
        customerAliases = await this.getAllAliases(customerId);
      } catch (error) {
        if (error instanceof RevenueCatApiError && error.kind === 'not_found') {
          return { customerIds: [], aliases: [] };
        }
        throw error;
      }
      // `search` also accepts email and store transaction identifiers. The
      // webhook value is an App User ID, so require an exact customer/alias
      // match before treating the returned profile as identity evidence.
      if (customerId !== normalizedLookupId && !customerAliases.includes(normalizedLookupId)) {
        continue;
      }
      customerIds.add(customerId);
      for (const alias of customerAliases) aliases.add(alias);
    }

    return { customerIds: [...customerIds], aliases: [...aliases] };
  }

  async getCustomerSubscriptions(
    customerId: string,
    environment?: RevenueCatSubscriptionEnvironment,
  ): Promise<RevenueCatSubscription[]> {
    const normalizedCustomerId = customerId.trim();
    if (!normalizedCustomerId) throw new RevenueCatApiError('configuration');

    const expectedPath =
      `/v2/projects/${encodeURIComponent(this.projectId)}/customers/` +
      `${encodeURIComponent(normalizedCustomerId)}/subscriptions`;
    const environmentQuery = environment ? `&environment=${environment}` : '';
    let nextPath: string | null = `${expectedPath}?limit=100${environmentQuery}`;
    const subscriptions: RevenueCatSubscription[] = [];

    for (let pageIndex = 0; nextPath !== null; pageIndex += 1) {
      const context: RevenueCatDiagnosticContext = {
        operation: 'customer_subscriptions',
        pageIndex,
      };
      if (pageIndex >= MAX_LIST_PAGES) {
        const error = invalidResponse(
          'pagination.page_limit_exceeded',
          'page_index_below_limit',
          pageIndex,
        );
        logValidationFailure(error, context);
        throw error;
      }

      const page = await this.getListPage(nextPath, context, SUBSCRIPTIONS_LIST_VALIDATION_CODES);
      try {
        for (const item of page.items) {
          const parsed = parseSubscription(item);
          const entitlements = await this.getAllSubscriptionEntitlements(
            parsed.subscription.id,
            parsed.entitlements,
            parsed.nextEntitlementsPage,
          );
          subscriptions.push({ ...parsed.subscription, entitlements });
        }

        nextPath = this.validatedNextPage(page.nextPage, expectedPath);
      } catch (error) {
        logValidationFailure(error, context, page.httpStatus);
        throw error;
      }
    }

    return subscriptions;
  }

  private async getAllAliases(customerId: string): Promise<string[]> {
    const expectedPath =
      `/v2/projects/${encodeURIComponent(this.projectId)}/customers/` +
      `${encodeURIComponent(customerId)}/aliases`;
    let nextPath: string | null = `${expectedPath}?limit=100`;
    const aliases = new Set<string>();

    for (let pageIndex = 0; nextPath !== null; pageIndex += 1) {
      if (pageIndex >= MAX_LIST_PAGES) {
        throw new RevenueCatApiError('invalid_response');
      }

      const page = await this.getListPage(nextPath);
      for (const item of page.items) {
        if (item.object !== 'customer.alias' || typeof item.id !== 'string' || !item.id.trim()) {
          throw new RevenueCatApiError('invalid_response');
        }
        aliases.add(item.id.trim());
      }

      nextPath = this.validatedNextPage(page.nextPage, expectedPath);
    }

    return [...aliases];
  }

  private async getAllSubscriptionEntitlements(
    subscriptionId: string,
    initialItems: RevenueCatSubscriptionEntitlement[],
    initialNextPage: string | null,
  ): Promise<RevenueCatSubscriptionEntitlement[]> {
    const expectedPath =
      `/v2/projects/${encodeURIComponent(this.projectId)}/subscriptions/` +
      `${encodeURIComponent(subscriptionId)}/entitlements`;
    let nextPath = initialNextPage;
    const entitlements = new Map(initialItems.map((item) => [item.id, item]));

    for (let pageIndex = 0; nextPath !== null; pageIndex += 1) {
      const context: RevenueCatDiagnosticContext = {
        operation: 'subscription_entitlements',
        pageIndex,
      };
      if (pageIndex >= MAX_LIST_PAGES) {
        const error = invalidResponse(
          'pagination.page_limit_exceeded',
          'page_index_below_limit',
          pageIndex,
        );
        logValidationFailure(error, context);
        throw error;
      }

      let validatedPath: string | null;
      try {
        validatedPath = this.validatedNextPage(nextPath, expectedPath);
      } catch (error) {
        logValidationFailure(error, context);
        throw error;
      }
      if (validatedPath === null) break;

      const page = await this.getListPage(
        validatedPath,
        context,
        ENTITLEMENTS_LIST_VALIDATION_CODES,
      );
      try {
        const parsed = parseSubscriptionEntitlements({
          object: 'list',
          items: page.items,
          next_page: page.nextPage,
        });
        for (const entitlement of parsed.items) entitlements.set(entitlement.id, entitlement);
        nextPath = parsed.nextPage;
      } catch (error) {
        logValidationFailure(error, context, page.httpStatus);
        throw error;
      }
    }

    return [...entitlements.values()];
  }

  private validatedNextPage(nextPage: string | null, expectedPath: string): string | null {
    if (nextPage === null) return null;
    const nextUrl = new URL(nextPage, REVENUECAT_V2_BASE_URL);
    if (nextUrl.origin !== REVENUECAT_V2_BASE_URL || nextUrl.pathname !== expectedPath) {
      throw invalidResponse(
        'pagination.url_invalid',
        'revenuecat_v2_same_endpoint_url',
        nextPage,
      );
    }
    return `${nextUrl.pathname}${nextUrl.search}`;
  }

  private async getListPage(
    path: string,
    diagnosticContext?: RevenueCatDiagnosticContext,
    validationCodes: RevenueCatListValidationCodes = GENERIC_LIST_VALIDATION_CODES,
  ): Promise<RevenueCatFetchedListPage> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${REVENUECAT_V2_BASE_URL}${path}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
      } catch {
        throw new RevenueCatApiError('temporary');
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new RevenueCatApiError('authentication', response.status);
        }
        if (
          response.status === 408 ||
          response.status === 423 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          throw new RevenueCatApiError('temporary', response.status);
        }
        if (response.status === 404) throw new RevenueCatApiError('not_found', response.status);
        throw new RevenueCatApiError('configuration', response.status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        const error = new RevenueCatApiError('invalid_response', response.status, {
          validationFailureCode:
            diagnosticContext?.operation === 'customer_subscriptions'
              ? 'subscriptions.json_invalid'
              : diagnosticContext?.operation === 'subscription_entitlements'
                ? 'entitlements.json_invalid'
                : 'response.json_invalid',
          expectedType: 'json',
          receivedType: 'invalid_json',
        });
        if (diagnosticContext) {
          logValidationFailure(error, diagnosticContext, response.status);
        }
        throw error;
      }
      try {
        return { ...parseListPage(body, validationCodes), httpStatus: response.status };
      } catch (error) {
        if (diagnosticContext) {
          logValidationFailure(error, diagnosticContext, response.status);
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createRevenueCatV2Client(): RevenueCatV2Client {
  return new RevenueCatV2Client({ apiKey: REVENUECAT_API_SECRET_KEY.value() });
}
