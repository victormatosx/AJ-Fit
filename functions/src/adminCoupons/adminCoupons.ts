import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';
import { requireAdminUid } from '../attribution/adminAuth';
import { PROMO_CODES_COLLECTION } from '../attribution/constants';
import { parsePromoCodeDocument } from '../attribution/promoCodeCatalog';
import { normalizePromoCode } from '../attribution/normalize';
import { auth, db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { isoDate, safeString } from '../adminUsers/presentation';
import { couponJourneyRecord, summarizeCouponJourney, type CouponJourneyRecord } from './presentation';
import { SUBSCRIPTION_TRANSACTIONS_COLLECTION } from '../billing/subscriptionTransactions';

const SCOPE = 'admin:coupons';
const REDEMPTIONS = 'couponRedemptions';
const USERS = 'users';
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const BATCH_SIZE = 100;
const SUBSCRIPTION_STATES = new Set(['ALL', 'TRIAL', 'ACTIVE', 'CANCELS_AT_PERIOD_END', 'BILLING_ISSUE', 'EXPIRED', 'UNKNOWN']);
const PLANS = new Set(['ALL', 'monthly', 'annual', 'unknown']);
const COUPON_STATUSES = new Set(['ALL', 'ACTIVE', 'INACTIVE', 'EXPIRED', 'SCHEDULED']);

type PlainDocument = Record<string, unknown>;

function objectMap(value: unknown): PlainDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as PlainDocument : {};
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function getUsersByUid(uids: readonly string[]): Promise<Map<string, DocumentSnapshot>> {
  const result = new Map<string, DocumentSnapshot>();
  await Promise.all(chunks([...new Set(uids)], 400).map(async (batch) => {
    const snapshots = await db.getAll(...batch.map((uid) => db.collection(USERS).doc(uid)));
    snapshots.forEach((snapshot) => result.set(snapshot.id, snapshot));
  }));
  return result;
}

async function getAuthUsersByUid(uids: readonly string[]): Promise<Map<string, UserRecord>> {
  const result = new Map<string, UserRecord>();
  await Promise.all(chunks([...new Set(uids)], BATCH_SIZE).map(async (batch) => {
    const response = await auth.getUsers(batch.map((uid) => ({ uid })));
    response.users.forEach((user) => result.set(user.uid, user));
  }));
  return result;
}

function couponStatus(active: boolean, startsAt: string | null, endsAt: string | null, now = Date.now()) {
  if (!active) return 'INACTIVE';
  if (endsAt && new Date(endsAt).getTime() < now) return 'EXPIRED';
  if (startsAt && new Date(startsAt).getTime() > now) return 'SCHEDULED';
  return 'ACTIVE';
}

function catalogView(id: string, value: unknown) {
  const parsed = parsePromoCodeDocument(value);
  if (!parsed) return null;
  const startsAt = isoDate(parsed.startsAt);
  const endsAt = isoDate(parsed.endsAt);
  return {
    id,
    code: parsed.code,
    active: parsed.active,
    status: couponStatus(parsed.active, startsAt, endsAt),
    startsAt,
    endsAt,
    influencerId: parsed.influencerId,
    campaignId: parsed.campaignId,
    internalName: parsed.internalName,
    notes: parsed.notes,
    createdAt: isoDate(parsed.createdAt),
    updatedAt: isoDate(parsed.updatedAt),
    createdBy: parsed.createdBy,
    android: {
      monthly: parsed.androidBasePlanIdMonthly && parsed.androidOfferIdMonthly ? { basePlanId: parsed.androidBasePlanIdMonthly, offerId: parsed.androidOfferIdMonthly } : null,
      annual: parsed.androidBasePlanIdAnnual && parsed.androidOfferIdAnnual ? { basePlanId: parsed.androidBasePlanIdAnnual, offerId: parsed.androidOfferIdAnnual } : null,
    },
    iosPromotion: parsed.iosPromotion,
    appleConfiguration: {
      confirmedByAdmin: parsed.appleConfigurationConfirmedAt != null,
      confirmedAt: isoDate(parsed.appleConfigurationConfirmedAt),
      confirmedBy: parsed.appleConfigurationConfirmedBy,
      verification: 'ADMIN_DECLARATION' as const,
    },
    benefit: parsed.androidBasePlanIdMonthly || parsed.androidBasePlanIdAnnual || parsed.iosPromotion ? 'Campanha promocional da loja' : null,
  };
}

function stringFilter(value: unknown, allowed: Set<string>, fallback: string): string {
  const normalized = typeof value === 'string' ? value : fallback;
  if (!allowed.has(normalized)) throw new HttpsError('invalid-argument', 'invalid_filter');
  return normalized;
}

function optionalDate(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `invalid_${name}`);
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new HttpsError('invalid-argument', `invalid_${name}`);
  return parsed;
}

interface Filters {
  search: string;
  couponStatus: string;
  influencerId: string;
  subscriptionState: string;
  plan: string;
  from: number | null;
  to: number | null;
}

function parseFilters(data: PlainDocument): Filters {
  const search = typeof data.search === 'string' ? data.search.trim().toLocaleLowerCase('pt-BR') : '';
  if (search.length > 100) throw new HttpsError('invalid-argument', 'search_too_long');
  const from = optionalDate(data.from, 'from');
  const to = optionalDate(data.to, 'to');
  if (from !== null && to !== null && from > to) throw new HttpsError('invalid-argument', 'invalid_period');
  return {
    search,
    couponStatus: stringFilter(data.couponStatus, COUPON_STATUSES, 'ALL'),
    influencerId: typeof data.influencerId === 'string' ? data.influencerId.trim() : '',
    subscriptionState: stringFilter(data.subscriptionState, SUBSCRIPTION_STATES, 'ALL'),
    plan: stringFilter(data.plan, PLANS, 'ALL'),
    from,
    to,
  };
}

function recordMatches(record: CouponJourneyRecord, filters: Filters) {
  const applied = record.appliedAt ? new Date(record.appliedAt).getTime() : null;
  if (filters.from !== null && (applied === null || applied < filters.from)) return false;
  if (filters.to !== null && (applied === null || applied > filters.to)) return false;
  if (filters.subscriptionState !== 'ALL' && record.state !== filters.subscriptionState) return false;
  if (filters.plan !== 'ALL' && record.subscription.plan !== filters.plan) return false;
  return true;
}

function profileView(userSnapshot: DocumentSnapshot | undefined, authUser: UserRecord | undefined) {
  const user = objectMap(userSnapshot?.data());
  const profile = objectMap(user.profile);
  return {
    name: safeString(profile.name) ?? authUser?.displayName ?? null,
    email: authUser?.email ?? safeString(profile.email),
    photoURL: safeString(profile.photoURL) ?? authUser?.photoURL ?? null,
  };
}

function financialSummary(documents: readonly DocumentSnapshot[]) {
  const revenueByCurrency: Record<string, number> = {};
  const estimatedProceedsByCurrency: Record<string, number> = {};
  for (const snapshot of documents) {
    const currency = safeString(snapshot.get('currency'));
    const gross = snapshot.get('grossRevenue');
    const proceeds = snapshot.get('estimatedProceeds');
    if (!currency || typeof gross !== 'number' || !Number.isFinite(gross)) continue;
    revenueByCurrency[currency] = (revenueByCurrency[currency] ?? 0) + gross;
    if (typeof proceeds === 'number' && Number.isFinite(proceeds)) estimatedProceedsByCurrency[currency] = (estimatedProceedsByCurrency[currency] ?? 0) + proceeds;
  }
  return {
    paidTransactions: documents.length,
    initialPaidTransactions: documents.filter((snapshot) => snapshot.get('eventType') === 'INITIAL_PURCHASE').length,
    renewals: documents.filter((snapshot) => snapshot.get('eventType') === 'RENEWAL').length,
    revenueByCurrency,
    estimatedProceedsByCurrency,
    commission: null,
  };
}

function financialMatches(snapshot: DocumentSnapshot, filters: Filters) {
  const purchasedAt = isoDate(snapshot.get('purchasedAt'));
  const millis = purchasedAt ? new Date(purchasedAt).getTime() : null;
  if (filters.from !== null && (millis === null || millis < filters.from)) return false;
  if (filters.to !== null && (millis === null || millis > filters.to)) return false;
  if (filters.plan !== 'ALL' && snapshot.get('plan') !== filters.plan) return false;
  return true;
}

export async function adminListCouponsHandler(request: CallableRequest<PlainDocument>) {
  const adminUid = await requireAdminUid(request);
  const filters = parseFilters(objectMap(request.data));
  try {
    const [catalogSnapshot, redemptionSnapshot, transactionSnapshot] = await Promise.all([
      db.collection(PROMO_CODES_COLLECTION).get(),
      db.collection(REDEMPTIONS).get(),
      db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).get(),
    ]);
    const catalog = catalogSnapshot.docs.flatMap((doc) => {
      const item = catalogView(doc.id, doc.data());
      return item ? [item] : [];
    });
    const userByUid = await getUsersByUid(redemptionSnapshot.docs.map((doc) => doc.id));
    const records = redemptionSnapshot.docs.map((doc) => couponJourneyRecord(doc.id, doc.data(), userByUid.get(doc.id)?.data()));
    const filteredRecords = records.filter((record) => recordMatches(record, filters));
    const matchingAttributionUids = new Set(filteredRecords.map((record) => record.uid));
    const byCode = new Map<string, CouponJourneyRecord[]>();
    filteredRecords.forEach((record) => {
      if (!record.couponCode) return;
      byCode.set(record.couponCode, [...(byCode.get(record.couponCode) ?? []), record]);
    });
    const transactionsByCode = new Map<string, DocumentSnapshot[]>();
    transactionSnapshot.docs.filter((doc) => financialMatches(doc, filters) && (filters.subscriptionState === 'ALL' || matchingAttributionUids.has(String(doc.get('attributionUid'))))).forEach((doc) => {
      const transactionCode = safeString(doc.get('couponCode'));
      if (!transactionCode) return;
      transactionsByCode.set(transactionCode, [...(transactionsByCode.get(transactionCode) ?? []), doc]);
    });
    const coupons = catalog
      .filter((coupon) => filters.couponStatus === 'ALL' || coupon.status === filters.couponStatus)
      .filter((coupon) => !filters.influencerId || coupon.influencerId === filters.influencerId)
      .filter((coupon) => !filters.search || coupon.code.toLocaleLowerCase('pt-BR').includes(filters.search) || coupon.influencerId.toLocaleLowerCase('pt-BR').includes(filters.search) || coupon.campaignId.toLocaleLowerCase('pt-BR').includes(filters.search) || coupon.internalName?.toLocaleLowerCase('pt-BR').includes(filters.search))
      .map((coupon) => ({ ...coupon, metrics: { ...summarizeCouponJourney(byCode.get(coupon.code) ?? []), ...financialSummary(transactionsByCode.get(coupon.code) ?? []) } }))
      .filter((coupon) => filters.subscriptionState === 'ALL' && filters.plan === 'ALL' || coupon.metrics.redemptions > 0)
      .sort((a, b) => a.code.localeCompare(b.code));

    const influencers = [...new Set(catalog.map((coupon) => coupon.influencerId))].sort();
    const visibleCodes = new Set(coupons.map((coupon) => coupon.code));
    const visibleTransactions = [...transactionsByCode.entries()].filter(([transactionCode]) => visibleCodes.has(transactionCode)).flatMap(([, documents]) => documents);
    const overview = {
      ...summarizeCouponJourney(filteredRecords.filter((record) => record.couponCode !== null && visibleCodes.has(record.couponCode))),
      ...financialSummary(visibleTransactions),
      activeCoupons: coupons.filter((coupon) => coupon.status === 'ACTIVE').length,
    };
    logInfo(SCOPE, 'coupon intelligence listed', { adminUid, couponCount: coupons.length, redemptionCount: filteredRecords.length });
    return { coupons, influencers, overview, dataAvailability: { revenue: true, commission: false, transactionHistory: true, historicalBackfillComplete: false, autoRenew: false, gracePeriodEnd: false } };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logFunctionError(SCOPE, error, { adminUid, operation: 'list' });
    throw new HttpsError('internal', 'admin_coupons_list_failed');
  }
}

export async function adminGetCouponHandler(request: CallableRequest<PlainDocument>) {
  const adminUid = await requireAdminUid(request);
  const data = objectMap(request.data);
  const code = normalizePromoCode(data.code);
  if (!code) throw new HttpsError('invalid-argument', 'invalid_code');
  const filters = parseFilters(data);
  const size = data.pageSize === undefined ? PAGE_SIZE : data.pageSize;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) throw new HttpsError('invalid-argument', 'invalid_page_size');
  const offset = data.cursor === undefined || data.cursor === null ? 0 : Number(data.cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new HttpsError('invalid-argument', 'invalid_cursor');

  try {
    const [catalogSnapshot, redemptionsSnapshot, transactionSnapshot] = await Promise.all([
      db.collection(PROMO_CODES_COLLECTION).doc(code).get(),
      db.collection(REDEMPTIONS).where('couponCode', '==', code).get(),
      db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).where('couponCode', '==', code).get(),
    ]);
    if (!catalogSnapshot.exists) throw new HttpsError('not-found', 'promo_code_not_found');
    const coupon = catalogView(catalogSnapshot.id, catalogSnapshot.data());
    if (!coupon) throw new HttpsError('failed-precondition', 'malformed_promo_code');
    const uids = redemptionsSnapshot.docs.map((doc) => doc.id);
    const [userByUid, authByUid] = await Promise.all([getUsersByUid(uids), getAuthUsersByUid(uids)]);
    const allUsers = redemptionsSnapshot.docs.map((doc) => {
      const journey = couponJourneyRecord(doc.id, doc.data(), userByUid.get(doc.id)?.data());
      return { ...journey, profile: profileView(userByUid.get(doc.id), authByUid.get(doc.id)) };
    }).filter((record) => recordMatches(record, filters));
    const matchingAttributionUids = new Set(allUsers.map((record) => record.uid));
    const search = filters.search;
    const matchingUsers = allUsers.filter((record) => !search || record.uid.toLocaleLowerCase('pt-BR').includes(search) || record.profile.email?.toLocaleLowerCase('pt-BR').includes(search) || record.profile.name?.toLocaleLowerCase('pt-BR').includes(search));
    matchingUsers.sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''));
    const users = matchingUsers.slice(offset, offset + size);
    const nextOffset = offset + users.length;
    logInfo(SCOPE, 'coupon detail read', { adminUid, code, resultCount: users.length });
    return {
      coupon: { ...coupon, metrics: { ...summarizeCouponJourney(allUsers), ...financialSummary(transactionSnapshot.docs.filter((doc) => financialMatches(doc, filters) && (filters.subscriptionState === 'ALL' || matchingAttributionUids.has(String(doc.get('attributionUid')))))) } },
      users,
      totalUsers: matchingUsers.length,
      nextCursor: nextOffset < matchingUsers.length ? String(nextOffset) : null,
      hasMore: nextOffset < matchingUsers.length,
      dataAvailability: { revenue: true, commission: false, transactionHistory: true, historicalBackfillComplete: false, autoRenew: false, gracePeriodEnd: false },
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logFunctionError(SCOPE, error, { adminUid, operation: 'detail', code });
    throw new HttpsError('internal', 'admin_coupon_detail_failed');
  }
}
