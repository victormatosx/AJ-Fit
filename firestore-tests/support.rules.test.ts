import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
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
});
