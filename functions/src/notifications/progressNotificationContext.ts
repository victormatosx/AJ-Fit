import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { addDaysLocal, compareLocalDates } from '../workoutLifecycle/scheduleEngine/calendar';
import {
  canonicalIanaTimezone,
  localDateInTimezone,
} from '../workoutLifecycle/scheduleEngine/localDate';
import { dailyLocalClock } from './dailyTime';

export const PHOTO_REMINDER_INTERVAL_DAYS = 30;
export const ASSESSMENT_REMINDER_INTERVAL_DAYS = 90;
export const PROGRESS_HISTORY_LIMIT = 200;

export type ProgressNotificationType =
  | 'PHOTO_REMINDER'
  | 'ASSESSMENT_REMINDER'
  | 'COMPARE_PROGRESS';

export interface ProgressCandidate {
  notificationType: ProgressNotificationType;
  /** Safe semantic fact. The content builder hashes this before persistence. */
  progressIdentity: string;
}

export interface ProgressPhotoFact {
  id: string;
  takenAt: Date;
  createdAt: Date;
  dateKey?: string;
  pose?: 'front' | 'side' | 'back';
}

export interface AssessmentFact {
  id: string;
  measuredAt: Date;
  createdAt: Date;
}

export type ProgressNotificationContext = {
  allowed: true;
  candidates: readonly ProgressCandidate[];
  timezone: string;
  localDate: string;
} | {
  allowed: false;
  reason: string;
  timezone?: string;
  localDate?: string;
};

export interface ProgressFacts {
  status: 'READY';
  timezone: string;
  photos: readonly ProgressPhotoFact[];
  assessments: readonly AssessmentFact[];
}

export type ProgressFactsLoad = ProgressFacts | {
  status:
    | 'USER_NOT_FOUND'
    | 'ACCOUNT_INACTIVE'
    | 'TIMEZONE_UNAVAILABLE'
    | 'HISTORY_UNAVAILABLE';
  timezone?: string;
};

const POSES = new Set(['front', 'side', 'back']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);
const COMMON_PHOTO_KEYS = [
  'storagePath', 'createdAt', 'takenAt', 'originalMimeType', 'encryptedSize', 'encryption',
] as const;
const THUMBNAIL_KEYS = [
  'thumbnailStoragePath', 'thumbnailEncryptedSize', 'thumbnailEncryption',
] as const;

function exactKeys(data: DocumentData, allowed: readonly string[]): boolean {
  const keys = Object.keys(data).sort();
  return keys.length === allowed.length
    && keys.every((key, index) => key === [...allowed].sort()[index]);
}

function validEncryption(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return exactKeys(data, ['version', 'algorithm', 'iv', 'vaultKeyVersion'])
    && Number.isInteger(data.version)
    && Number(data.version) >= 1
    && data.algorithm === 'AES-256-GCM'
    && typeof data.iv === 'string'
    && data.iv.length >= 16
    && data.iv.length <= 32
    && Number.isInteger(data.vaultKeyVersion)
    && Number(data.vaultKeyVersion) >= 1;
}

function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validDate(value: unknown, now: Date): value is Date {
  return value instanceof Date
    && Number.isFinite(value.getTime())
    && value.getTime() <= now.getTime();
}

function timestampDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

function parsePhoto(
  uid: string,
  id: string,
  data: DocumentData,
  now: Date,
): ProgressPhotoFact | null {
  const takenAt = timestampDate(data.takenAt);
  const createdAt = timestampDate(data.createdAt);
  if (!takenAt || !createdAt || !validDate(takenAt, now) || !validDate(createdAt, now)) return null;
  if (takenAt.getTime() > createdAt.getTime()) return null;
  if (
    !MIME_TYPES.has(data.originalMimeType)
    || !Number.isInteger(data.encryptedSize)
    || data.encryptedSize <= 0
    || data.encryptedSize > 10 * 1024 * 1024
    || !validEncryption(data.encryption)
  ) {
    return null;
  }

  const posedFields = Number('assetId' in data) + Number('dateKey' in data) + Number('pose' in data);
  if (posedFields !== 0 && posedFields !== 3) return null;
  if (posedFields === 3) {
    if (
      typeof data.assetId !== 'string'
      || !UUID_PATTERN.test(data.assetId)
      || !validLocalDate(data.dateKey)
      || !POSES.has(data.pose)
      || id !== `${data.dateKey}_${data.pose}`
      || !exactKeys(data, [...COMMON_PHOTO_KEYS, ...THUMBNAIL_KEYS, 'assetId', 'dateKey', 'pose'])
      || data.storagePath !== `users/${uid}/progressPhotos/${data.assetId}.enc`
      || data.thumbnailStoragePath !== `users/${uid}/progressPhotos/${data.assetId}.thumb.enc`
      || !Number.isInteger(data.thumbnailEncryptedSize)
      || data.thumbnailEncryptedSize <= 0
      || data.thumbnailEncryptedSize > 512 * 1024
      || !validEncryption(data.thumbnailEncryption)
      || (data.thumbnailEncryption as Record<string, unknown>).iv
        === (data.encryption as Record<string, unknown>).iv
    ) return null;
    return { id, takenAt, createdAt, dateKey: data.dateKey, pose: data.pose };
  }
  if (!UUID_PATTERN.test(id)) return null;
  const hasThumbnail = THUMBNAIL_KEYS.some((key) => key in data);
  if (
    !exactKeys(data, hasThumbnail ? [...COMMON_PHOTO_KEYS, ...THUMBNAIL_KEYS] : COMMON_PHOTO_KEYS)
    || data.storagePath !== `users/${uid}/progressPhotos/${id}.enc`
  ) return null;
  if (hasThumbnail && (
    data.thumbnailStoragePath !== `users/${uid}/progressPhotos/${id}.thumb.enc`
    || !Number.isInteger(data.thumbnailEncryptedSize)
    || data.thumbnailEncryptedSize <= 0
    || data.thumbnailEncryptedSize > 512 * 1024
    || !validEncryption(data.thumbnailEncryption)
    || (data.thumbnailEncryption as Record<string, unknown>).iv
      === (data.encryption as Record<string, unknown>).iv
  )) return null;
  return { id, takenAt, createdAt };
}

function positiveFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseAssessment(id: string, data: DocumentData, now: Date): AssessmentFact | null {
  const measuredAt = timestampDate(data.measuredAt);
  const createdAt = timestampDate(data.createdAt);
  if (
    !measuredAt
    || !createdAt
    || !validDate(measuredAt, now)
    || !validDate(createdAt, now)
    || measuredAt.getTime() > createdAt.getTime()
    || !positiveFinite(data.weight)
    || !positiveFinite(data.height)
  ) return null;

  if ('notes' in data && typeof data.notes !== 'string') return null;

  if (data.source === 'guided') {
    if (
      !exactKeys(data, [
        'source', 'measuredAt', 'createdAt', 'weight', 'height', 'bodyFat',
        'calculatorVersion', 'protocol', 'sex', 'age', 'folds',
        ...('notes' in data ? ['notes'] : []),
      ])
      || !positiveFinite(data.bodyFat)
      || data.calculatorVersion !== 1
      || !['jp3', 'jp7'].includes(String(data.protocol))
      || !['m', 'f'].includes(String(data.sex))
      || !Number.isInteger(data.age)
      || data.age <= 0
      || typeof data.folds !== 'object'
      || data.folds === null
      || Array.isArray(data.folds)
      || Object.keys(data.folds).length === 0
    ) return null;
  } else if (data.source !== 'imported') {
    return null;
  } else {
    const optional = ['bodyFat', 'bodyWater', 'basalMetabolism', 'visceralFat', 'notes']
      .filter((key) => key in data);
    if (
      !exactKeys(data, ['source', 'measuredAt', 'createdAt', 'weight', 'height', ...optional])
      || ['bodyFat', 'bodyWater', 'basalMetabolism', 'visceralFat']
        .some((key) => key in data && !positiveFinite(data[key]))
    ) return null;
  }
  return { id, measuredAt, createdAt };
}

/** Reads bounded backend-only metadata; ciphertext and body values never leave this layer. */
export async function loadProgressFacts(
  db: Firestore,
  uid: string,
  now: Timestamp,
): Promise<ProgressFactsLoad> {
  const userRef = db.collection('users').doc(uid);
  const [user, lock, scheduleConfig] = await Promise.all([
    userRef.get(),
    db.collection('accountDeletionLocks').doc(uid).get(),
    userRef.collection('workoutProgramState').doc('scheduleConfig').get(),
  ]);
  if (!user.exists) return { status: 'USER_NOT_FOUND' };
  if (lock.exists) return { status: 'ACCOUNT_INACTIVE' };
  const timezone = canonicalIanaTimezone(scheduleConfig.data()?.timezone);
  if (!timezone) return { status: 'TIMEZONE_UNAVAILABLE' };

  const [photoSnapshot, assessmentSnapshot] = await Promise.all([
    userRef.collection('progressPhotos').orderBy('takenAt', 'desc').limit(PROGRESS_HISTORY_LIMIT).get(),
    userRef.collection('assessments').orderBy('measuredAt', 'desc').limit(PROGRESS_HISTORY_LIMIT).get(),
  ]);
  const instant = now.toDate();
  const photos = photoSnapshot.docs.map((doc) => parsePhoto(uid, doc.id, doc.data(), instant));
  const assessments = assessmentSnapshot.docs.map((doc) => parseAssessment(doc.id, doc.data(), instant));
  if (photos.some((photo) => photo === null) || assessments.some((item) => item === null)) {
    return { status: 'HISTORY_UNAVAILABLE', timezone };
  }
  return {
    status: 'READY',
    timezone,
    photos: photos as ProgressPhotoFact[],
    assessments: assessments as AssessmentFact[],
  };
}

function photoLocalDate(photo: ProgressPhotoFact, timezone: string): string {
  return photo.dateKey ?? localDateInTimezone(photo.takenAt, timezone);
}

export function deriveCompareProgressCandidate(
  photos: readonly ProgressPhotoFact[],
): ProgressCandidate | null {
  const byDate = new Map<string, Set<string>>();
  for (const photo of photos) {
    if (!photo.dateKey || !photo.pose || !validLocalDate(photo.dateKey)) continue;
    const poses = byDate.get(photo.dateKey) ?? new Set<string>();
    poses.add(photo.pose);
    byDate.set(photo.dateKey, poses);
  }
  const dates = [...byDate.keys()].sort().reverse();
  for (let newerIndex = 0; newerIndex < dates.length; newerIndex += 1) {
    const newer = dates[newerIndex];
    const newerPoses = byDate.get(newer);
    if (!newerPoses) continue;
    for (let olderIndex = newerIndex + 1; olderIndex < dates.length; olderIndex += 1) {
      const older = dates[olderIndex];
      const olderPoses = byDate.get(older);
      if (olderPoses && [...newerPoses].some((pose) => olderPoses.has(pose))) {
        return {
          notificationType: 'COMPARE_PROGRESS',
          progressIdentity: `photoComparison:${older}:${newer}`,
        };
      }
    }
  }
  return null;
}

export function derivePhotoReminderCandidate(input: {
  photos: readonly ProgressPhotoFact[];
  timezone: string;
  localDate: string;
}): ProgressCandidate | null {
  const anchors = input.photos.map((photo) => photoLocalDate(photo, input.timezone));
  if (anchors.length === 0 || anchors.some((date) => !validLocalDate(date))) return null;
  const latest = anchors.sort().at(-1);
  if (!latest) return null;
  const dueDate = addDaysLocal(latest, PHOTO_REMINDER_INTERVAL_DAYS);
  if (compareLocalDates(input.localDate, dueDate) < 0) return null;
  return {
    notificationType: 'PHOTO_REMINDER',
    progressIdentity: `photoCycle:${latest}:${dueDate}`,
  };
}

export function deriveAssessmentReminderCandidate(input: {
  assessments: readonly AssessmentFact[];
  timezone: string;
  localDate: string;
}): ProgressCandidate | null {
  const anchors = input.assessments.map((item) => localDateInTimezone(item.measuredAt, input.timezone));
  if (anchors.length === 0 || anchors.some((date) => !validLocalDate(date))) return null;
  const latest = anchors.sort().at(-1);
  if (!latest) return null;
  const dueDate = addDaysLocal(latest, ASSESSMENT_REMINDER_INTERVAL_DAYS);
  if (compareLocalDates(input.localDate, dueDate) < 0) return null;
  return {
    notificationType: 'ASSESSMENT_REMINDER',
    progressIdentity: `assessmentCycle:${latest}:${dueDate}`,
  };
}

export function deriveProgressCandidates(input: ProgressFacts & { localDate: string }): ProgressCandidate[] {
  return [
    deriveCompareProgressCandidate(input.photos),
    deriveAssessmentReminderCandidate(input),
    derivePhotoReminderCandidate(input),
  ].filter((candidate): candidate is ProgressCandidate => candidate !== null);
}

export interface ProgressContextDependencies {
  loadFacts(uid: string, now: Timestamp): Promise<ProgressFactsLoad>;
}

export async function readProgressNotificationContext(
  db: Firestore,
  uid: string,
  now: Timestamp,
  overrides: Partial<ProgressContextDependencies> = {},
  options: { requireDailyWindow?: boolean } = {},
): Promise<ProgressNotificationContext> {
  const facts = await (overrides.loadFacts ?? ((targetUid, instant) => loadProgressFacts(db, targetUid, instant)))(uid, now);
  if (facts.status !== 'READY') return { allowed: false, reason: facts.status, timezone: facts.timezone };
  const clock = dailyLocalClock(now.toDate(), facts.timezone);
  if (!clock) return { allowed: false, reason: 'TIMEZONE_UNAVAILABLE' };
  if ((options.requireDailyWindow ?? true) && !clock.withinWindow) {
    return {
      allowed: false,
      reason: 'OUTSIDE_LOCAL_WINDOW',
      timezone: clock.timezone,
      localDate: clock.localDate,
    };
  }
  const candidates = deriveProgressCandidates({ ...facts, localDate: clock.localDate });
  if (candidates.length === 0) {
    return {
      allowed: false,
      reason: 'NO_PROGRESS_CANDIDATE',
      timezone: clock.timezone,
      localDate: clock.localDate,
    };
  }
  return { allowed: true, candidates, timezone: clock.timezone, localDate: clock.localDate };
}
