import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireActiveAccount } from '../accountDeletion/activeAccountGuard';
import { requireAdminUid } from '../attribution/adminAuth';
import { db } from '../lib/firebaseAdmin';
import { SUPPORT_CASES_COLLECTION } from './supportV2';

const OPEN_STATES = new Set(['SUBMITTED', 'CHAT_OPEN']);
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

type Input = Record<string, unknown>;

function input(request: CallableRequest<unknown>): Input {
  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
    throw new HttpsError('invalid-argument', 'invalid_payload');
  }
  return request.data as Input;
}

function idField(data: Input, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new HttpsError('invalid-argument', `invalid_${key}`);
  }
  return value;
}

function optionalExpectedOwner(data: Input): string | null {
  const value = data.expectedAssignedAdminUid;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new HttpsError('invalid-argument', 'invalid_expectedAssignedAdminUid');
  }
  return value;
}

function assertOpen(data: FirebaseFirestore.DocumentData): void {
  if (!OPEN_STATES.has(String(data.state))) {
    throw new HttpsError('failed-precondition', 'support_case_not_open');
  }
}

export async function adminClaimSupportCaseHandler(request: CallableRequest<unknown>) {
  const adminUid = await requireAdminUid(request);
  await requireActiveAccount(adminUid);
  const caseId = idField(input(request), 'caseId');
  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(caseRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'support_case_not_found');
    const current = snapshot.data()!;
    assertOpen(current);
    if (typeof current.assignedAdminUid === 'string' && current.assignedAdminUid) {
      throw new HttpsError('aborted', 'support_case_already_assigned');
    }
    transaction.update(caseRef, { assignedAdminUid: adminUid, assignedAt: Timestamp.now() });
  });

  return { caseId, assignedAdminUid: adminUid };
}

export async function adminReleaseSupportCaseHandler(request: CallableRequest<unknown>) {
  const adminUid = await requireAdminUid(request);
  await requireActiveAccount(adminUid);
  const data = input(request);
  const caseId = idField(data, 'caseId');
  const expectedOwner = optionalExpectedOwner(data);
  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(caseRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'support_case_not_found');
    const current = snapshot.data()!;
    assertOpen(current);
    const currentOwner = typeof current.assignedAdminUid === 'string' ? current.assignedAdminUid : null;
    if (currentOwner !== expectedOwner) throw new HttpsError('aborted', 'support_assignment_changed');
    if (currentOwner !== adminUid) throw new HttpsError('permission-denied', 'support_case_owner_required');
    transaction.update(caseRef, { assignedAdminUid: null, assignedAt: null });
  });

  return { caseId, assignedAdminUid: null };
}

export async function adminTransferSupportCaseHandler(request: CallableRequest<unknown>) {
  const adminUid = await requireAdminUid(request);
  await requireActiveAccount(adminUid);
  const data = input(request);
  const caseId = idField(data, 'caseId');
  const targetAdminUid = idField(data, 'targetAdminUid');
  const expectedOwner = optionalExpectedOwner(data);
  if (targetAdminUid === adminUid) throw new HttpsError('invalid-argument', 'support_transfer_same_admin');

  const caseRef = db.collection(SUPPORT_CASES_COLLECTION).doc(caseId);
  const targetRef = db.collection('users').doc(targetAdminUid);
  const targetLockRef = db.collection('accountDeletionLocks').doc(targetAdminUid);

  await db.runTransaction(async (transaction) => {
    const [caseSnapshot, targetSnapshot, targetLockSnapshot] = await Promise.all([
      transaction.get(caseRef), transaction.get(targetRef), transaction.get(targetLockRef),
    ]);
    if (!caseSnapshot.exists) throw new HttpsError('not-found', 'support_case_not_found');
    const current = caseSnapshot.data()!;
    assertOpen(current);
    const currentOwner = typeof current.assignedAdminUid === 'string' ? current.assignedAdminUid : null;
    if (currentOwner !== expectedOwner) throw new HttpsError('aborted', 'support_assignment_changed');
    if (currentOwner !== adminUid) throw new HttpsError('permission-denied', 'support_case_owner_required');
    if (!targetSnapshot.exists || targetSnapshot.data()?.metadata?.role !== 'admin' || targetLockSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'support_target_admin_ineligible');
    }
    transaction.update(caseRef, { assignedAdminUid: targetAdminUid, assignedAt: Timestamp.now() });
  });

  return { caseId, assignedAdminUid: targetAdminUid };
}

export async function adminListSupportAgentsHandler(request: CallableRequest<unknown>) {
  const adminUid = await requireAdminUid(request);
  await requireActiveAccount(adminUid);
  const admins = await db.collection('users').where('metadata.role', '==', 'admin').limit(100).get();
  const locks = admins.empty
    ? []
    : await db.getAll(...admins.docs.map((item) => db.collection('accountDeletionLocks').doc(item.id)));
  const locked = new Set(locks.filter((item) => item.exists).map((item) => item.id));
  return {
    agents: admins.docs.filter((item) => !locked.has(item.id)).map((item) => {
      const data = item.data();
      return {
        uid: item.id,
        name: typeof data.profile?.name === 'string' ? data.profile.name.slice(0, 80) : 'Administrador',
        email: typeof data.profile?.email === 'string' ? data.profile.email.slice(0, 254) : '',
      };
    }),
  };
}
