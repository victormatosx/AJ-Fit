import { describe, expect, it, vi } from 'vitest';

import { collectRecentPrescriptionSessions } from '../../prescriptionEvolution/recentPrescriptionHistory';

function session(id: string) {
  return [{ name: id, exercises: [] }] as never;
}

function chain(length: number) {
  return new Map(Array.from({ length }, (_, index) => {
    const number = index + 1;
    return [`instance-${number}`, {
      programInstanceId: `instance-${number}`,
      contentIdentity: `program-${number}`,
      previousProgramInstanceId: number > 1 ? `instance-${number - 1}` : null,
    }];
  }));
}

describe('loadRecentPrescriptionSessions bounded chain traversal', () => {
  it('returns no prior sessions for a single-instance account', async () => {
    const loadInstance = vi.fn();
    const loadProgramSessions = vi.fn();
    await expect(collectRecentPrescriptionSessions({
      uid: 'new-account', previousProgramInstanceId: null, maximumSessions: 2,
      loadInstance, loadProgramSessions,
    })).resolves.toEqual([]);
    expect(loadInstance).not.toHaveBeenCalled();
    expect(loadProgramSessions).not.toHaveBeenCalled();
  });

  it('reads exactly the two anti-ping-pong predecessors from a 100-instance account', async () => {
    const instances = chain(100);
    const loadInstance = vi.fn(async (_uid: string, id: string) => instances.get(id) as never);
    const loadProgram = vi.fn(async (_uid: string, id: string) => session(id));

    const result = await collectRecentPrescriptionSessions({
      uid: 'old-account', previousProgramInstanceId: 'instance-99', maximumSessions: 2,
      loadInstance, loadProgramSessions: loadProgram,
    });

    expect(result).toEqual([session('program-99'), session('program-98')]);
    expect(loadInstance.mock.calls.map((call) => call[1])).toEqual(['instance-99', 'instance-98']);
    expect(loadProgram.mock.calls.map((call) => call[1])).toEqual(['program-99', 'program-98']);
  });

  it('stops safely at an interrupted previousProgramInstanceId link', async () => {
    const loadInstance = vi.fn(async () => null);
    const loadProgram = vi.fn();
    await expect(collectRecentPrescriptionSessions({
      uid: 'broken-account', previousProgramInstanceId: 'missing', maximumSessions: 2,
      loadInstance, loadProgramSessions: loadProgram,
    })).resolves.toEqual([]);
    expect(loadInstance).toHaveBeenCalledOnce();
    expect(loadProgram).not.toHaveBeenCalled();
  });

  it('preserves the old behavior for a missing program snapshot by continuing down the chain', async () => {
    const instances = chain(4);
    const loadInstance = vi.fn(async (_uid: string, id: string) => instances.get(id) as never);
    const loadProgram = vi.fn(async (_uid: string, id: string) => id === 'program-3' ? null : session(id));
    const result = await collectRecentPrescriptionSessions({
      uid: 'legacy-account', previousProgramInstanceId: 'instance-3', maximumSessions: 2,
      loadInstance, loadProgramSessions: loadProgram,
    });
    expect(result).toEqual([session('program-2'), session('program-1')]);
    expect(loadInstance).toHaveBeenCalledTimes(3);
  });

  it('returns the same recent window on a retry, including superseded/adaptation instances', async () => {
    const instances = chain(3);
    const loaders = {
      loadInstance: vi.fn(async (_uid: string, id: string) => instances.get(id) as never),
      loadProgram: vi.fn(async (_uid: string, id: string) => session(id)),
    };
    const input = {
      uid: 'retry-account', previousProgramInstanceId: 'instance-3', maximumSessions: 2,
      loadInstance: loaders.loadInstance, loadProgramSessions: loaders.loadProgram,
    };
    const first = await collectRecentPrescriptionSessions(input);
    const retry = await collectRecentPrescriptionSessions(input);
    expect(retry).toEqual(first);
    expect(first).toEqual([session('program-3'), session('program-2')]);
  });

  it('preserves repeated content as two distinct recent instance entries at the window boundary', async () => {
    const instances = new Map([
      ['adaptation', { contentIdentity: 'repeated-content', previousProgramInstanceId: 'evolution' }],
      ['evolution', { contentIdentity: 'repeated-content', previousProgramInstanceId: 'older' }],
      ['older', { contentIdentity: 'older-content', previousProgramInstanceId: null }],
    ]);
    const loadInstance = vi.fn(async (_uid: string, id: string) => instances.get(id) ?? null);
    const loadProgramSessions = vi.fn(async (_uid: string, id: string) => session(id));
    const result = await collectRecentPrescriptionSessions({
      uid: 'repeated-account', previousProgramInstanceId: 'adaptation', maximumSessions: 2,
      loadInstance, loadProgramSessions,
    });
    expect(result).toEqual([session('repeated-content'), session('repeated-content')]);
    expect(loadInstance.mock.calls.map((call) => call[1])).toEqual(['adaptation', 'evolution']);
  });
});
