import { FieldPath, Timestamp, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { requireAdminUid } from '../attribution/adminAuth';
import { auth, db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { epochDate, isoDate, resolveSubscriptionPlan, safeBoolean, safeString } from './presentation';
import { readFreeAccessView } from './adminFreeAccess';

const SCOPE = 'admin:users';
const USERS = 'users';
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const ALLOWED_SORTS = new Set(['created_desc', 'created_asc', 'name_asc']);
const ALLOWED_SUBSCRIPTION_STATUSES = new Set([
  'TRIAL',
  'ACTIVE',
  'CANCELED',
  'BILLING_ISSUE',
  'EXPIRED',
]);

type UserDocument = Record<string, unknown>;
type Cursor = { value: string; id: string };

interface ListInput {
  search?: unknown;
  subscriptionStatus?: unknown;
  sort?: unknown;
  pageSize?: unknown;
  cursor?: unknown;
}

interface DetailInput {
  uid?: unknown;
}

function objectMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pageSize(value: unknown): number {
  if (value === undefined) return PAGE_SIZE;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new HttpsError('invalid-argument', 'invalid_page_size');
  }
  return value;
}

function parseCursor(value: unknown): Cursor | null {
  if (value === undefined || value === null) return null;
  const cursor = objectMap(value);
  if (typeof cursor.value !== 'string' || typeof cursor.id !== 'string' || !cursor.id) {
    throw new HttpsError('invalid-argument', 'invalid_cursor');
  }
  return { value: cursor.value, id: cursor.id };
}

function subscriptionView(document: UserDocument) {
  const subscription = objectMap(document.subscription);
  return {
    status: safeString(subscription.status),
    entitlementActive: safeBoolean(subscription.entitlementActive),
    provider: safeString(subscription.provider),
    productId: safeString(subscription.productId),
    plan: resolveSubscriptionPlan(subscription.productId),
    store: safeString(subscription.store),
    startedAt: isoDate(subscription.startedAt),
    trialEndsAt: isoDate(subscription.trialEndsAt),
    currentPeriodEndsAt: isoDate(subscription.currentPeriodEndsAt),
    canceledAt: isoDate(subscription.canceledAt),
    lastRenewedAt: isoDate(subscription.lastRenewedAt),
    updatedAt: isoDate(subscription.updatedAt),
  };
}

function authView(user: UserRecord | null) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    providers: user.providerData.map((provider) => provider.providerId),
    createdAt: isoDate(user.metadata.creationTime),
    lastLoginAt: isoDate(user.metadata.lastSignInTime),
    lastTokenRefreshAt: isoDate(user.metadata.lastRefreshTime),
  };
}

function listItem(snapshot: DocumentSnapshot, user: UserRecord | null, deleting: boolean) {
  const document = (snapshot.data() ?? {}) as UserDocument;
  const profile = objectMap(document.profile);
  const metadata = objectMap(document.metadata);
  const authData = authView(user);
  return {
    uid: snapshot.id,
    name: safeString(profile.name) ?? authData?.displayName ?? null,
    email: authData?.email ?? safeString(profile.email),
    photoURL: safeString(profile.photoURL) ?? authData?.photoURL ?? null,
    createdAt: authData?.createdAt ?? isoDate(metadata.createdAt),
    lastLoginAt: authData?.lastLoginAt ?? null,
    emailVerified: authData?.emailVerified ?? null,
    providers: authData?.providers ?? [],
    accountStatus: deleting ? 'DELETION_IN_PROGRESS' : user?.disabled ? 'DISABLED' : 'ACTIVE',
    subscription: subscriptionView(document),
  };
}

async function enrichPage(snapshots: DocumentSnapshot[]) {
  if (snapshots.length === 0) return [];
  const uids = snapshots.map((snapshot) => snapshot.id);
  const [authResult, lockSnapshots] = await Promise.all([
    auth.getUsers(uids.map((uid) => ({ uid }))),
    db.getAll(...uids.map((uid) => db.collection('accountDeletionLocks').doc(uid))),
  ]);
  const authByUid = new Map(authResult.users.map((user) => [user.uid, user]));
  const deleting = new Set(lockSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id));
  return snapshots.map((snapshot) => listItem(snapshot, authByUid.get(snapshot.id) ?? null, deleting.has(snapshot.id)));
}

function queryCursorValue(snapshot: DocumentSnapshot, sort: string): string {
  if (sort === 'name_asc') return safeString(snapshot.get('profile.name')) ?? '';
  return isoDate(snapshot.get('metadata.createdAt')) ?? new Date(0).toISOString();
}

async function exactSearch(search: string): Promise<DocumentSnapshot[]> {
  let uid: string | null = null;
  try {
    const user = search.includes('@') ? await auth.getUserByEmail(search.toLowerCase()) : await auth.getUser(search);
    uid = user.uid;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
    if (!['auth/user-not-found', 'auth/invalid-uid', 'auth/invalid-email'].includes(code)) throw error;
  }
  if (!uid) return [];
  const snapshot = await db.collection(USERS).doc(uid).get();
  return snapshot.exists ? [snapshot] : [];
}

async function namePrefixSearch(search: string, limit: number, cursor: Cursor | null) {
  const normalized = search.trim();
  let query: Query = db.collection(USERS)
    .orderBy('profile.name', 'asc')
    .orderBy(FieldPath.documentId(), 'asc');
  query = cursor ? query.startAfter(cursor.value, cursor.id) : query.startAt(normalized);
  const snapshot = await query.endAt(`${normalized}\uf8ff`).limit(limit + 1).get();
  const hasMore = snapshot.docs.length > limit;
  const docs = snapshot.docs.slice(0, limit);
  const last = docs.at(-1);
  return {
    docs,
    hasMore,
    nextCursor: hasMore && last
      ? { value: safeString(last.get('profile.name')) ?? '', id: last.id }
      : null,
  };
}

export async function adminListUsersHandler(request: CallableRequest<ListInput>) {
  const adminUid = await requireAdminUid(request);
  const size = pageSize(request.data?.pageSize);
  const search = typeof request.data?.search === 'string' ? request.data.search.trim() : '';
  const status = request.data?.subscriptionStatus;
  const sort = typeof request.data?.sort === 'string' ? request.data.sort : 'created_desc';
  const cursor = parseCursor(request.data?.cursor);

  if (search.length > 100) throw new HttpsError('invalid-argument', 'search_too_long');
  if (!ALLOWED_SORTS.has(sort)) throw new HttpsError('invalid-argument', 'invalid_sort');
  if (status !== undefined && status !== 'ALL' && !ALLOWED_SUBSCRIPTION_STATUSES.has(String(status))) {
    throw new HttpsError('invalid-argument', 'invalid_subscription_status');
  }
  if (search && status !== undefined && status !== 'ALL') {
    throw new HttpsError('invalid-argument', 'search_cannot_be_combined_with_filters');
  }

  try {
    if (search) {
      const exact = cursor ? [] : await exactSearch(search);
      const prefixPage = exact.length > 0
        ? { docs: exact, hasMore: false, nextCursor: null }
        : await namePrefixSearch(search, size, cursor);
      const users = await enrichPage(prefixPage.docs);
      logInfo(SCOPE, 'users searched', { adminUid, resultCount: users.length, searchKind: exact.length ? 'exact' : 'name_prefix' });
      return { users, nextCursor: prefixPage.nextCursor, hasMore: prefixPage.hasMore, searchMode: exact.length ? 'exact' : 'name_prefix' };
    }

    const direction = sort === 'created_asc' || sort === 'name_asc' ? 'asc' : 'desc';
    const orderField = sort === 'name_asc' ? 'profile.name' : 'metadata.createdAt';
    let query: Query = db.collection(USERS);
    if (status !== undefined && status !== 'ALL') query = query.where('subscription.status', '==', status);
    query = query.orderBy(orderField, direction).orderBy(FieldPath.documentId(), direction);
    if (cursor) {
      const cursorValue = orderField === 'metadata.createdAt'
        ? Timestamp.fromDate(new Date(cursor.value))
        : cursor.value;
      if (orderField === 'metadata.createdAt' && Number.isNaN((cursorValue as Timestamp).toMillis())) {
        throw new HttpsError('invalid-argument', 'invalid_cursor');
      }
      query = query.startAfter(cursorValue, cursor.id);
    }
    const page = await query.limit(size + 1).get();
    const hasMore = page.docs.length > size;
    const docs = page.docs.slice(0, size);
    const users = await enrichPage(docs);
    const last = docs.at(-1);
    return {
      users,
      hasMore,
      nextCursor: hasMore && last ? { value: queryCursorValue(last, sort), id: last.id } : null,
      searchMode: null,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logFunctionError(SCOPE, error, { adminUid, operation: 'list' });
    throw new HttpsError('internal', 'admin_users_list_failed');
  }
}

function questionnaireView(snapshot: DocumentSnapshot | null) {
  if (!snapshot?.exists) return null;
  const document = snapshot.data() ?? {};
  const answers = objectMap(document.answers);
  const pregnancyScreening = objectMap(answers.pregnancyScreening);
  const postpartumScreening = objectMap(answers.postpartumScreening);
  const functionalScreening = objectMap(answers.functionalScreening);
  const lipedemaScreening = objectMap(answers.lipedemaScreening);
  const dizzinessScreening = objectMap(answers.dizzinessScreening);
  const postSurgicalScreening = objectMap(answers.postSurgicalScreening);
  const medicalRestrictionScreening = objectMap(answers.medicalRestrictionScreening);
  const storedPlace = safeString(answers.place);
  const storedPrimaryPlace = safeString(answers.primaryPlace);
  const place = storedPlace === 'both' && (storedPrimaryPlace === 'gym' || storedPrimaryPlace === 'home')
    ? storedPrimaryPlace
    : storedPlace;
  return {
    id: snapshot.id,
    version: typeof document.version === 'number' ? document.version : null,
    createdAt: isoDate(document.createdAt),
    answers: {
      sex: safeString(answers.sex),
      birthDate: isoDate(answers.birthDate),
      age: typeof answers.age === 'number' ? answers.age : null,
      height: typeof answers.height === 'number' ? answers.height : null,
      weight: typeof answers.weight === 'number' ? answers.weight : null,
      goal: safeString(answers.goal),
      frequency: safeString(answers.frequency),
      level: safeString(answers.level),
      duration: safeString(answers.duration),
      days: typeof answers.days === 'number' ? answers.days : null,
      place,
      equipment: Array.isArray(answers.equipment) ? answers.equipment.filter((item): item is string => typeof item === 'string') : [],
      style: Array.isArray(answers.style) ? answers.style.filter((item): item is string => typeof item === 'string') : [],
      muscleFocus: Array.isArray(answers.muscleFocus) ? answers.muscleFocus.filter((item): item is string => typeof item === 'string') : [],
      commitment: safeString(answers.commitment),
      limitationImpact: safeString(answers.limitationImpact),
      specialConditions: Array.isArray(answers.specialConditions) ? answers.specialConditions.filter((item): item is string => typeof item === 'string') : [],
      pregnancyScreening: Object.keys(pregnancyScreening).length ? {
        weeks: typeof pregnancyScreening.weeks === 'number' ? pregnancyScreening.weeks : null,
        prenatalCare: safeString(pregnancyScreening.prenatalCare),
        exerciseRestriction: safeString(pregnancyScreening.exerciseRestriction),
        complication: safeString(pregnancyScreening.complication),
        warningSigns: Array.isArray(pregnancyScreening.warningSigns) ? pregnancyScreening.warningSigns.filter((item): item is string => typeof item === 'string') : [],
      } : null,
      postpartumScreening: Object.keys(postpartumScreening).length ? {
        timeSinceBirth: safeString(postpartumScreening.timeSinceBirth),
        deliveryType: safeString(postpartumScreening.deliveryType),
        signs: Array.isArray(postpartumScreening.signs) ? postpartumScreening.signs.filter((item): item is string => typeof item === 'string') : [],
        returnClearance: safeString(postpartumScreening.returnClearance),
      } : null,
      functionalScreening: Object.keys(functionalScreening).length ? {
        situations: Array.isArray(functionalScreening.situations) ? functionalScreening.situations.filter((item): item is string => typeof item === 'string') : [],
      } : null,
      lipedemaScreening: Object.keys(lipedemaScreening).length ? {
        symptomImpact: safeString(lipedemaScreening.symptomImpact),
        professionalGuidance: safeString(lipedemaScreening.professionalGuidance),
      } : null,
      dizzinessScreening: Object.keys(dizzinessScreening).length ? {
        symptomFrequency: safeString(dizzinessScreening.symptomFrequency),
        affectsBalance: safeString(dizzinessScreening.affectsBalance),
      } : null,
      postSurgicalScreening: Object.keys(postSurgicalScreening).length ? {
        recoveryStatus: safeString(postSurgicalScreening.recoveryStatus),
        bodyRegion: safeString(postSurgicalScreening.bodyRegion),
        returnClearance: safeString(postSurgicalScreening.returnClearance),
      } : null,
      medicalRestrictionScreening: Object.keys(medicalRestrictionScreening).length ? {
        professionalExerciseRestriction: safeString(medicalRestrictionScreening.professionalExerciseRestriction),
      } : null,
    },
  };
}

function redemptionView(snapshot: DocumentSnapshot) {
  if (!snapshot.exists) return null;
  const document = snapshot.data() ?? {};
  const intent = objectMap(document.purchaseIntent);
  const origin = objectMap(document.subscriptionOrigin);
  return {
    couponCode: safeString(document.couponCode),
    campaignId: safeString(document.campaignId),
    influencerId: safeString(document.influencerId),
    appliedAt: isoDate(document.appliedAt),
    trialStartedAt: isoDate(document.trialStartedAt),
    convertedAt: isoDate(document.convertedAt),
    lockedAt: isoDate(document.lockedAt),
    purchaseIntent: Object.keys(intent).length ? {
      plan: safeString(intent.plan),
      status: safeString(intent.status),
      offeringIdentifier: safeString(intent.offeringIdentifier),
      expectedProductId: safeString(intent.expectedProductId),
      expiresAt: isoDate(intent.expiresAt),
      confirmedAt: isoDate(intent.confirmedAt),
    } : null,
    subscriptionOrigin: Object.keys(origin).length ? {
      transactionKey: safeString(origin.transactionKey),
      originalTransactionId: safeString(origin.originalTransactionId),
      transactionId: safeString(origin.transactionId),
      revenueCatEventId: safeString(origin.revenueCatEventId),
      store: safeString(origin.store),
      productId: safeString(origin.productId),
      confirmedAt: isoDate(origin.confirmedAt),
    } : null,
  };
}

export async function adminGetUserHandler(request: CallableRequest<DetailInput>) {
  const adminUid = await requireAdminUid(request);
  const uid = typeof request.data?.uid === 'string' ? request.data.uid.trim() : '';
  if (!uid || uid.length > 128 || uid.includes('/')) throw new HttpsError('invalid-argument', 'invalid_uid');

  try {
    const userRef = db.collection(USERS).doc(uid);
    const questionnaireQuery = userRef.collection('questionnaires').orderBy('createdAt', 'desc').limit(1);
    const [authResult, userSnapshot, questionnaireSnapshot, lockSnapshot, redemptionSnapshot, freeAccess] = await Promise.all([
      auth.getUser(uid).catch((error: unknown) => {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
        if (code === 'auth/user-not-found') return null;
        throw error;
      }),
      userRef.get(),
      questionnaireQuery.get(),
      db.collection('accountDeletionLocks').doc(uid).get(),
      db.collection('couponRedemptions').doc(uid).get(),
      readFreeAccessView(uid),
    ]);
    if (!authResult && !userSnapshot.exists) throw new HttpsError('not-found', 'user_not_found');

    const document = (userSnapshot.data() ?? {}) as UserDocument;
    const profile = objectMap(document.profile);
    const preferences = objectMap(document.preferences);
    const metadata = objectMap(document.metadata);
    const deletionId = lockSnapshot.exists ? safeString(lockSnapshot.get('activeDeletionId')) : null;
    const deletionSnapshot = deletionId
      ? await db.collection('accountDeletions').doc(deletionId).get()
      : null;
    const deletion = deletionSnapshot?.exists ? deletionSnapshot.data() ?? {} : null;

    logInfo(SCOPE, 'user detail read', { adminUid, targetUid: uid });
    return {
      uid,
      auth: authView(authResult),
      profile: {
        name: safeString(profile.name),
        email: safeString(profile.email),
        birthDate: isoDate(profile.birthDate),
        photoURL: safeString(profile.photoURL),
        height: typeof profile.height === 'number' ? profile.height : null,
      },
      preferences: {
        language: safeString(preferences.language),
        units: safeString(preferences.units),
        theme: safeString(preferences.theme),
      },
      metadata: {
        role: safeString(metadata.role),
        createdAt: isoDate(metadata.createdAt),
        updatedAt: isoDate(metadata.updatedAt),
        activeWorkoutId: safeString(metadata.activeWorkoutId),
        commercialGateResolvedAt: isoDate(metadata.commercialGateResolvedAt),
      },
      subscription: subscriptionView(document),
      revenueCat: { configuredAppUserId: uid, entitlementId: 'premium' },
      freeAccess,
      questionnaire: questionnaireView(questionnaireSnapshot.docs[0] ?? null),
      attribution: redemptionView(redemptionSnapshot),
      accountDeletion: deletion ? {
        deletionId,
        status: safeString(deletion.status),
        requestedAt: epochDate(deletion.requestedAt),
        updatedAt: epochDate(deletion.updatedAt),
        completedAt: epochDate(deletion.completedAt),
        workflowVersion: typeof deletion.workflowVersion === 'number' ? deletion.workflowVersion : null,
      } : null,
      availability: {
        lastActivity: false,
        lastWorkout: false,
        autoRenew: false,
        gracePeriodEnd: false,
        revenueCatOwnership: false,
        subscriptionHistory: false,
      },
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logFunctionError(SCOPE, error, { adminUid, operation: 'detail', targetUid: uid });
    throw new HttpsError('internal', 'admin_user_detail_failed');
  }
}
