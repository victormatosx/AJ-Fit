import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

vi.mock('../../notifications/dispatcher', () => ({ dispatchNotification: vi.fn().mockResolvedValue({ status: 'CONFIRMED', dispatchId: 'test' }) }));

import { db, storage } from '../../lib/firebaseAdmin';
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_RETENTION_MS,
  adminCloseSupportChatHandler,
  adminGetSupportAttachmentAccessHandler,
  adminPrepareSupportAttachmentUploadHandler,
  adminReplyAndCloseSupportCaseHandler,
  adminSendSupportChatMessageHandler,
  adminStartSupportChatHandler,
  createSupportCaseHandler,
  getSupportAttachmentAccessHandler,
  markSupportMessageReadHandler,
  prepareSupportAttachmentUploadHandler,
  sendSupportChatMessageHandler,
} from '../supportV2';
import { purgeSupportCase } from '../cleanup';
import {
  adminClaimSupportCaseHandler,
  adminReleaseSupportCaseHandler,
  adminTransferSupportCaseHandler,
} from '../supportAssignment';

const enabled = process.env.SUPPORT_V2_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const ownedUids = new Set<string>();

function request(uid: string, data: Record<string, unknown>): CallableRequest<unknown> {
  return { auth: { uid, token: { email_verified: true, firebase: { identities: { email: [`${uid}@example.com`] } } } }, data } as unknown as CallableRequest<unknown>;
}

async function seedUser(uid: string, role = 'user') {
  ownedUids.add(uid);
  await db.doc(`users/${uid}`).set({ profile: { name: uid, email: `${uid}@example.com` }, metadata: { role } });
}

async function createCase(uid: string, suffix = randomUUID().replaceAll('-', '_')) {
  return createSupportCaseHandler(request(uid, {
    requestId: `request_${suffix}`, type: 'SUPPORT', subject: 'Ajuda necessária',
    message: 'Esta é a primeira mensagem do atendimento.', platform: 'ios',
  }));
}

/**
 * Proves the reader-side (getSupportAttachmentAccess/adminGetSupportAttachmentAccess)
 * actually authorizes access to the attachment — the real regression surface
 * for "attachment sent but never visible to the other party" — without
 * depending on the local Storage emulator's ability to cryptographically
 * sign a URL. The emulator's fake ADC credentials have no `client_email`, so
 * `getSignedUrl` throws `SigningError: Cannot sign data without client_email`
 * even when every one of our own authorization/binding checks already
 * passed; any OTHER failure (not-found, permission-denied,
 * attachment_not_bound_to_message) is a real bug and must still fail loudly.
 */
async function expectAttachmentAccessGranted(promise: Promise<unknown>): Promise<void> {
  try {
    const result = await promise as { url: string };
    expect(result.url).toContain('http');
  } catch (error) {
    expect(String((error as Error).message)).toContain('sign data');
  }
}

/**
 * Stages a real Storage object behind a real upload session, mirroring what
 * the mobile/admin upload step does before calling a message callable with
 * `uploadId`. `asAdmin` picks which entry point stages it —
 * `adminPrepareSupportAttachmentUploadHandler` (Admin Web, no App Check) vs
 * `prepareSupportAttachmentUploadHandler` (mobile, App-Check-enforced) — so
 * tests can pin down exactly which one is being exercised.
 */
async function stageAttachment(uid: string, mimeType = 'image/jpeg', sizeBytes = 1024, asAdmin = false) {
  const handler = asAdmin ? adminPrepareSupportAttachmentUploadHandler : prepareSupportAttachmentUploadHandler;
  const prepared = await handler(request(uid, {
    requestId: `upload_${randomUUID().replaceAll('-', '_')}`, mimeType,
  })) as { uploadId: string; storagePath: string };
  await storage.bucket().file(prepared.storagePath).save(Buffer.alloc(sizeBytes, 1), {
    metadata: { contentType: mimeType, metadata: { ownerId: uid, uploadId: prepared.uploadId } },
  });
  return prepared;
}

beforeAll(() => {
  if (enabled && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST required');
});

beforeEach(async () => {
  if (!enabled) return;
  await Promise.all([...ownedUids].map(async (uid) => {
    const cases = await db.collection('supportCases').where('ownerUid', '==', uid).get();
    for (const item of cases.docs) await db.recursiveDelete(item.ref);
    await db.doc(`users/${uid}`).delete();
    await db.doc(`accountDeletionLocks/${uid}`).delete();
  }));
  const rateLimits = await db.collection('supportRateLimits').get();
  await Promise.all(rateLimits.docs.map((item) => item.ref.delete()));
  ownedUids.clear();
});

afterAll(async () => { if (enabled) await db.terminate(); });

suite('Support V2 transactional backend', () => {
  it('creates and retries the same case idempotently', async () => {
    await seedUser('owner-idempotent');
    const payload = { requestId: 'request_idempotent_001', type: 'BUG', subject: 'Erro no treino', message: 'O treino fecha sempre que tento iniciar.' };
    const first = await createSupportCaseHandler(request('owner-idempotent', payload));
    const retry = await createSupportCaseHandler(request('owner-idempotent', payload));
    expect(retry.caseId).toBe(first.caseId);
    expect((await db.doc(`supportCases/${first.caseId}`).collection('messages').get()).size).toBe(1);
  });

  it('serializes competing admin decisions so exactly one mode wins', async () => {
    await seedUser('decision-owner'); await seedUser('admin-one', 'admin'); await seedUser('admin-two', 'admin');
    const created = await createCase('decision-owner', 'decision_001');
    const results = await Promise.allSettled([
      adminReplyAndCloseSupportCaseHandler(request('admin-one', { caseId: created.caseId, requestId: 'reply_decision_001', message: 'Resposta única e definitiva.' })),
      adminStartSupportChatHandler(request('admin-two', { caseId: created.caseId, requestId: 'chat_decision_001' })),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const data = (await db.doc(`supportCases/${created.caseId}`).get()).data()!;
    expect([['CLOSED_SINGLE', 'SINGLE_REPLY'], ['CHAT_OPEN', 'CHAT']]).toContainEqual([data.state, data.mode]);
  });

  it('persists a single reply exactly once across retries', async () => {
    await seedUser('single-owner'); await seedUser('single-admin', 'admin');
    const created = await createCase('single-owner', 'single_001');
    const payload = { caseId: created.caseId, requestId: 'single_reply_001', message: 'Aqui está sua resposta final.' };
    await adminReplyAndCloseSupportCaseHandler(request('single-admin', payload));
    await adminReplyAndCloseSupportCaseHandler(request('single-admin', payload));
    const messages = await db.doc(`supportCases/${created.caseId}`).collection('messages').where('senderType', '==', 'ADMIN').get();
    expect(messages.size).toBe(1);
    const closedData = (await db.doc(`supportCases/${created.caseId}`).get()).data()!;
    expect(closedData.purgeAt).toBeTruthy();
    expect(closedData.state).toBe('CLOSED_SINGLE');
    expect((closedData.purgeAt as Timestamp).toMillis() - (closedData.closedAt as Timestamp).toMillis())
      .toBe(SUPPORT_RETENTION_MS);
  });

  it('allows both sides only while chat is open and records readAt', async () => {
    await seedUser('chat-owner'); await seedUser('chat-admin', 'admin');
    const created = await createCase('chat-owner', 'chat_001');
    await adminStartSupportChatHandler(request('chat-admin', { caseId: created.caseId, requestId: 'start_chat_001' }));
    await sendSupportChatMessageHandler(request('chat-owner', { caseId: created.caseId, requestId: 'user_message_001', message: 'Mensagem do usuário no chat.' }));
    const adminMessage = await sendSupportChatMessageHandler(request('chat-admin', { caseId: created.caseId, requestId: 'admin_message_001', message: 'Mensagem segura do suporte.' }));
    await markSupportMessageReadHandler(request('chat-owner', { caseId: created.caseId, messageId: adminMessage.messageId }));
    expect((await db.doc(`supportCases/${created.caseId}/messages/${adminMessage.messageId}`).get()).data()?.readAt).toBeTruthy();
    await adminCloseSupportChatHandler(request('chat-admin', { caseId: created.caseId, requestId: 'close_chat_001' }));
    await expect(sendSupportChatMessageHandler(request('chat-owner', { caseId: created.caseId, requestId: 'late_message_001', message: 'Esta mensagem deve ser rejeitada.' }))).rejects.toMatchObject({ code: 'failed-precondition' });
    const closedData = (await db.doc(`supportCases/${created.caseId}`).get()).data()!;
    expect(closedData.state).toBe('CHAT_CLOSED');
    expect((closedData.purgeAt as Timestamp).toMillis() - (closedData.closedAt as Timestamp).toMillis())
      .toBe(SUPPORT_RETENTION_MS);
  });

  it('keeps send-vs-close serializable and never stores a message after closure', async () => {
    await seedUser('race-owner'); await seedUser('race-admin', 'admin');
    const created = await createCase('race-owner', 'race_001');
    await adminStartSupportChatHandler(request('race-admin', { caseId: created.caseId, requestId: 'start_race_001' }));
    await Promise.allSettled([
      sendSupportChatMessageHandler(request('race-owner', { caseId: created.caseId, requestId: 'racing_message_001', message: 'Mensagem concorrente com fechamento.' })),
      adminCloseSupportChatHandler(request('race-admin', { caseId: created.caseId, requestId: 'racing_close_001' })),
    ]);
    const snapshot = await db.doc(`supportCases/${created.caseId}`).get();
    expect(snapshot.data()?.state).toBe('CHAT_CLOSED');
    await expect(sendSupportChatMessageHandler(request('race-owner', { caseId: created.caseId, requestId: 'after_race_001', message: 'Mensagem definitivamente tardia.' }))).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('enforces account deletion locks and the create-case rate limit', async () => {
    await seedUser('locked-owner');
    await db.doc('accountDeletionLocks/locked-owner').set({ createdAt: new Date() });
    await expect(createCase('locked-owner', 'locked_001')).rejects.toMatchObject({ code: 'failed-precondition' });

    await seedUser('rate-owner');
    for (let index = 0; index < 5; index += 1) await createCase('rate-owner', `rate_00${index}`);
    await expect(createCase('rate-owner', 'rate_006')).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('rejects cross-user attachment grants before any URL can be minted', async () => {
    await seedUser('attachment-owner'); await seedUser('attachment-attacker');
    const created = await createCase('attachment-owner', 'attachment_001');
    await expect(getSupportAttachmentAccessHandler(request('attachment-attacker', {
      caseId: created.caseId, messageId: created.messageId,
      storagePath: 'users/attachment-owner/support-v2/staged/forged_upload_001',
    }))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('sends a user chat message: text only, image only, and text + image (JPEG and PNG)', async () => {
    await seedUser('chat-attach-owner'); await seedUser('chat-attach-admin', 'admin');
    const created = await createCase('chat-attach-owner', 'chat_attach_001');
    await adminStartSupportChatHandler(request('chat-attach-admin', { caseId: created.caseId, requestId: 'start_chat_attach_001' }));

    const textOnly = await sendSupportChatMessageHandler(request('chat-attach-owner', {
      caseId: created.caseId, requestId: 'text_only_001', message: 'Só texto, sem anexo.',
    }));
    const textMessage = (await db.doc(`supportCases/${created.caseId}/messages/${textOnly.messageId}`).get()).data()!;
    expect(textMessage.attachments).toEqual([]);

    const jpeg = await stageAttachment('chat-attach-owner', 'image/jpeg');
    const imageOnly = await sendSupportChatMessageHandler(request('chat-attach-owner', {
      caseId: created.caseId, requestId: 'image_only_001', uploadId: jpeg.uploadId,
    }));
    const imageOnlyMessage = (await db.doc(`supportCases/${created.caseId}/messages/${imageOnly.messageId}`).get()).data()!;
    expect(imageOnlyMessage.message).toBe('');
    expect(imageOnlyMessage.attachments).toEqual([expect.objectContaining({ storagePath: jpeg.storagePath, mimeType: 'image/jpeg', type: 'IMAGE' })]);

    const png = await stageAttachment('chat-attach-owner', 'image/png');
    const textAndImage = await sendSupportChatMessageHandler(request('chat-attach-owner', {
      caseId: created.caseId, requestId: 'text_and_image_001', message: 'Segue print.', uploadId: png.uploadId,
    }));
    const textAndImageMessage = (await db.doc(`supportCases/${created.caseId}/messages/${textAndImage.messageId}`).get()).data()!;
    expect(textAndImageMessage.message).toBe('Segue print.');
    expect(textAndImageMessage.attachments).toEqual([expect.objectContaining({ storagePath: png.storagePath, mimeType: 'image/png' })]);

    // The staged upload session is consumed (ATTACHED), never left orphaned/reusable.
    expect((await db.doc(`supportUploadSessions/${jpeg.uploadId}`).get()).data()?.status).toBe('ATTACHED');
  });

  it('rejects a chat message with neither text nor an attachment', async () => {
    await seedUser('chat-empty-owner'); await seedUser('chat-empty-admin', 'admin');
    const created = await createCase('chat-empty-owner', 'chat_empty_001');
    await adminStartSupportChatHandler(request('chat-empty-admin', { caseId: created.caseId, requestId: 'start_chat_empty_001' }));
    await expect(sendSupportChatMessageHandler(request('chat-empty-owner', {
      caseId: created.caseId, requestId: 'empty_001',
    }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('sends an admin chat message: image only and text + image, both visible to the user', async () => {
    await seedUser('chat-admin-attach-owner'); await seedUser('chat-admin-attach-admin', 'admin');
    const created = await createCase('chat-admin-attach-owner', 'chat_admin_attach_001');
    await adminStartSupportChatHandler(request('chat-admin-attach-admin', { caseId: created.caseId, requestId: 'start_chat_admin_attach_001' }));

    // Admin Web stages through the admin entry point (no App Check available there) — see adminPrepareSupportAttachmentUpload tests below for the App-Check-vs-admin-role distinction itself.
    const jpeg = await stageAttachment('chat-admin-attach-admin', 'image/jpeg', 1024, true);
    const adminImageOnly = await adminSendSupportChatMessageHandler(request('chat-admin-attach-admin', {
      caseId: created.caseId, requestId: 'admin_image_only_001', uploadId: jpeg.uploadId,
    }));
    const adminMessage = (await db.doc(`supportCases/${created.caseId}/messages/${adminImageOnly.messageId}`).get()).data()!;
    expect(adminMessage.senderType).toBe('ADMIN');
    expect(adminMessage.attachments).toEqual([expect.objectContaining({ storagePath: jpeg.storagePath })]);

    // The user (not the admin/uploader) can open it through the secure signed-URL access path.
    await expectAttachmentAccessGranted(getSupportAttachmentAccessHandler(request('chat-admin-attach-owner', {
      caseId: created.caseId, messageId: adminImageOnly.messageId, storagePath: jpeg.storagePath,
    })));
  });

  it('single-reply (adminReplyAndCloseSupportCase) accepts an image-only reply and closes the case', async () => {
    await seedUser('single-attach-owner'); await seedUser('single-attach-admin', 'admin');
    const created = await createCase('single-attach-owner', 'single_attach_001');
    const jpeg = await stageAttachment('single-attach-admin', 'image/jpeg', 1024, true);

    const reply = await adminReplyAndCloseSupportCaseHandler(request('single-attach-admin', {
      caseId: created.caseId, requestId: 'single_reply_attach_001', uploadId: jpeg.uploadId,
    })) as { messageId: string };
    const replyMessage = (await db.doc(`supportCases/${created.caseId}/messages/${reply.messageId}`).get()).data()!;
    expect(replyMessage.message).toBe('');
    expect(replyMessage.attachments).toEqual([expect.objectContaining({ storagePath: jpeg.storagePath })]);
    const closedCase = (await db.doc(`supportCases/${created.caseId}`).get()).data()!;
    expect(closedCase.state).toBe('CLOSED_SINGLE');

    // Admin's own secure-access path also works for what it just sent.
    await expectAttachmentAccessGranted(adminGetSupportAttachmentAccessHandler(request('single-attach-admin', {
      caseId: created.caseId, messageId: reply.messageId, storagePath: jpeg.storagePath,
    })));
  });

  it('adminPrepareSupportAttachmentUpload stages a real, attachable upload for an admin caller', async () => {
    await seedUser('admin-prepare-admin', 'admin');
    const prepared = await adminPrepareSupportAttachmentUploadHandler(request('admin-prepare-admin', {
      requestId: 'admin_prepare_001', mimeType: 'image/jpeg',
    })) as { uploadId: string; storagePath: string };
    expect(prepared.storagePath).toBe(`users/admin-prepare-admin/support-v2/staged/${prepared.uploadId}`);
    const session = (await db.doc(`supportUploadSessions/${prepared.uploadId}`).get()).data()!;
    expect(session.ownerUid).toBe('admin-prepare-admin');
    expect(session.status).toBe('STAGED');
  });

  it('rejects adminPrepareSupportAttachmentUpload for a non-admin caller', async () => {
    await seedUser('admin-prepare-attacker');
    await expect(adminPrepareSupportAttachmentUploadHandler(request('admin-prepare-attacker', {
      requestId: 'admin_prepare_attacker_001', mimeType: 'image/jpeg',
    }))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects an attachment over the 8MB limit', async () => {
    await seedUser('chat-oversize-owner'); await seedUser('chat-oversize-admin', 'admin');
    const created = await createCase('chat-oversize-owner', 'chat_oversize_001');
    await adminStartSupportChatHandler(request('chat-oversize-admin', { caseId: created.caseId, requestId: 'start_chat_oversize_001' }));
    const oversized = await stageAttachment('chat-oversize-owner', 'image/jpeg', SUPPORT_ATTACHMENT_MAX_BYTES + 1);
    await expect(sendSupportChatMessageHandler(request('chat-oversize-owner', {
      caseId: created.caseId, requestId: 'oversize_001', uploadId: oversized.uploadId,
    }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects attaching another user\'s staged upload (cross-user attachment reuse)', async () => {
    await seedUser('chat-cross-owner'); await seedUser('chat-cross-admin', 'admin'); await seedUser('chat-cross-victim');
    const created = await createCase('chat-cross-owner', 'chat_cross_001');
    await adminStartSupportChatHandler(request('chat-cross-admin', { caseId: created.caseId, requestId: 'start_chat_cross_001' }));
    const victimUpload = await stageAttachment('chat-cross-victim', 'image/jpeg');
    await expect(sendSupportChatMessageHandler(request('chat-cross-owner', {
      caseId: created.caseId, requestId: 'cross_001', uploadId: victimUpload.uploadId,
    }))).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a new message (with or without an image) once the case is closed', async () => {
    await seedUser('chat-closed-owner'); await seedUser('chat-closed-admin', 'admin');
    const created = await createCase('chat-closed-owner', 'chat_closed_001');
    await adminStartSupportChatHandler(request('chat-closed-admin', { caseId: created.caseId, requestId: 'start_chat_closed_001' }));
    await adminCloseSupportChatHandler(request('chat-closed-admin', { caseId: created.caseId, requestId: 'close_chat_closed_001' }));

    await expect(sendSupportChatMessageHandler(request('chat-closed-owner', {
      caseId: created.caseId, requestId: 'after_close_text_001', message: 'Ainda dá pra responder?',
    }))).rejects.toMatchObject({ code: 'failed-precondition' });

    const jpeg = await stageAttachment('chat-closed-owner', 'image/jpeg');
    await expect(sendSupportChatMessageHandler(request('chat-closed-owner', {
      caseId: created.caseId, requestId: 'after_close_image_001', uploadId: jpeg.uploadId,
    }))).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  /**
   * Regression suite for the "envia sem erro mas a imagem nunca aparece"
   * report. Root cause was NOT a code defect in this handler (proved by
   * these tests passing against a real Firestore+Storage emulator): the
   * `sendSupportChatMessage`/`adminSendSupportChatMessage`/
   * `adminReplyAndCloseSupportCase` Cloud Functions deployed in production
   * predate `uploadId` support and always persisted `attachments: []`,
   * regardless of what the client sent — only `adminPrepareSupportAttachmentUpload`
   * had been deployed since. These tests pin the exact contract that must
   * hold once the three functions above are redeployed: the message
   * document really contains `attachments`, and the OTHER party's own
   * secure-access callable — not just the sender's — can read it.
   */
  describe('regression: an attached image must reach the other party end-to-end', () => {
    it('user sends an image-only chat message: message doc has attachments, admin can access it', async () => {
      await seedUser('regress-u2a-owner'); await seedUser('regress-u2a-admin', 'admin');
      const created = await createCase('regress-u2a-owner', 'regress_u2a_001');
      await adminStartSupportChatHandler(request('regress-u2a-admin', { caseId: created.caseId, requestId: 'regress_u2a_start_001' }));

      const jpeg = await stageAttachment('regress-u2a-owner', 'image/jpeg');
      const sent = await sendSupportChatMessageHandler(request('regress-u2a-owner', {
        caseId: created.caseId, requestId: 'regress_u2a_send_001', uploadId: jpeg.uploadId,
      }));
      const doc = (await db.doc(`supportCases/${created.caseId}/messages/${sent.messageId}`).get()).data()!;
      expect(doc.senderType).toBe('USER');
      expect(doc.attachments).toHaveLength(1);
      expect(doc.attachments[0]).toMatchObject({ storagePath: jpeg.storagePath, mimeType: 'image/jpeg', type: 'IMAGE' });

      await expectAttachmentAccessGranted(adminGetSupportAttachmentAccessHandler(request('regress-u2a-admin', {
        caseId: created.caseId, messageId: sent.messageId, storagePath: jpeg.storagePath,
      })));
    });

    it('admin sends an image-only chat message: message doc has attachments, mobile user can access it', async () => {
      await seedUser('regress-a2u-owner'); await seedUser('regress-a2u-admin', 'admin');
      const created = await createCase('regress-a2u-owner', 'regress_a2u_001');
      await adminStartSupportChatHandler(request('regress-a2u-admin', { caseId: created.caseId, requestId: 'regress_a2u_start_001' }));

      const jpeg = await stageAttachment('regress-a2u-admin', 'image/jpeg', 1024, true);
      const sent = await adminSendSupportChatMessageHandler(request('regress-a2u-admin', {
        caseId: created.caseId, requestId: 'regress_a2u_send_001', uploadId: jpeg.uploadId,
      }));
      const doc = (await db.doc(`supportCases/${created.caseId}/messages/${sent.messageId}`).get()).data()!;
      expect(doc.senderType).toBe('ADMIN');
      expect(doc.attachments).toHaveLength(1);
      expect(doc.attachments[0]).toMatchObject({ storagePath: jpeg.storagePath, mimeType: 'image/jpeg', type: 'IMAGE' });

      await expectAttachmentAccessGranted(getSupportAttachmentAccessHandler(request('regress-a2u-owner', {
        caseId: created.caseId, messageId: sent.messageId, storagePath: jpeg.storagePath,
      })));
    });

    it('text + image together: both the text and the attachment persist and are readable by the other party', async () => {
      await seedUser('regress-both-owner'); await seedUser('regress-both-admin', 'admin');
      const created = await createCase('regress-both-owner', 'regress_both_001');
      await adminStartSupportChatHandler(request('regress-both-admin', { caseId: created.caseId, requestId: 'regress_both_start_001' }));

      const png = await stageAttachment('regress-both-owner', 'image/png');
      const sent = await sendSupportChatMessageHandler(request('regress-both-owner', {
        caseId: created.caseId, requestId: 'regress_both_send_001', message: 'Segue o print do erro.', uploadId: png.uploadId,
      }));
      const doc = (await db.doc(`supportCases/${created.caseId}/messages/${sent.messageId}`).get()).data()!;
      expect(doc.message).toBe('Segue o print do erro.');
      expect(doc.attachments).toHaveLength(1);
      expect(doc.attachments[0]).toMatchObject({ storagePath: png.storagePath, mimeType: 'image/png' });

      await expectAttachmentAccessGranted(adminGetSupportAttachmentAccessHandler(request('regress-both-admin', {
        caseId: created.caseId, messageId: sent.messageId, storagePath: png.storagePath,
      })));
    });

    it('image only, with no text at all: attachment still persists and is readable by the other party', async () => {
      await seedUser('regress-imgonly-owner'); await seedUser('regress-imgonly-admin', 'admin');
      const created = await createCase('regress-imgonly-owner', 'regress_imgonly_001');
      await adminStartSupportChatHandler(request('regress-imgonly-admin', { caseId: created.caseId, requestId: 'regress_imgonly_start_001' }));

      const jpeg = await stageAttachment('regress-imgonly-owner', 'image/jpeg');
      const sent = await sendSupportChatMessageHandler(request('regress-imgonly-owner', {
        caseId: created.caseId, requestId: 'regress_imgonly_send_001', uploadId: jpeg.uploadId,
      }));
      const doc = (await db.doc(`supportCases/${created.caseId}/messages/${sent.messageId}`).get()).data()!;
      expect(doc.message).toBe('');
      expect(doc.attachments).toHaveLength(1);

      await expectAttachmentAccessGranted(adminGetSupportAttachmentAccessHandler(request('regress-imgonly-admin', {
        caseId: created.caseId, messageId: sent.messageId, storagePath: jpeg.storagePath,
      })));
    });
  });

  describe('support assignment concurrency', () => {
    it('claims a free case and stores the authenticated admin, never a client-provided uid', async () => {
      await seedUser('assign-owner'); await seedUser('assign-admin', 'admin');
      const created = await createCase('assign-owner', 'assign_free_001');
      await adminClaimSupportCaseHandler(request('assign-admin', { caseId: created.caseId, adminUid: 'forged-admin' }));
      const data = (await db.doc(`supportCases/${created.caseId}`).get()).data()!;
      expect(data.assignedAdminUid).toBe('assign-admin');
      expect(data.assignedAt).toBeInstanceOf(Timestamp);
    });

    it('serializes two simultaneous claims so exactly one admin succeeds', async () => {
      await seedUser('race-claim-owner'); await seedUser('race-claim-one', 'admin'); await seedUser('race-claim-two', 'admin');
      const created = await createCase('race-claim-owner', 'race_claim_001');
      const results = await Promise.allSettled([
        adminClaimSupportCaseHandler(request('race-claim-one', { caseId: created.caseId })),
        adminClaimSupportCaseHandler(request('race-claim-two', { caseId: created.caseId })),
      ]);
      expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(['race-claim-one', 'race-claim-two']).toContain((await db.doc(`supportCases/${created.caseId}`).get()).data()?.assignedAdminUid);
    });

    it('rejects claiming an assigned or closed case and a missing case', async () => {
      await seedUser('claim-guards-owner'); await seedUser('claim-guards-admin', 'admin');
      const created = await createCase('claim-guards-owner', 'claim_guards_001');
      await adminClaimSupportCaseHandler(request('claim-guards-admin', { caseId: created.caseId }));
      await expect(adminClaimSupportCaseHandler(request('claim-guards-admin', { caseId: created.caseId }))).rejects.toMatchObject({ code: 'aborted' });
      await adminReplyAndCloseSupportCaseHandler(request('claim-guards-admin', { caseId: created.caseId, requestId: 'close_claim_guards_001', message: 'Encerrado.' }));
      await db.doc(`supportCases/${created.caseId}`).update({ assignedAdminUid: null, assignedAt: null });
      await expect(adminClaimSupportCaseHandler(request('claim-guards-admin', { caseId: created.caseId }))).rejects.toMatchObject({ code: 'failed-precondition' });
      await expect(adminClaimSupportCaseHandler(request('claim-guards-admin', { caseId: 'missing_case_001' }))).rejects.toMatchObject({ code: 'not-found' });
    });

    it('allows release only by the current responsible admin', async () => {
      await seedUser('release-owner'); await seedUser('release-admin', 'admin'); await seedUser('release-other', 'admin');
      const created = await createCase('release-owner', 'release_001');
      await adminClaimSupportCaseHandler(request('release-admin', { caseId: created.caseId }));
      await expect(adminReleaseSupportCaseHandler(request('release-other', { caseId: created.caseId, expectedAssignedAdminUid: 'release-admin' }))).rejects.toMatchObject({ code: 'permission-denied' });
      await adminReleaseSupportCaseHandler(request('release-admin', { caseId: created.caseId, expectedAssignedAdminUid: 'release-admin' }));
      expect((await db.doc(`supportCases/${created.caseId}`).get()).data()?.assignedAdminUid).toBeNull();
    });

    it('transfers to an eligible admin and rejects a stale concurrent transfer', async () => {
      await seedUser('transfer-owner'); await seedUser('transfer-source', 'admin'); await seedUser('transfer-a', 'admin'); await seedUser('transfer-b', 'admin');
      const created = await createCase('transfer-owner', 'transfer_001');
      await adminClaimSupportCaseHandler(request('transfer-source', { caseId: created.caseId }));
      const results = await Promise.allSettled([
        adminTransferSupportCaseHandler(request('transfer-source', { caseId: created.caseId, targetAdminUid: 'transfer-a', expectedAssignedAdminUid: 'transfer-source' })),
        adminTransferSupportCaseHandler(request('transfer-source', { caseId: created.caseId, targetAdminUid: 'transfer-b', expectedAssignedAdminUid: 'transfer-source' })),
      ]);
      expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(['transfer-a', 'transfer-b']).toContain((await db.doc(`supportCases/${created.caseId}`).get()).data()?.assignedAdminUid);
    });

    it('rejects invalid and inactive admins', async () => {
      await seedUser('inactive-owner'); await seedUser('inactive-admin', 'admin'); await seedUser('ordinary-user');
      const created = await createCase('inactive-owner', 'inactive_001');
      await expect(adminClaimSupportCaseHandler(request('ordinary-user', { caseId: created.caseId }))).rejects.toMatchObject({ code: 'permission-denied' });
      await db.doc('accountDeletionLocks/inactive-admin').set({ status: 'REQUESTED' });
      await expect(adminClaimSupportCaseHandler(request('inactive-admin', { caseId: created.caseId }))).rejects.toMatchObject({ code: 'failed-precondition' });
    });
  });

  it('purges a chat-attached image object from Storage when the closed case is cleaned up', async () => {
    await seedUser('cleanup-attach-owner'); await seedUser('cleanup-attach-admin', 'admin');
    const created = await createCase('cleanup-attach-owner', 'cleanup_attach_001');
    await adminStartSupportChatHandler(request('cleanup-attach-admin', { caseId: created.caseId, requestId: 'start_cleanup_attach_001' }));
    const jpeg = await stageAttachment('cleanup-attach-owner', 'image/jpeg');
    await sendSupportChatMessageHandler(request('cleanup-attach-owner', {
      caseId: created.caseId, requestId: 'cleanup_attach_image_001', uploadId: jpeg.uploadId,
    }));
    await adminCloseSupportChatHandler(request('cleanup-attach-admin', { caseId: created.caseId, requestId: 'close_cleanup_attach_001' }));

    const caseRef = db.doc(`supportCases/${created.caseId}`);
    await caseRef.update({ purgeAt: Timestamp.fromMillis(Timestamp.now().toMillis() - 1) });
    await expect(purgeSupportCase(caseRef)).resolves.toBe(true);
    await expect(storage.bucket().file(jpeg.storagePath).exists()).resolves.toEqual([false]);
  });

  it('retries cleanup after partial Storage failure and deletes the parent last', async () => {
    const caseRef = db.doc('supportCases/cleanup-case-001');
    const now = Timestamp.now();
    await caseRef.set({ ownerUid: 'cleanup-owner', state: 'CHAT_CLOSED', mode: 'CHAT', purgeAt: Timestamp.fromMillis(now.toMillis() - 1) });
    await caseRef.collection('messages').doc('cleanup-message-001').set({
      attachments: [{ storagePath: 'users/cleanup-owner/support-v2/staged/cleanup-upload' }],
    });
    let fail = true;
    const deleteObject = vi.fn(async () => { if (fail) throw Object.assign(new Error('injected_storage_failure'), { code: 500 }); });
    const fakeStorage = { bucket: () => ({ file: () => ({ delete: deleteObject }) }) } as unknown as Storage;

    await expect(purgeSupportCase(caseRef, db, fakeStorage, now)).rejects.toThrow('injected_storage_failure');
    expect((await caseRef.get()).exists).toBe(true);
    expect((await caseRef.collection('messages').doc('cleanup-message-001').get()).exists).toBe(true);

    fail = false;
    await expect(purgeSupportCase(caseRef, db, fakeStorage, Timestamp.fromMillis(now.toMillis() + 11 * 60 * 1000))).resolves.toBe(true);
    expect((await caseRef.get()).exists).toBe(false);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });
});
