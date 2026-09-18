import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';

/**
 * `handleSupportAdminMessageCreated` is the testable core behind the
 * `onDocumentCreated` trigger in `supportV2Triggers.ts`. `notifyUser` (a thin
 * wrapper over `dispatchNotification`, already covered by
 * `../../notifications/__tests__/dispatcherMode.test.ts` and friends) is
 * mocked here so these tests isolate exactly what this trigger adds: reading
 * the case + `_actions` receipt to decide SINGLE vs CHAT and who to notify,
 * and never notifying for a user-authored message.
 */
let caseData: Record<string, unknown> | undefined;
let actionData: Record<string, unknown> | undefined;

vi.mock('../../lib/firebaseAdmin', () => ({
  db: {
    collection: (name: string) => {
      if (name !== 'supportCases') throw new Error(`unexpected collection ${name}`);
      return {
        doc: (_caseId: string) => ({
          get: async () => ({ exists: caseData !== undefined, data: () => caseData }),
          collection: (sub: string) => {
            if (sub !== '_actions') throw new Error(`unexpected subcollection ${sub}`);
            return {
              doc: (_messageId: string) => ({
                get: async () => ({ exists: actionData !== undefined, data: () => actionData }),
              }),
            };
          },
        }),
      };
    },
  },
}));

const notifyUser = vi.hoisted(() => vi.fn());
vi.mock('../supportV2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supportV2')>();
  return { ...actual, notifyUser };
});

import { handleSupportAdminMessageCreated } from '../supportV2Triggers';

function messageSnapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return { data: () => data } as unknown as QueryDocumentSnapshot;
}

beforeEach(() => {
  caseData = { ownerUid: 'owner-1' };
  actionData = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleSupportAdminMessageCreated', () => {
  it('never notifies for a USER-authored message', async () => {
    await handleSupportAdminMessageCreated('case-1', 'msg-1', messageSnapshot({ senderType: 'USER' }));
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('sends SUPPORT_CHAT_MESSAGE for an ADMIN chat message (no _actions receipt)', async () => {
    actionData = undefined;
    await handleSupportAdminMessageCreated('case-1', 'msg-chat-1', messageSnapshot({ senderType: 'ADMIN' }));
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith({
      uid: 'owner-1', caseId: 'case-1', messageId: 'msg-chat-1', type: 'SUPPORT_CHAT_MESSAGE',
    });
  });

  it('sends SUPPORT_SINGLE_REPLY for an ADMIN message whose _actions receipt has kind SINGLE', async () => {
    actionData = { kind: 'SINGLE', requestId: 'req-1', adminUid: 'admin-1' };
    await handleSupportAdminMessageCreated('case-1', 'msg-single-1', messageSnapshot({ senderType: 'ADMIN' }));
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith({
      uid: 'owner-1', caseId: 'case-1', messageId: 'msg-single-1', type: 'SUPPORT_SINGLE_REPLY',
    });
  });

  it('never notifies when the case cannot be found / has no ownerUid', async () => {
    caseData = undefined;
    await handleSupportAdminMessageCreated('missing-case', 'msg-1', messageSnapshot({ senderType: 'ADMIN' }));
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('a redelivered event for the same messageId dispatches through the same idempotent notifyUser call (no new dedup logic here)', async () => {
    await handleSupportAdminMessageCreated('case-1', 'msg-redeliver-1', messageSnapshot({ senderType: 'ADMIN' }));
    await handleSupportAdminMessageCreated('case-1', 'msg-redeliver-1', messageSnapshot({ senderType: 'ADMIN' }));
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser.mock.calls[0]).toEqual(notifyUser.mock.calls[1]);
  });
});
