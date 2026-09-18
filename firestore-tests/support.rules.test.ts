import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  getDoc,
  getDocs,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const ADMIN_UID = 'support-admin';
let env: RulesTestEnvironment;

function db(uid = UID) { return env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore(); }
function ticketData(id: string, overrides: Record<string, unknown> = {}) { return {
  id, userId: UID, userName: 'Alice', userEmail: 'alice@example.com', type: 'BUG', subject: 'Falha no treino',
  status: 'OPEN', priority: 'NORMAL', lastMessage: 'A tela fecha ao iniciar o treino.', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  appVersion: '1.0.0', platform: 'ios', osVersion: '19.0', deviceModel: 'iPhone', language: 'pt-BR', attachmentsCount: 0,
  ...overrides,
}; }
function messageData(overrides: Record<string, unknown> = {}) { return { senderType: 'USER', senderId: UID, message: 'A tela fecha ao iniciar o treino.', attachments: [], createdAt: serverTimestamp(), readAt: null, ...overrides }; }

beforeAll(async () => { env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') } }); });
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

async function seedUserRole(uid: string, role: 'user' | 'admin') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      profile: { name: role === 'admin' ? 'Support Admin' : 'Alice', email: `${uid}@example.com` },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    });
  });
}

async function createTicket() {
  const owner = db(); const ticket = doc(collection(owner, 'supportTickets')); const message = doc(collection(ticket, 'messages'));
  const batch = writeBatch(owner); batch.set(ticket, ticketData(ticket.id)); batch.set(message, messageData()); await assertSucceeds(batch.commit()); return { ticket, message };
}

describe('support tickets', () => {
  it('lets the owner atomically create a ticket and first message', async () => {
    const { ticket, message } = await createTicket();
    expect((await getDoc(ticket)).exists()).toBe(true); expect((await getDoc(message)).exists()).toBe(true);
  });
  it('rejects privileged fields and later ticket changes', async () => {
    const owner = db(); const invalid = doc(collection(owner, 'supportTickets'));
    await assertFails(setDoc(invalid, ticketData(invalid.id, { status: 'CLOSED' })));
    const { ticket } = await createTicket(); await assertFails(updateDoc(ticket, { status: 'CLOSED' }));
  });
  it('prevents another user from reading the ticket', async () => {
    const { ticket } = await createTicket(); await assertFails(getDoc(doc(db('mallory'), 'supportTickets', ticket.id)));
  });
  it('lets the owner list only a query constrained to their own tickets', async () => {
    await createTicket();
    await assertSucceeds(getDocs(query(collection(db(), 'supportTickets'), where('userId', '==', UID))));
    await assertFails(getDocs(collection(db(), 'supportTickets')));
  });
  it('prevents users from impersonating administrators', async () => {
    const { ticket } = await createTicket(); const reply = doc(collection(ticket, 'messages'));
    await assertFails(setDoc(reply, messageData({ senderType: 'ADMIN' })));
  });
  it('rejects forged attachment metadata', async () => {
    const owner = db(); const ticket = doc(collection(owner, 'supportTickets')); const message = doc(collection(ticket, 'messages'));
    const batch = writeBatch(owner);
    batch.set(ticket, ticketData(ticket.id, { attachmentsCount: 1 }));
    batch.set(message, messageData({ attachments: [{ url: 'https://example.com/file', path: 'users/mallory/support/other/attachments/file.jpg', type: 'IMAGE' }] }));
    await assertFails(batch.commit());
  });
  it('prevents a regular user from promoting their own account', async () => {
    await seedUserRole(UID, 'user');
    await assertFails(updateDoc(doc(db(), 'users', UID), {
      'metadata.role': 'admin',
      'metadata.updatedAt': serverTimestamp(),
    }));
  });

  it('prevents account creation with an administrative role', async () => {
    const uid = 'self-proclaimed-admin';
    await assertFails(setDoc(doc(db(uid), 'users', uid), {
      profile: { name: 'Fake Admin', email: `${uid}@example.com` },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: {
        role: 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    }));
  });
});

describe('support administrator', () => {
  beforeEach(async () => seedUserRole(ADMIN_UID, 'admin'));

  it('lists tickets, opens a ticket and reads its messages', async () => {
    const { ticket } = await createTicket();
    const admin = db(ADMIN_UID);
    await assertSucceeds(getDocs(query(collection(admin, 'supportTickets'), orderBy('updatedAt', 'desc'))));
    await assertSucceeds(getDoc(doc(admin, 'supportTickets', ticket.id)));
    await assertSucceeds(getDocs(query(
      collection(admin, 'supportTickets', ticket.id, 'messages'),
      orderBy('createdAt', 'asc'),
    )));
  });

  it('atomically replies and updates the ticket preview', async () => {
    const { ticket } = await createTicket();
    const admin = db(ADMIN_UID);
    const adminTicket = doc(admin, 'supportTickets', ticket.id);
    const reply = doc(collection(adminTicket, 'messages'));
    const now = serverTimestamp();
    const batch = writeBatch(admin);
    batch.set(reply, messageData({
      senderType: 'ADMIN',
      senderId: ADMIN_UID,
      message: 'Recebemos seu relato e estamos verificando.',
      createdAt: now,
    }));
    batch.update(adminTicket, {
      lastMessage: 'Recebemos seu relato e estamos verificando.',
      updatedAt: now,
      lastReplyAt: now,
    });
    await assertSucceeds(batch.commit());
  });

  it('rejects a batch whose message and ticket preview disagree', async () => {
    const { ticket } = await createTicket();
    const admin = db(ADMIN_UID);
    const adminTicket = doc(admin, 'supportTickets', ticket.id);
    const reply = doc(collection(adminTicket, 'messages'));
    const now = serverTimestamp();
    const batch = writeBatch(admin);
    batch.set(reply, messageData({
      senderType: 'ADMIN',
      senderId: ADMIN_UID,
      message: 'Mensagem persistida.',
      createdAt: now,
    }));
    batch.update(adminTicket, {
      lastMessage: 'Preview diferente.',
      updatedAt: now,
      lastReplyAt: now,
    });
    await assertFails(batch.commit());
  });

  it('commits concurrent replies atomically and leaves a preview backed by a message', async () => {
    const secondAdminUid = 'second-support-admin';
    await seedUserRole(secondAdminUid, 'admin');
    const { ticket } = await createTicket();

    function replyBatch(adminUid: string, text: string) {
      const admin = db(adminUid);
      const adminTicket = doc(admin, 'supportTickets', ticket.id);
      const reply = doc(collection(adminTicket, 'messages'));
      const now = serverTimestamp();
      const batch = writeBatch(admin);
      batch.set(reply, messageData({
        senderType: 'ADMIN', senderId: adminUid, message: text, createdAt: now,
      }));
      batch.update(adminTicket, { lastMessage: text, updatedAt: now, lastReplyAt: now });
      return batch.commit();
    }

    const results = await Promise.allSettled([
      replyBatch(ADMIN_UID, 'Primeira resposta concorrente.'),
      replyBatch(secondAdminUid, 'Segunda resposta concorrente.'),
    ]);
    const committed = results.filter((result) => result.status === 'fulfilled').length;
    expect(committed).toBeGreaterThanOrEqual(1);

    const admin = db(ADMIN_UID);
    const ticketSnapshot = await getDoc(doc(admin, 'supportTickets', ticket.id));
    const messageSnapshots = await getDocs(collection(admin, 'supportTickets', ticket.id, 'messages'));
    const adminMessages = messageSnapshots.docs
      .map((snapshot) => snapshot.data())
      .filter((message) => message.senderType === 'ADMIN');
    // A write batch is all-or-nothing: an aborted competing write must not
    // leave its message behind without the matching ticket update.
    expect(adminMessages).toHaveLength(committed);
    expect(adminMessages.map((message) => message.message)).toContain(ticketSnapshot.get('lastMessage'));
    expect(ticketSnapshot.get('lastReplyAt').isEqual(ticketSnapshot.get('updatedAt'))).toBe(true);
  });

  it('changes status, priority and assigns the ticket to itself', async () => {
    const { ticket } = await createTicket();
    const adminTicket = doc(db(ADMIN_UID), 'supportTickets', ticket.id);
    await assertSucceeds(updateDoc(adminTicket, {
      status: 'IN_PROGRESS', updatedAt: serverTimestamp(), closedAt: null,
    }));
    await assertSucceeds(updateDoc(adminTicket, {
      priority: 'CRITICAL', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(adminTicket, {
      assignedTo: ADMIN_UID, updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(adminTicket, {
      status: 'CLOSED', updatedAt: serverTimestamp(), closedAt: serverTimestamp(),
    }));
  });

  it('rejects invalid enums, forged assignment and unrelated field changes', async () => {
    const { ticket } = await createTicket();
    const adminTicket = doc(db(ADMIN_UID), 'supportTickets', ticket.id);
    await assertFails(updateDoc(adminTicket, { status: 'ARCHIVED', updatedAt: serverTimestamp(), closedAt: null }));
    await assertFails(updateDoc(adminTicket, { priority: 'URGENT', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(adminTicket, { assignedTo: 'another-admin', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(adminTicket, { userId: ADMIN_UID, updatedAt: serverTimestamp() }));
  });

  it('rejects a standalone or forged admin message', async () => {
    const { ticket } = await createTicket();
    const messages = collection(db(ADMIN_UID), 'supportTickets', ticket.id, 'messages');
    await assertFails(setDoc(doc(messages), messageData({
      senderType: 'ADMIN', senderId: ADMIN_UID, message: 'Resposta sem atualização atômica.',
    })));
    await assertFails(setDoc(doc(messages), messageData({
      senderType: 'ADMIN', senderId: UID, message: 'Identidade administrativa forjada.',
    })));
  });

  it('cannot create tickets for others, delete tickets, edit messages, or read unrelated profiles', async () => {
    const { ticket, message } = await createTicket();
    const admin = db(ADMIN_UID);
    const forbiddenTicket = doc(collection(admin, 'supportTickets'));
    await assertFails(setDoc(forbiddenTicket, ticketData(forbiddenTicket.id)));
    await assertFails(deleteDoc(doc(admin, 'supportTickets', ticket.id)));
    await assertFails(updateDoc(doc(admin, 'supportTickets', ticket.id, 'messages', message.id), { readAt: serverTimestamp() }));
    await assertFails(getDoc(doc(admin, 'users', UID)));
  });

  it('uses the mobile profile and preferences flows without changing its role', async () => {
    const admin = db(ADMIN_UID);
    const profile = doc(admin, 'users', ADMIN_UID);
    await assertSucceeds(updateDoc(profile, {
      'profile.name': 'Support Admin Renamed',
      'preferences.language': 'en',
      'preferences.units': 'imperial',
      'metadata.updatedAt': serverTimestamp(),
    }));
    expect((await getDoc(profile)).get('metadata.role')).toBe('admin');

    await assertFails(updateDoc(profile, {
      'metadata.role': 'user',
      'metadata.updatedAt': serverTimestamp(),
    }));
  });
});

describe('support V2 backend authority and ownership', () => {
  async function seedCase() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const firestore = ctx.firestore();
      await setDoc(doc(firestore, 'supportCases', 'case-v2-001'), {
        id: 'case-v2-001', ownerUid: UID, userName: 'Alice', userEmail: 'alice@example.com',
        type: 'SUPPORT', subject: 'Preciso de ajuda', state: 'CHAT_OPEN', mode: 'CHAT',
        priority: 'NORMAL', lastMessage: 'Mensagem inicial segura', lastMessageAt: Timestamp.now(),
        lastSenderType: 'USER', unreadByUserCount: 0, attachmentCount: 0,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(), closedAt: null, purgeAt: null,
        schemaVersion: 2,
      });
      await setDoc(doc(firestore, 'supportCases', 'case-v2-001', 'messages', 'message-v2-001'), {
        senderType: 'USER', senderId: UID, message: 'Mensagem inicial segura', attachments: [],
        createdAt: Timestamp.now(), readAt: null, requestId: 'request_001',
      });
    });
  }

  beforeEach(seedCase);

  it('allows only the owner query and blocks cross-user enumeration', async () => {
    await assertSucceeds(getDocs(query(collection(db(), 'supportCases'), where('ownerUid', '==', UID))));
    await assertFails(getDocs(collection(db(), 'supportCases')));
    await assertFails(getDoc(doc(db('mallory'), 'supportCases', 'case-v2-001')));
    await assertFails(getDocs(collection(db('mallory'), 'supportCases', 'case-v2-001', 'messages')));
  });

  it('denies every direct case/message mutation, including forged admin messages and read receipts', async () => {
    const owner = db();
    await assertFails(setDoc(doc(collection(owner, 'supportCases')), { ownerUid: UID }));
    await assertFails(updateDoc(doc(owner, 'supportCases', 'case-v2-001'), { state: 'CHAT_CLOSED' }));
    await assertFails(setDoc(doc(collection(owner, 'supportCases', 'case-v2-001', 'messages')), {
      senderType: 'ADMIN', senderId: UID, message: 'forged', createdAt: serverTimestamp(), readAt: null,
    }));
    await assertFails(updateDoc(doc(owner, 'supportCases', 'case-v2-001', 'messages', 'message-v2-001'), { readAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(owner, 'supportCases', 'case-v2-001')));
  });

  it('allows an active admin to read but never directly mutate V2', async () => {
    await seedUserRole(ADMIN_UID, 'admin');
    const admin = db(ADMIN_UID);
    await assertSucceeds(getDoc(doc(admin, 'supportCases', 'case-v2-001')));
    await assertSucceeds(getDocs(collection(admin, 'supportCases', 'case-v2-001', 'messages')));
    await assertFails(updateDoc(doc(admin, 'supportCases', 'case-v2-001'), { state: 'CLOSED_SINGLE' }));
    await assertFails(setDoc(doc(collection(admin, 'supportCases', 'case-v2-001', 'messages')), { senderType: 'ADMIN' }));
  });

  it('blocks an owner immediately after an account-deletion lock appears', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'accountDeletionLocks', UID), { createdAt: Timestamp.now() }));
    await assertFails(getDoc(doc(db(), 'supportCases', 'case-v2-001')));
  });

  it('keeps upload sessions and rate counters completely private', async () => {
    await assertFails(getDoc(doc(db(), 'supportUploadSessions', 'upload_001')));
    await assertFails(setDoc(doc(db(), 'supportUploadSessions', 'upload_001'), { ownerUid: UID }));
    await assertFails(getDoc(doc(db(), 'supportRateLimits', `${UID}_chat-message`)));
  });
});
