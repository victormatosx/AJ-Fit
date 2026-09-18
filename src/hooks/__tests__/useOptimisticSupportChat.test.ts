import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavioral coverage for the Support V2 optimistic-send wiring (perf audit,
 * 2026-09-17), exercised via `createOptimisticSupportChatController` — the
 * plain, React-free core behind `useOptimisticSupportChat` — with the
 * backend service mocked. This is where "falha real", "retry reusa o mesmo
 * requestId/uploadId sem reenviar o anexo" and "duplo toque" are actually
 * exercised end-to-end, on top of the pure reducer tests in
 * `src/lib/__tests__/supportChatOptimistic.test.ts`. `SupportCaseDetailScreen`
 * itself can't be rendered in this project's test suite (no React Native
 * test renderer), which is exactly why this logic was extracted out of it.
 */
const mocks = vi.hoisted(() => ({
  requestIdCounter: 0,
  requestId: vi.fn(),
  sendSupportChatMessage: vi.fn(),
  stageSupportChatAttachment: vi.fn(),
}));

vi.mock('../../services/supportCases', () => ({
  requestId: mocks.requestId,
  sendSupportChatMessage: mocks.sendSupportChatMessage,
  stageSupportChatAttachment: mocks.stageSupportChatAttachment,
}));

import { createOptimisticSupportChatController } from '../useOptimisticSupportChat';
import type { OptimisticSupportMessage } from '../../lib/supportChatOptimistic';

function nextRequestId() {
  mocks.requestIdCounter += 1;
  return `req-${mocks.requestIdCounter}`;
}

function harness(caseId = 'case-1') {
  let pending: OptimisticSupportMessage[] = [];
  const controller = createOptimisticSupportChatController(caseId, () => pending, (next) => { pending = next; });
  return { controller, getPending: () => pending };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.requestIdCounter = 0;
});

describe('createOptimisticSupportChatController', () => {
  it('shows the bubble as SENDING immediately, before the callable resolves', () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.sendSupportChatMessage.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { controller, getPending } = harness();

    controller.send('Olá suporte', null);

    expect(getPending()).toHaveLength(1);
    expect(getPending()[0]).toMatchObject({ message: 'Olá suporte', status: 'SENDING' });
  });

  it('transitions SENDING -> SENT once the callable resolves (text only)', async () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.sendSupportChatMessage.mockResolvedValue({ messageId: 'msg-1' });
    const { controller, getPending } = harness();

    controller.send('Só texto', null);
    await flushMicrotasks();

    expect(getPending()[0]?.status).toBe('SENT');
    expect(mocks.stageSupportChatAttachment).not.toHaveBeenCalled();
    expect(mocks.sendSupportChatMessage).toHaveBeenCalledWith(
      'case-1', 'Só texto', undefined, { requestId: 'req-1', stagedUploadId: undefined },
    );
  });

  it('stages the attachment once, then sends with the resulting uploadId (image only)', async () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.stageSupportChatAttachment.mockResolvedValue('upload-1');
    mocks.sendSupportChatMessage.mockResolvedValue({ messageId: 'msg-1' });
    const { controller, getPending } = harness();

    controller.send('', { uri: 'file:///a.jpg' });
    await flushMicrotasks();

    expect(getPending()[0]?.status).toBe('SENT');
    expect(mocks.stageSupportChatAttachment).toHaveBeenCalledTimes(1);
    expect(mocks.sendSupportChatMessage).toHaveBeenCalledWith(
      'case-1', '', undefined, { requestId: 'req-1', stagedUploadId: 'upload-1' },
    );
  });

  it('sends text + image together, staging before the message callable', async () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.stageSupportChatAttachment.mockResolvedValue('upload-1');
    mocks.sendSupportChatMessage.mockResolvedValue({ messageId: 'msg-1' });
    const { controller, getPending } = harness();

    controller.send('Segue o print', { uri: 'file:///a.jpg' });
    await flushMicrotasks();

    expect(getPending()[0]?.status).toBe('SENT');
    expect(mocks.sendSupportChatMessage).toHaveBeenCalledWith(
      'case-1', 'Segue o print', undefined, { requestId: 'req-1', stagedUploadId: 'upload-1' },
    );
  });

  it('a real failure marks the bubble FAILED, not silently dropped', async () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.sendSupportChatMessage.mockRejectedValue(new Error('functions/unavailable'));
    const { controller, getPending } = harness();

    controller.send('vai falhar', null);
    await flushMicrotasks();

    expect(getPending()[0]?.status).toBe('FAILED');
  });

  it('retry reuses the exact same requestId and never re-stages an already-uploaded attachment', async () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.stageSupportChatAttachment.mockResolvedValue('upload-1');
    mocks.sendSupportChatMessage.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ messageId: 'msg-1' });
    const { controller, getPending } = harness();

    controller.send('', { uri: 'file:///a.jpg' });
    await flushMicrotasks();
    expect(getPending()[0]?.status).toBe('FAILED');
    expect(mocks.stageSupportChatAttachment).toHaveBeenCalledTimes(1);

    controller.retry(getPending()[0]!);
    await flushMicrotasks();

    expect(getPending()[0]?.status).toBe('SENT');
    // Same requestId both times, attachment staged only once total.
    expect(mocks.sendSupportChatMessage).toHaveBeenNthCalledWith(1, 'case-1', '', undefined, { requestId: 'req-1', stagedUploadId: 'upload-1' });
    expect(mocks.sendSupportChatMessage).toHaveBeenNthCalledWith(2, 'case-1', '', undefined, { requestId: 'req-1', stagedUploadId: 'upload-1' });
    expect(mocks.stageSupportChatAttachment).toHaveBeenCalledTimes(1);
  });

  it('retry is a no-op while the bubble is still SENDING (guards a double click on retry)', async () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.sendSupportChatMessage.mockReturnValue(new Promise(() => {}));
    const { controller, getPending } = harness();

    controller.send('ainda enviando', null);
    const sendingItem = getPending()[0]!;
    controller.retry(sendingItem);

    expect(mocks.sendSupportChatMessage).toHaveBeenCalledTimes(1);
    expect(getPending()[0]?.status).toBe('SENDING');
  });

  it('two rapid, distinct sends both go through — the guard only blocks re-entrancy within a single call, not back-to-back new messages', () => {
    mocks.requestId.mockImplementation(nextRequestId);
    mocks.sendSupportChatMessage.mockReturnValue(new Promise(() => {}));
    const { controller, getPending } = harness();

    const first = controller.send('mensagem um', null);
    const second = controller.send('mensagem dois', null);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(getPending()).toHaveLength(2);
    expect(mocks.sendSupportChatMessage).toHaveBeenCalledTimes(2);
  });

  it('sending an empty draft with no attachment is rejected, never reaches the callable', () => {
    mocks.requestId.mockImplementation(nextRequestId);
    const { controller, getPending } = harness();

    const accepted = controller.send('   ', null);

    expect(accepted).toBe(false);
    expect(getPending()).toHaveLength(0);
    expect(mocks.sendSupportChatMessage).not.toHaveBeenCalled();
  });
});
