import { describe, expect, it } from 'vitest';
import {
  addOptimisticMessage,
  createOptimisticMessage,
  reconcileOptimisticMessages,
  retryOptimisticMessage,
  setOptimisticStatus,
  setOptimisticUploadId,
  type OptimisticSupportMessage,
} from '../supportChatOptimistic';

describe('createOptimisticMessage', () => {
  it('starts a fresh entry in SENDING with the given requestId, message and attachment', () => {
    const item = createOptimisticMessage('req-1', 'Olá', { uri: 'file:///a.jpg' }, 1000);
    expect(item).toEqual({
      requestId: 'req-1', message: 'Olá', attachment: { uri: 'file:///a.jpg' }, status: 'SENDING', createdAtMs: 1000,
    });
  });
});

describe('addOptimisticMessage', () => {
  it('appends a new entry, preserving arrival order', () => {
    const a = createOptimisticMessage('req-1', 'primeira', null, 1);
    const b = createOptimisticMessage('req-2', 'segunda', null, 2);
    const list = addOptimisticMessage(addOptimisticMessage([], a), b);
    expect(list.map((item) => item.requestId)).toEqual(['req-1', 'req-2']);
  });

  it('never adds a second entry for the same requestId (double-tap guard)', () => {
    const a = createOptimisticMessage('req-1', 'primeira', null, 1);
    const duplicate = createOptimisticMessage('req-1', 'primeira', null, 5);
    const list = addOptimisticMessage(addOptimisticMessage([], a), duplicate);
    expect(list).toHaveLength(1);
    expect(list[0]?.createdAtMs).toBe(1);
  });
});

describe('setOptimisticStatus', () => {
  it('transitions SENDING -> SENT for the matching requestId only', () => {
    const list = [
      createOptimisticMessage('req-1', 'a', null, 1),
      createOptimisticMessage('req-2', 'b', null, 2),
    ];
    const next = setOptimisticStatus(list, 'req-1', 'SENT');
    expect(next.find((item) => item.requestId === 'req-1')?.status).toBe('SENT');
    expect(next.find((item) => item.requestId === 'req-2')?.status).toBe('SENDING');
  });

  it('transitions SENDING -> FAILED on error', () => {
    const list = [createOptimisticMessage('req-1', 'a', null, 1)];
    const next = setOptimisticStatus(list, 'req-1', 'FAILED');
    expect(next[0]?.status).toBe('FAILED');
  });
});

describe('setOptimisticUploadId', () => {
  it('caches the uploadId on the matching entry only, for reuse on retry', () => {
    const list = [
      createOptimisticMessage('req-1', '', { uri: 'file:///a.jpg' }, 1),
      createOptimisticMessage('req-2', '', { uri: 'file:///b.jpg' }, 2),
    ];
    const next = setOptimisticUploadId(list, 'req-1', 'upload-1');
    expect(next.find((item) => item.requestId === 'req-1')?.uploadId).toBe('upload-1');
    expect(next.find((item) => item.requestId === 'req-2')?.uploadId).toBeUndefined();
  });
});

describe('retryOptimisticMessage', () => {
  it('moves a FAILED entry back to SENDING, keeping the same requestId and cached uploadId', () => {
    let list: OptimisticSupportMessage[] = [createOptimisticMessage('req-1', '', { uri: 'file:///a.jpg' }, 1)];
    list = setOptimisticUploadId(list, 'req-1', 'upload-1');
    list = setOptimisticStatus(list, 'req-1', 'FAILED');

    const retried = retryOptimisticMessage(list, 'req-1');
    expect(retried[0]).toMatchObject({ requestId: 'req-1', status: 'SENDING', uploadId: 'upload-1' });
  });

  it('is a no-op for an entry that is not currently FAILED (guards a double tap on retry)', () => {
    const list = [createOptimisticMessage('req-1', '', null, 1)]; // status: SENDING
    const retried = retryOptimisticMessage(list, 'req-1');
    expect(retried).toEqual(list);
  });
});

describe('reconcileOptimisticMessages', () => {
  it('drops a SENDING entry the instant the listener delivers the persisted message with the same requestId', () => {
    const list = [createOptimisticMessage('req-1', 'a', null, 1)];
    const next = reconcileOptimisticMessages(list, new Set(['req-1']));
    expect(next).toHaveLength(0);
  });

  it('drops a SENT entry once reconciled (callable responded before the listener)', () => {
    let list = [createOptimisticMessage('req-1', 'a', null, 1)];
    list = setOptimisticStatus(list, 'req-1', 'SENT');
    const next = reconcileOptimisticMessages(list, new Set(['req-1']));
    expect(next).toHaveLength(0);
  });

  it('drops a FAILED entry once reconciled — commit-but-timeout: the listener proves it actually sent', () => {
    let list = [createOptimisticMessage('req-1', 'a', null, 1)];
    list = setOptimisticStatus(list, 'req-1', 'FAILED');
    const next = reconcileOptimisticMessages(list, new Set(['req-1']));
    expect(next).toHaveLength(0);
  });

  it('leaves unrelated pending entries untouched and in order', () => {
    const list = [
      createOptimisticMessage('req-1', 'a', null, 1),
      createOptimisticMessage('req-2', 'b', null, 2),
    ];
    const next = reconcileOptimisticMessages(list, new Set(['req-1']));
    expect(next.map((item) => item.requestId)).toEqual(['req-2']);
  });

  it('never matches by text or timestamp — only requestId', () => {
    const list = [createOptimisticMessage('req-1', 'mesmo texto', null, 1000)];
    // A persisted message with different requestId, same text/near timestamp must NOT reconcile.
    const next = reconcileOptimisticMessages(list, new Set(['req-other']));
    expect(next).toHaveLength(1);
  });

  it('is a stable no-op (same array identity content) when nothing reconciles', () => {
    const list = [createOptimisticMessage('req-1', 'a', null, 1)];
    const next = reconcileOptimisticMessages(list, new Set());
    expect(next).toEqual(list);
  });
});
