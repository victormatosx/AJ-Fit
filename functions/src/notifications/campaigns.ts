import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { requireAdminUid } from '../attribution/adminAuth';
import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError } from '../lib/logger';
import { dispatchNotification, defaultDependencies, type DispatcherDependencies } from './dispatcher';
import { dispatchIdFor } from './idempotency';
import { assertValidDispatchRequest, NotificationContentPolicyError } from './contentPolicy';
import { NotificationIdempotencyConflictError } from './idempotency';
import { resolveQaPreviewNotificationPolicy } from './preferences';
import type { NotificationDispatchRequest } from './schema';

const ROOT = 'notificationCampaigns';
const RETENTION_MS = 90 * 86400000;
const MAX_EXPLICIT_UIDS = 3000;
const MAX_UID_BYTES = 300000;
const DESTINATIONS = ['home', 'workout', 'progress', 'profile'] as const;
const LOCALES = ['pt-BR', 'en', 'es'] as const;
const SUBSCRIPTIONS = ['ACTIVE', 'TRIAL', 'EXPIRED', 'CANCELED', 'BILLING_ISSUE'] as const;
const STATUSES = ['draft', 'scheduled', 'active', 'paused', 'completed', 'canceled'] as const;
type Destination = typeof DESTINATIONS[number];
type Locale = typeof LOCALES[number];
type Status = typeof STATUSES[number];
type Audience = { kind: 'all' | 'language' | 'subscription' | 'uids'; language?: Locale; subscriptionStatus?: string; uids?: string[] };
type Schedule = { kind: 'once' | 'daily' | 'weekly'; startAt: string; timezone: string; localTime?: string; weekdays?: number[]; windowMinutes?: number; endAt?: string; maxOccurrences?: number };
type Content = { 'pt-BR'?: { title: string; body: string }; en?: { title: string; body: string }; es?: { title: string; body: string }; imageUrl?: string; destination?: Destination };
type Definition = { name?: string; content?: Content; audience?: Audience; schedule?: Schedule };

function invalid(reason: string): never { throw new HttpsError('invalid-argument', reason); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function validId(value: unknown): value is string { return typeof value === 'string' && value !== '.' && value !== '..' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
function utcInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function localParts(ms: number, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(ms).map(({ type, value }) => [type, value]));
}
export function parseDefinition(value: unknown, complete: boolean): Definition {
  const raw = record(value);
  if (Object.keys(raw).some((key) => !['name', 'content', 'audience', 'schedule'].includes(key))) invalid('campaign_unknown_field');
  const name = raw.name;
  if (name !== undefined && (typeof name !== 'string' || name.trim().length > 120 || !name.trim())) invalid('campaign_name_invalid');
  if (complete && !name) invalid('campaign_name_required');
  const contentRaw = record(raw.content);
  if (Object.keys(contentRaw).some((key) => ![...LOCALES, 'imageUrl', 'destination'].includes(key))) invalid('campaign_content_field_invalid');
  const content: Content = {};
  for (const locale of LOCALES) {
    if (contentRaw[locale] === undefined) continue;
    const copy = record(contentRaw[locale]);
    if (Object.keys(copy).some((key) => !['title', 'body'].includes(key)) ||
      typeof copy.title !== 'string' || !copy.title.trim() || copy.title.length > 120 ||
      typeof copy.body !== 'string' || !copy.body.trim() || copy.body.length > 240) invalid('campaign_copy_invalid');
    content[locale] = { title: copy.title, body: copy.body };
  }
  if (contentRaw.imageUrl !== undefined) {
    if (typeof contentRaw.imageUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(contentRaw.imageUrl) || contentRaw.imageUrl.length > 500) invalid('campaign_image_invalid');
    content.imageUrl = contentRaw.imageUrl;
  }
  if (contentRaw.destination !== undefined) {
    if (!DESTINATIONS.includes(contentRaw.destination as Destination)) invalid('campaign_destination_invalid');
    content.destination = contentRaw.destination as Destination;
  }
  if (complete && (!content['pt-BR'] || !content.destination)) invalid('campaign_content_required');
  const audienceRaw = record(raw.audience);
  let audience: Audience | undefined;
  if (raw.audience !== undefined) {
    if (!['all', 'language', 'subscription', 'uids'].includes(String(audienceRaw.kind))) invalid('campaign_audience_invalid');
    if (Object.keys(audienceRaw).some((key) => !['kind', 'language', 'subscriptionStatus', 'uids'].includes(key))) invalid('campaign_audience_field_invalid');
    audience = { kind: audienceRaw.kind as Audience['kind'] };
    if (audience.kind === 'language') {
      if (!LOCALES.includes(audienceRaw.language as Locale)) invalid('campaign_language_invalid');
      audience.language = audienceRaw.language as Locale;
    } else if (audience.kind === 'subscription') {
      if (!SUBSCRIPTIONS.includes(audienceRaw.subscriptionStatus as typeof SUBSCRIPTIONS[number])) invalid('campaign_subscription_invalid');
      audience.subscriptionStatus = audienceRaw.subscriptionStatus as string;
    } else if (audience.kind === 'uids') {
      if (!Array.isArray(audienceRaw.uids) || audienceRaw.uids.length < 1 || audienceRaw.uids.length > MAX_EXPLICIT_UIDS || !audienceRaw.uids.every(validId)
        || Buffer.byteLength((audienceRaw.uids as string[]).join(''), 'utf8') > MAX_UID_BYTES) invalid('campaign_uids_invalid');
      audience.uids = [...new Set(audienceRaw.uids)].sort();
    }
  }
  if (complete && !audience) invalid('campaign_audience_required');
  const scheduleRaw = record(raw.schedule);
  let schedule: Schedule | undefined;
  if (raw.schedule !== undefined) {
    if (Object.keys(scheduleRaw).some((key) => !['kind', 'startAt', 'timezone', 'localTime', 'weekdays', 'windowMinutes', 'endAt', 'maxOccurrences'].includes(key))) invalid('campaign_schedule_field_invalid');
    if (!['once', 'daily', 'weekly'].includes(String(scheduleRaw.kind)) || !utcInstant(scheduleRaw.startAt)) invalid('campaign_schedule_invalid');
    if (typeof scheduleRaw.timezone !== 'string') invalid('campaign_timezone_invalid');
    try { new Intl.DateTimeFormat('en', { timeZone: scheduleRaw.timezone }).format(new Date()); } catch { invalid('campaign_timezone_invalid'); }
    schedule = { kind: scheduleRaw.kind as Schedule['kind'], startAt: scheduleRaw.startAt, timezone: scheduleRaw.timezone };
    if (scheduleRaw.windowMinutes !== undefined) {
      if (!Number.isInteger(scheduleRaw.windowMinutes) || (scheduleRaw.windowMinutes as number) < 0 || (scheduleRaw.windowMinutes as number) > 1440) invalid('campaign_window_invalid');
      schedule.windowMinutes = scheduleRaw.windowMinutes as number;
    }
    if (schedule.kind !== 'once') {
      if (typeof scheduleRaw.localTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleRaw.localTime)) invalid('campaign_time_invalid');
      schedule.localTime = scheduleRaw.localTime;
      const parts = localParts(Date.parse(schedule.startAt), schedule.timezone);
      if (`${parts.hour}:${parts.minute}` !== schedule.localTime) invalid('campaign_time_mismatch');
      if (schedule.kind === 'weekly') {
        if (!Array.isArray(scheduleRaw.weekdays) || scheduleRaw.weekdays.length === 0 || !scheduleRaw.weekdays.every((day: unknown) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)) invalid('campaign_weekdays_invalid');
        schedule.weekdays = [...new Set(scheduleRaw.weekdays as number[])].sort();
      }
    }
    if (scheduleRaw.endAt !== undefined) {
      if (!utcInstant(scheduleRaw.endAt) || Date.parse(scheduleRaw.endAt) < Date.parse(schedule.startAt)) invalid('campaign_end_invalid');
      schedule.endAt = scheduleRaw.endAt;
    }
    if (scheduleRaw.maxOccurrences !== undefined) {
      if (!Number.isInteger(scheduleRaw.maxOccurrences) || (scheduleRaw.maxOccurrences as number) < 1 || (scheduleRaw.maxOccurrences as number) > 366) invalid('campaign_occurrences_invalid');
      schedule.maxOccurrences = scheduleRaw.maxOccurrences as number;
    }
  }
  if (complete && !schedule) invalid('campaign_schedule_required');
  if (complete) {
    try {
      for (const locale of LOCALES) {
        if (content[locale]) assertValidDispatchRequest(dispatchRequest('validation', 'validation.1', 'validation', content, locale));
      }
    } catch (error) {
      if (error instanceof NotificationContentPolicyError) invalid(`campaign_content_${error.reason}`);
      throw error;
    }
  }
  return { ...(name ? { name: (name as string).trim() } : {}), ...(raw.content !== undefined ? { content } : {}), ...(audience ? { audience } : {}), ...(schedule ? { schedule } : {}) };
}
function storedDefinition(value: FirebaseFirestore.DocumentData | undefined, complete: boolean): Definition {
  return parseDefinition({ name: value?.name, content: value?.content, audience: value?.audience, schedule: value?.schedule }, complete);
}

export function nextOccurrence(schedule: Schedule, afterMs: number): number | null {
  const start = Date.parse(schedule.startAt);
  if (schedule.kind === 'once') return start > afterMs ? start : null;
  const lower = Math.max(start, afterMs + 60000);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const previous = Object.fromEntries(formatter.formatToParts(afterMs).map((p) => [p.type, p.value]));
  const previousDay = `${previous.year}-${previous.month}-${previous.day}`;
  const previousTime = `${previous.hour}:${previous.minute}`;
  for (let ms = Math.ceil(lower / 60000) * 60000; ms < lower + 8 * 86400000; ms += 60000) {
    if (schedule.endAt && ms > Date.parse(schedule.endAt)) return null;
    const parts = Object.fromEntries(formatter.formatToParts(ms).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === previousDay && previousTime >= schedule.localTime!) continue;
    if (`${parts.hour}:${parts.minute}` === schedule.localTime && (schedule.kind === 'daily' || schedule.weekdays?.includes(weekdays.indexOf(parts.weekday)))) return ms;
  }
  return null;
}

function audienceQuery(db: Firestore, audience: Audience): Query {
  let query: Query = db.collection('users');
  if (audience.kind === 'language') query = query.where('preferences.language', '==', audience.language);
  if (audience.kind === 'subscription') query = query.where('subscription.status', '==', audience.subscriptionStatus);
  return query.orderBy(FieldPath.documentId());
}
async function estimate(db: Firestore, audience: Audience): Promise<number> {
  if (audience.kind === 'uids') {
    let count = 0;
    for (let i = 0; i < audience.uids!.length; i += 100) {
      const docs = await db.getAll(...audience.uids!.slice(i, i + 100).map((uid) => db.collection('users').doc(uid)));
      count += docs.filter((doc) => doc.exists).length;
    }
    return count;
  }
  return (await audienceQuery(db, audience).count().get()).data().count;
}
function campaignRef(db: Firestore, id: string) { return db.collection(ROOT).doc(id); }
function campaignData(data: FirebaseFirestore.DocumentData | undefined) {
  const value = data ?? {};
  return { ...value, nextRunAt: value.nextRunAt?.toMillis?.() ?? null, lastRunAt: value.lastRunAt?.toMillis?.() ?? null, createdAt: value.createdAt?.toMillis?.() ?? null, updatedAt: value.updatedAt?.toMillis?.() ?? null, scheduledAt: value.scheduledAt?.toMillis?.() ?? null, startedAt: value.startedAt?.toMillis?.() ?? null, completedAt: value.completedAt?.toMillis?.() ?? null };
}
function requireId(value: unknown): string { if (!validId(value)) invalid('campaign_id_invalid'); return value; }

export async function adminSaveCampaignHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  const uid = await requireAdminUid(request);
  const input = record(request.data);
  const definition = parseDefinition(input.definition, false);
  const now = Timestamp.now();
  if (!input.id) {
    const ref = db.collection(ROOT).doc();
    await ref.create({ ...definition, status: 'draft', version: 1, createdBy: uid, createdAt: now, updatedBy: uid, updatedAt: now, nextRunAt: null, occurrenceCount: 0 });
    return { id: ref.id, version: 1 };
  }
  const id = requireId(input.id);
  if (!Number.isInteger(input.version)) invalid('campaign_version_required');
  return db.runTransaction(async (tx) => {
    const ref = campaignRef(db, id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'campaign_not_found');
    const current = snap.data()!;
    if (current.version !== input.version) throw new HttpsError('aborted', 'campaign_version_conflict');
    if (current.status !== 'draft' && current.status !== 'paused') throw new HttpsError('failed-precondition', 'campaign_not_editable');
    const nextDefinition = current.status === 'paused' ? parseDefinition(input.definition, true) : definition;
    tx.update(ref, { ...nextDefinition, version: current.version + 1, updatedBy: uid, updatedAt: now });
    return { id, version: current.version + 1 };
  });
}

export async function adminEstimateCampaignHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  await requireAdminUid(request);
  const audience = parseDefinition({ audience: record(request.data).audience }, false).audience;
  if (!audience) invalid('campaign_audience_required');
  return { estimatedUsers: await estimate(db, audience), basis: 'segment_users_before_push_eligibility' };
}

export async function adminScheduleCampaignHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  const uid = await requireAdminUid(request);
  const input = record(request.data);
  const id = requireId(input.id);
  if (!Number.isInteger(input.version) || input.confirmed !== true) invalid('campaign_confirmation_required');
  const ref = campaignRef(db, id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'campaign_not_found');
  const definition = storedDefinition(snap.data(), true);
  const estimatedUsers = await estimate(db, definition.audience!);
  if (estimatedUsers >= 1000 && input.confirmedReach !== estimatedUsers) throw new HttpsError('failed-precondition', 'campaign_reach_confirmation_stale');
  const now = Timestamp.now();
  const next = nextOccurrence(definition.schedule!, now.toMillis() - 60000);
  if (!next) throw new HttpsError('failed-precondition', 'campaign_schedule_elapsed');
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const current = fresh.data();
    if (!current || current.version !== input.version) throw new HttpsError('aborted', 'campaign_version_conflict');
    if (current.status !== 'draft' && current.status !== 'paused') throw new HttpsError('failed-precondition', 'campaign_not_schedulable');
    tx.update(ref, { status: 'scheduled', version: current.version + 1, nextRunAt: Timestamp.fromMillis(next), estimatedUsers, scheduledBy: uid, scheduledAt: now, updatedBy: uid, updatedAt: now });
    return { id, version: current.version + 1, estimatedUsers, nextRunAt: next };
  });
}

export async function adminCampaignActionHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  const uid = await requireAdminUid(request);
  const input = record(request.data);
  const id = requireId(input.id);
  if (!Number.isInteger(input.version) || !['pause', 'resume', 'cancel'].includes(String(input.action))) invalid('campaign_action_invalid');
  const now = Timestamp.now();
  return db.runTransaction(async (tx) => {
    const ref = campaignRef(db, id);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) throw new HttpsError('not-found', 'campaign_not_found');
    if (current.version !== input.version) throw new HttpsError('aborted', 'campaign_version_conflict');
    const action = input.action as string;
    if (action === 'pause' && !['scheduled', 'active'].includes(current.status)) throw new HttpsError('failed-precondition', 'campaign_not_pausable');
    if (action === 'resume' && current.status !== 'paused') throw new HttpsError('failed-precondition', 'campaign_not_paused');
    if (action === 'cancel' && !['scheduled', 'active', 'paused', 'draft'].includes(current.status)) throw new HttpsError('failed-precondition', 'campaign_not_cancelable');
    const schedule = current.schedule as Schedule | undefined;
    const next = action === 'resume' && schedule ? nextOccurrence(schedule, now.toMillis()) : null;
    const status: Status = action === 'pause' ? 'paused' : action === 'cancel' ? 'canceled' : next ? 'scheduled' : Number(current.occurrenceCount ?? 0) > 0 ? 'active' : 'completed';
    tx.update(ref, { status, version: current.version + 1, updatedBy: uid, updatedAt: now, [`${action}By`]: uid, [`${action}At`]: now, ...(action === 'cancel' ? { nextRunAt: null } : {}), ...(action === 'resume' ? { nextRunAt: next ? Timestamp.fromMillis(next) : null } : {}) });
    return { id, status, version: current.version + 1 };
  });
}

export async function adminDuplicateCampaignHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  const uid = await requireAdminUid(request);
  const source = await campaignRef(db, requireId(record(request.data).id)).get();
  if (!source.exists) throw new HttpsError('not-found', 'campaign_not_found');
  const definition = storedDefinition(source.data(), false);
  const ref = db.collection(ROOT).doc();
  const now = Timestamp.now();
  await ref.create({ ...definition, name: `${definition.name ?? 'Campanha'} — cópia`, status: 'draft', version: 1, createdBy: uid, createdAt: now, updatedBy: uid, updatedAt: now, duplicatedFrom: source.id, nextRunAt: null, occurrenceCount: 0 });
  return { id: ref.id, version: 1 };
}

export async function adminListCampaignsHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  await requireAdminUid(request);
  const input = record(request.data);
  const size = Math.min(50, Math.max(1, Number(input.pageSize) || 20));
  let query = db.collection(ROOT).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(size);
  const cursor = record(input.cursor);
  if (Number.isFinite(cursor.createdAt) && validId(cursor.id)) query = query.startAfter(Timestamp.fromMillis(cursor.createdAt as number), cursor.id);
  const snap = await query.get();
  return { campaigns: snap.docs.map((doc) => ({ id: doc.id, ...campaignData(doc.data()) })), nextCursor: snap.size === size ? { createdAt: snap.docs.at(-1)!.get('createdAt').toMillis(), id: snap.docs.at(-1)!.id } : null };
}

export async function adminGetCampaignHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  await requireAdminUid(request);
  const input = record(request.data);
  const id = requireId(input.id);
  const ref = campaignRef(db, id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'campaign_not_found');
  let query = ref.collection('runs').orderBy('scheduledAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(20);
  const cursor = record(input.cursor);
  if (Number.isFinite(cursor.scheduledAt) && validId(cursor.id)) query = query.startAfter(Timestamp.fromMillis(cursor.scheduledAt as number), cursor.id);
  const runs = await query.get();
  return { campaign: { id, ...campaignData(snap.data()) }, runs: runs.docs.map((run) => ({ id: run.id, ...campaignData(run.data()) })), nextRunsCursor: runs.size === 20 ? { scheduledAt: runs.docs.at(-1)!.get('scheduledAt').toMillis(), id: runs.docs.at(-1)!.id } : null };
}

export async function adminGetCampaignRunHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  await requireAdminUid(request);
  const input = record(request.data);
  const campaignId = requireId(input.campaignId);
  const runId = requireId(input.runId);
  const run = await campaignRef(db, campaignId).collection('runs').doc(runId).get();
  if (!run.exists) throw new HttpsError('not-found', 'run_not_found');
  const recipients = run.ref.collection('recipients');
  const dispatchStatusNames = ['CLAIMED', 'RETRY_SCHEDULED', 'PENDING_RECEIPTS', 'CONFIRMED', 'PARTIAL', 'FAILED_TERMINAL', 'FAILED_RETRY_EXHAUSTED', 'RECEIPT_EXHAUSTED', 'NO_ELIGIBLE_DEVICE', 'SUPPRESSED_BY_PREFERENCE', 'SUPPRESSED_BY_POLICY'];
  const [segmented, pending, claimed, permanentFailures, opened, dispatches, attempted, accepted, confirmed, ...dispatchCounts] = await Promise.all([
    recipients.count().get(),
    recipients.where('state', '==', 'PENDING').count().get(),
    recipients.where('state', '==', 'CLAIMED').count().get(),
    recipients.where('state', '==', 'FAILED_PERMANENT').count().get(),
    recipients.where('openedAt', '>', Timestamp.fromMillis(0)).count().get(),
    db.collection('notificationDispatches').where('campaignRunId', '==', runId).count().get(),
    db.collection('notificationDispatches').where('campaignRunId', '==', runId).where('deviceCount', '>', 0).count().get(),
    db.collection('notificationDispatches').where('campaignRunId', '==', runId).where('everAccepted', '==', true).count().get(),
    db.collection('notificationDispatches').where('campaignRunId', '==', runId).where('confirmedCount', '>', 0).count().get(),
    ...dispatchStatusNames.map((status) => db.collection('notificationDispatches').where('campaignRunId', '==', runId).where('status', '==', status).count().get()),
  ]);
  const statuses: Record<string, number> = {};
  dispatchStatusNames.forEach((status, index) => { statuses[status] = dispatchCounts[index]!.data().count; });
  // Segment users are not push-eligible users. Attempted means a persisted
  // provider attempt with at least one selected device; everAccepted is a
  // historical Expo ticket, while a receipt confirms FCM/APNs acceptance only.
  const failedDispatches = (statuses.FAILED_TERMINAL ?? 0) + (statuses.FAILED_RETRY_EXHAUSTED ?? 0) + (statuses.PARTIAL ?? 0);
  return { run: { id: runId, ...campaignData(run.data()) }, metrics: {
    segmentUsers: segmented.data().count,
    remainingRecipients: pending.data().count + claimed.data().count,
    dispatchesCreated: dispatches.data().count,
    attemptedUsers: attempted.data().count,
    acceptedUsers: accepted.data().count,
    receiptConfirmedUsers: confirmed.data().count,
    failedDispatches,
    permanentRecipientErrors: permanentFailures.data().count,
    receiptUnconfirmedUsers: statuses.RECEIPT_EXHAUSTED ?? 0,
    openedUsers: opened.data().count,
    dispatchStatuses: statuses,
  } };
}

function copyFor(content: Content, language: unknown) { return content[LOCALES.includes(language as Locale) ? language as Locale : 'pt-BR'] ?? content['pt-BR']!; }
function dispatchRequest(campaignId: string, runId: string, uid: string, content: Content, language: unknown, preview = false): NotificationDispatchRequest {
  const key = `campaign:${campaignId}:${runId}:${uid}`;
  return { uid, notificationId: `CAMPAIGN:${runId}`, type: 'CAMPAIGN', category: 'WORKOUTS_AND_REMINDERS', sourceIdentity: `campaign:${runId}`, idempotencyKey: preview ? `preview:${key}` : key, intent: 'campaign', ...copyFor(content, language), ...(content.imageUrl ? { imageUrl: content.imageUrl } : {}), data: { campaignId, campaignRunId: runId, destination: content.destination!, recipientUid: uid } };
}

export async function adminTestCampaignHandler(request: CallableRequest<unknown>, dependencies: DispatcherDependencies = defaultDependencies()) {
  const uid = await requireAdminUid(request);
  const input = record(request.data);
  const definition = input.id ? storedDefinition((await campaignRef(dependencies.db, requireId(input.id)).get()).data(), false) : parseDefinition(input.definition, false);
  if (!definition.content?.['pt-BR'] || !definition.content.destination) invalid('campaign_content_required');
  const policy = await resolveQaPreviewNotificationPolicy(uid, dependencies.db);
  if (!policy.allowed) throw new HttpsError('failed-precondition', 'campaign_test_account_inactive');
  const requestId = typeof input.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(input.requestId) ? input.requestId : randomUUID();
  return dispatchNotification(dispatchRequest(input.id ? requireId(input.id) : 'draft', `test.${requestId}`, uid, definition.content, policy.locale, true), dependencies, 'QA_PREVIEW');
}

export async function recordCampaignOpenHandler(request: CallableRequest<unknown>, db: Firestore = defaultDb) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'authentication_required');
  const uid = request.auth.uid;
  const input = record(request.data);
  const campaignId = requireId(input.campaignId);
  const runId = requireId(input.campaignRunId);
  const recipient = campaignRef(db, campaignId).collection('runs').doc(runId).collection('recipients').doc(uid);
  const now = Timestamp.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(recipient);
    if (!snap.exists) throw new HttpsError('not-found', 'campaign_recipient_not_found');
    if (snap.get('openedAt')) return { recorded: false };
    const dispatchId = dispatchIdFor(`campaign:${campaignId}:${runId}:${uid}`);
    const dispatch = await tx.get(db.collection('notificationDispatches').doc(dispatchId));
    if (!dispatch.exists || dispatch.get('uid') !== uid || (dispatch.get('everAccepted') !== true && Number(dispatch.get('acceptedCount') ?? 0) < 1)) throw new HttpsError('failed-precondition', 'campaign_open_not_delivered');
    tx.update(recipient, { openedAt: now, dispatchId });
    return { recorded: true, campaignId, campaignRunId: runId, dispatchId };
  });
}

export function spreadDueAt(runId: string, uid: string, startMs: number, windowMinutes: number): Timestamp {
  const hash = createHash('sha256').update(`${runId}:${uid}`).digest();
  const fraction = hash.readUInt32BE(0) / 0x100000000;
  return Timestamp.fromMillis(startMs + Math.floor(fraction * windowMinutes * 60000));
}

async function materializeDue(db: Firestore, now: Timestamp) {
  const cursorRef = db.collection('notificationCampaignScheduler').doc('materializeCursor');
  const cursor = await cursorRef.get();
  const lastAt = cursor.get('nextRunAt') as Timestamp | undefined;
  const lastId = cursor.get('id') as string | undefined;
  const base = db.collection(ROOT).where('status', '==', 'scheduled').where('nextRunAt', '<=', now)
    .orderBy('nextRunAt').orderBy(FieldPath.documentId());
  let campaigns = lastAt && lastId
    ? await base.startAfter(lastAt, lastId).limit(20).get()
    : await base.limit(20).get();
  if (campaigns.empty && lastAt) campaigns = await base.limit(20).get();
  for (const doc of campaigns.docs) {
    try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data();
      if (data?.status !== 'scheduled' || !data.nextRunAt || data.nextRunAt.toMillis() > now.toMillis()) return;
      const scheduledMs = data.nextRunAt.toMillis();
      const runId = `${doc.id}.${scheduledMs}`;
      const runRef = doc.ref.collection('runs').doc(runId);
      const existing = await tx.get(runRef);
      if (existing.exists) return;
      const definition = storedDefinition(data, true);
      const count = Number(data.occurrenceCount ?? 0) + 1;
      const next = definition.schedule?.maxOccurrences && count >= definition.schedule.maxOccurrences ? null : nextOccurrence(definition.schedule!, scheduledMs);
      tx.create(runRef, { campaignId: doc.id, content: definition.content, audience: definition.audience, schedule: definition.schedule, scheduledAt: Timestamp.fromMillis(scheduledMs), status: 'fanout', cursor: null, eligibleCount: 0, startedAt: now, completedAt: null, expireAt: Timestamp.fromMillis(now.toMillis() + RETENTION_MS) });
      tx.update(doc.ref, { status: next ? 'scheduled' : 'active', nextRunAt: next ? Timestamp.fromMillis(next) : null, lastRunAt: Timestamp.fromMillis(scheduledMs), occurrenceCount: count, updatedAt: now, version: Number(data.version ?? 0) + 1 });
    });
    } catch (error) {
      logFunctionError('notifications.campaigns', error, { phase: 'materialize', campaignId: doc.id });
    }
  }
  const last = campaigns.docs.at(-1);
  if (last) await db.runTransaction(async (tx) => {
    const current = await tx.get(cursorRef);
    if ((current.get('nextRunAt')?.toMillis?.() ?? null) !== (lastAt?.toMillis() ?? null)
      || (current.get('id') ?? null) !== (lastId ?? null)) return;
    tx.set(cursorRef, { nextRunAt: last.get('nextRunAt'), id: last.id });
  });
}

async function fanoutRun(db: Firestore, run: FirebaseFirestore.QueryDocumentSnapshot, now: Timestamp) {
  const lease = randomUUID();
  const locked = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(run.ref);
    const value = fresh.data();
    if (value?.status !== 'fanout' || (value.fanoutLeaseUntil && value.fanoutLeaseUntil.toMillis() > now.toMillis())) return null;
    tx.update(run.ref, { fanoutLease: lease, fanoutLeaseUntil: Timestamp.fromMillis(now.toMillis() + 5 * 60000) });
    return value;
  });
  if (!locked) return;
  const data = locked;
  const campaign = await campaignRef(db, data.campaignId).get();
  if (campaign.get('status') === 'canceled' || campaign.get('status') === 'paused') {
    await run.ref.update({ status: campaign.get('status') === 'paused' ? 'paused_fanout' : 'canceled', fanoutLease: null, fanoutLeaseUntil: null });
    return;
  }
  const audience = data.audience as Audience;
  const cursor = data.cursor as string | null;
  let users: { id: string; data(): FirebaseFirestore.DocumentData | undefined }[];
  let hasMore = false;
  let last: string | undefined;
  if (audience.kind === 'uids') {
    const remaining = audience.uids!.filter((uid) => !cursor || uid > cursor).slice(0, 251);
    hasMore = remaining.length > 250;
    last = remaining[Math.min(remaining.length, 250) - 1];
    users = await db.getAll(...remaining.slice(0, 250).map((uid) => db.collection('users').doc(uid))).then((docs) => docs.filter((doc) => doc.exists));
    if (!users.length && remaining.length) {
      await run.ref.update({ cursor: last, fanoutLease: null, fanoutLeaseUntil: null, ...(hasMore ? {} : { status: 'ready', fanoutCompletedAt: now }) });
      return;
    }
  } else {
    let query = audienceQuery(db, audience);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.limit(251).get();
    hasMore = page.size > 250;
    users = page.docs.slice(0, 250);
    last = users.at(-1)?.id;
  }
  if (!users.length) { await run.ref.update({ status: 'ready', fanoutCompletedAt: now, fanoutLease: null, fanoutLeaseUntil: null }); return; }
  const refs = users.map((user) => run.ref.collection('recipients').doc(user.id));
  const existing = await db.getAll(...refs);
  const batch = db.batch();
  const scheduledMs = data.scheduledAt.toMillis();
  let created = 0;
  for (let i = 0; i < users.length; i++) {
    if (existing[i]!.exists) continue;
    const user = users[i]!;
    batch.create(refs[i]!, { uid: user.id, campaignId: data.campaignId, campaignRunId: run.id, language: user.data()?.preferences?.language ?? 'pt-BR', state: 'PENDING', dueAt: spreadDueAt(run.id, user.id, scheduledMs, data.schedule?.windowMinutes ?? 0), dispatchId: null, openedAt: null, expireAt: Timestamp.fromMillis(now.toMillis() + RETENTION_MS) });
    created++;
  }
  if (created) await batch.commit();
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(run.ref);
    if (fresh.get('fanoutLease') !== lease) return;
    tx.update(run.ref, { cursor: last, eligibleCount: Number(fresh.get('eligibleCount') ?? 0) + created, fanoutLease: null, fanoutLeaseUntil: null, ...(hasMore ? {} : { status: 'ready', fanoutCompletedAt: now }) });
  });
}

type CampaignDependencies = DispatcherDependencies & { afterCampaignDispatch?: () => Promise<void> };

async function processRecipient(db: Firestore, recipient: FirebaseFirestore.QueryDocumentSnapshot, dependencies: CampaignDependencies, now: Timestamp) {
  const data = recipient.data();
  const runRef = campaignRef(db, data.campaignId).collection('runs').doc(data.campaignRunId);
  const token = randomUUID();
  const claimed = await db.runTransaction(async (tx) => {
    const [fresh, campaign] = await Promise.all([tx.get(recipient.ref), tx.get(campaignRef(db, data.campaignId))]);
    const state = fresh.data();
    if (!state || (state.state !== 'PENDING' && !(state.state === 'CLAIMED' && state.leaseUntil?.toMillis?.() < now.toMillis()))) return false;
    if (campaign.get('status') === 'canceled' || campaign.get('status') === 'paused') return false;
    tx.update(recipient.ref, { state: 'CLAIMED', claimToken: token, leaseUntil: Timestamp.fromMillis(now.toMillis() + 10 * 60000) });
    return true;
  });
  if (!claimed) return;
  try {
    const run = await runRef.get();
    const currentCampaign = await campaignRef(db, data.campaignId).get();
    if (currentCampaign.get('status') === 'canceled' || currentCampaign.get('status') === 'paused') {
      await recipient.ref.update({ state: 'PENDING', claimToken: null, leaseUntil: null });
      return;
    }
    const request = dispatchRequest(data.campaignId, data.campaignRunId, recipient.id, run.get('content') as Content, data.language);
    const outcome = await dispatchNotification(request, dependencies);
    await dependencies.afterCampaignDispatch?.();
    // A recipient is only a resumable work marker. The dispatch is authoritative,
    // including when this invocation died after persisting the dispatch outcome.
    const authoritative = outcome.status === 'DUPLICATE'
      ? await db.collection('notificationDispatches').doc(outcome.dispatchId).get()
      : null;
    const waitingOnClaim = outcome.status === 'DUPLICATE'
      && (!authoritative?.exists || authoritative.get('status') === 'CLAIMED');
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(recipient.ref);
      if (fresh.get('claimToken') !== token) return;
      tx.update(recipient.ref, { state: waitingOnClaim ? 'PENDING' : 'PROCESSED', dueAt: waitingOnClaim ? Timestamp.fromMillis(now.toMillis() + 10 * 60000) : fresh.get('dueAt'), dispatchId: outcome.dispatchId, processedAt: waitingOnClaim ? null : Timestamp.now(), claimToken: null, leaseUntil: null });
    });
  } catch (error) {
    const permanent = error instanceof NotificationContentPolicyError || error instanceof NotificationIdempotencyConflictError;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(recipient.ref);
      if (fresh.get('claimToken') === token) tx.update(recipient.ref, {
        state: permanent ? 'FAILED_PERMANENT' : 'PENDING',
        errorCode: permanent ? (error instanceof NotificationContentPolicyError ? error.reason : 'IDEMPOTENCY_CONFLICT') : null,
        dueAt: permanent ? fresh.get('dueAt') : Timestamp.fromMillis(now.toMillis() + 5 * 60000),
        processedAt: permanent ? Timestamp.now() : null,
        claimToken: null, leaseUntil: null,
      });
    });
  }
}

async function runPage(db: Firestore, phase: string, statuses: string[], size: number) {
  const cursorRef = db.collection('notificationCampaignScheduler').doc('workCursors');
  const cursor = (await cursorRef.get()).get(phase) as { scheduledAt?: Timestamp; path?: string } | undefined;
  const base = db.collectionGroup('runs').where('status', 'in', statuses)
    .orderBy('scheduledAt').orderBy(FieldPath.documentId());
  let page = cursor?.scheduledAt && cursor.path
    ? await base.startAfter(cursor.scheduledAt, db.doc(cursor.path)).limit(size).get()
    : await base.limit(size).get();
  if (page.empty && cursor) page = await base.limit(size).get();
  return {
    docs: page.docs,
    advance: async (last = page.docs.at(-1)) => {
      if (last) await db.runTransaction(async (tx) => {
        const current = (await tx.get(cursorRef)).get(phase) as typeof cursor;
        if ((current?.scheduledAt?.toMillis() ?? null) !== (cursor?.scheduledAt?.toMillis() ?? null)
          || (current?.path ?? null) !== (cursor?.path ?? null)) return;
        tx.set(cursorRef, { [phase]: { scheduledAt: last.get('scheduledAt'), path: last.ref.path } }, { merge: true });
      });
    },
  };
}

async function reconcileCampaignCompletion(db: Firestore, now: Timestamp) {
  const cursorRef = db.collection('notificationCampaignScheduler').doc('completionCursor');
  const cursor = (await cursorRef.get()).get('id') as string | undefined;
  const base = db.collection(ROOT).where('status', '==', 'active').where('nextRunAt', '==', null)
    .orderBy(FieldPath.documentId());
  let page = cursor ? await base.startAfter(cursor).limit(50).get() : await base.limit(50).get();
  if (page.empty && cursor) page = await base.limit(50).get();
  for (const campaign of page.docs) {
    try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(campaign.ref);
      if (fresh.get('status') !== 'active' || fresh.get('nextRunAt')) return;
      const open = await tx.get(campaign.ref.collection('runs')
        .where('status', 'in', ['fanout', 'ready', 'paused_fanout', 'paused_ready']).limit(1));
      if (open.empty) tx.update(campaign.ref, {
        status: 'completed', updatedAt: now, version: Number(fresh.get('version') ?? 0) + 1,
      });
    });
    } catch (error) {
      logFunctionError('notifications.campaigns', error, { phase: 'campaign_completion', campaignId: campaign.id });
    }
  }
  const last = page.docs.at(-1);
  if (last) await db.runTransaction(async (tx) => {
    const current = await tx.get(cursorRef);
    if ((current.get('id') ?? null) !== (cursor ?? null)) return;
    tx.set(cursorRef, { id: last.id }, { merge: true });
  });
}

export async function runCampaignScheduler(dependencies: CampaignDependencies = defaultDependencies()) {
  const db = dependencies.db;
  const now = dependencies.now();
  await materializeDue(db, now);
  const suspended = await runPage(db, 'suspended', ['paused_fanout', 'paused_ready'], 100);
  for (const run of suspended.docs) {
    try {
    const parent = await campaignRef(db, run.get('campaignId')).get();
    if (parent.get('status') === 'canceled') await run.ref.update({ status: 'canceled', completedAt: now });
    else if (parent.get('status') !== 'paused') await run.ref.update({ status: run.get('status') === 'paused_fanout' ? 'fanout' : 'ready' });
    } catch (error) {
      logFunctionError('notifications.campaigns', error, { phase: 'restore', runId: run.id });
    }
  }
  await suspended.advance();
  const runs = await runPage(db, 'fanout', ['fanout'], 50);
  for (const run of runs.docs) {
    try {
    for (let page = 0; page < 2; page++) {
      await fanoutRun(db, run, now);
      if ((await run.ref.get()).get('status') !== 'fanout') break;
    }
    } catch (error) {
      logFunctionError('notifications.campaigns', error, { phase: 'fanout', runId: run.id });
    }
  }
  await runs.advance();
  let attempted = 0;
  const activeRuns = await runPage(db, 'active', ['fanout', 'ready'], 100);
  let lastActiveRun: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (const run of activeRuns.docs) {
    if (attempted >= 2000) break;
    lastActiveRun = run;
    try {
    const campaign = await campaignRef(db, run.get('campaignId')).get();
    if (campaign.get('status') === 'paused' || campaign.get('status') === 'canceled') {
      await run.ref.update({ status: campaign.get('status') === 'paused' ? `paused_${run.get('status')}` : 'canceled', ...(campaign.get('status') === 'canceled' ? { completedAt: now } : {}) });
      continue;
    }
    const recipients = run.ref.collection('recipients');
    for (let page = 0; page < 20 && attempted < 2000; page++) {
      const due = await recipients.where('state', '==', 'PENDING').where('dueAt', '<=', now).limit(100).get();
      if (due.empty) break;
      for (let i = 0; i < due.docs.length; i += 20) await Promise.all(due.docs.slice(i, i + 20).map((recipient) => processRecipient(db, recipient, dependencies, now)));
      attempted += due.size;
    }
    const stale = await recipients.where('state', '==', 'CLAIMED').where('leaseUntil', '<=', now).limit(100).get();
    for (let i = 0; i < stale.docs.length; i += 20) await Promise.all(stale.docs.slice(i, i + 20).map((recipient) => processRecipient(db, recipient, dependencies, now)));
    attempted += stale.size;
    } catch (error) {
      logFunctionError('notifications.campaigns', error, { phase: 'recipients', runId: run.id });
    }
  }
  if (lastActiveRun) await activeRuns.advance(lastActiveRun);
  const ready = await runPage(db, 'ready', ['ready'], 100);
  for (const run of ready.docs) {
    try {
    const pending = await run.ref.collection('recipients').where('state', 'in', ['PENDING', 'CLAIMED']).limit(1).get();
    if (pending.empty) {
      // PROCESSED only means the dispatcher owns the attempt. Wait for retries
      // and receipts to reach a terminal state before calling the run completed.
      const dispatches = await db.collection('notificationDispatches')
        .where('campaignRunId', '==', run.id)
        .where('status', 'in', ['CLAIMED', 'RETRY_SCHEDULED', 'PENDING_RECEIPTS']).limit(1).get();
      if (!dispatches.empty) continue;
      const parent = campaignRef(db, run.get('campaignId'));
      await db.runTransaction(async (tx) => {
        const [freshRun, campaign] = await Promise.all([tx.get(run.ref), tx.get(parent)]);
        if (freshRun.get('status') !== 'ready' || campaign.get('status') === 'paused' || campaign.get('status') === 'canceled') return;
        const otherOpen = await tx.get(parent.collection('runs').where('status', 'in', ['fanout', 'ready', 'paused_fanout', 'paused_ready']).limit(2));
        tx.update(run.ref, { status: 'completed', completedAt: now });
        if (campaign.get('status') === 'active' && !campaign.get('nextRunAt')
          && !otherOpen.docs.some((doc) => doc.id !== run.id)) {
          tx.update(parent, { status: 'completed', updatedAt: now, version: Number(campaign.get('version') ?? 0) + 1 });
        }
      });
    }
    } catch (error) {
      logFunctionError('notifications.campaigns', error, { phase: 'run_completion', runId: run.id });
    }
  }
  await ready.advance();
  await reconcileCampaignCompletion(db, now);
  return { materialized: runs.docs.length, attempted };
}

export const processNotificationCampaigns = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 540 }, async () => { await runCampaignScheduler(); });
