import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { requireAdminUid } from '../attribution/adminAuth';
import { requireVerifiedEmailForPrivateAccess } from '../lib/auth';

/**
 * Callable-specific capability for self-targeted push previews.
 *
 * `pushQa` is a Firebase Auth custom claim, set only through the Admin SDK.
 * Existing Firestore admins remain authorized for backwards compatibility,
 * but a QA tester no longer needs the much broader `metadata.role = admin`.
 */
export const PUSH_QA_CUSTOM_CLAIM = 'pushQa';

export async function requirePushQaUid(
  request: CallableRequest<unknown>,
): Promise<string> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'authentication_required');
  }
  requireVerifiedEmailForPrivateAccess(request);

  if (request.auth.token[PUSH_QA_CUSTOM_CLAIM] === true) {
    return request.auth.uid;
  }

  try {
    return await requireAdminUid(request);
  } catch (cause) {
    if (
      cause instanceof HttpsError &&
      cause.code === 'permission-denied' &&
      cause.message === 'admin_role_required'
    ) {
      throw new HttpsError('permission-denied', 'push_qa_permission_required');
    }
    throw cause;
  }
}
