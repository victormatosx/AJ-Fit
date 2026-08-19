import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ docs: new Map<string, boolean>() }));

vi.mock('../lib/firebaseAdmin', () => ({
  db: {
    collection(name: string) {
      return {
        doc(id: string) {
          const path = `${name}/${id}`;
          return {
            collection(subName: string) {
              return {
                doc(subId: string) {
                  const subPath = `${path}/${subName}/${subId}`;
                  return {
                    async delete() {
                      state.docs.delete(subPath);
                    },
                    async get() {
                      return { exists: state.docs.has(subPath), data: () => undefined };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { deleteVaultDocument } from '../photoVault/vaultRepository';

beforeEach(() => {
  state.docs.clear();
});

describe('deleteVaultDocument (Fase 12.5)', () => {
  it('removes an existing vault document', async () => {
    state.docs.set('users/uid-1/privateSecurity/photoVault', true);

    await deleteVaultDocument('uid-1');

    expect(state.docs.has('users/uid-1/privateSecurity/photoVault')).toBe(false);
  });

  it('is a no-op, never throws, when the document does not exist', async () => {
    await expect(deleteVaultDocument('uid-1')).resolves.toBeUndefined();
  });

  it('idempotent: deleting twice converges without error', async () => {
    state.docs.set('users/uid-1/privateSecurity/photoVault', true);
    await deleteVaultDocument('uid-1');
    await expect(deleteVaultDocument('uid-1')).resolves.toBeUndefined();
  });

  it("never deletes another uid's vault document", async () => {
    state.docs.set('users/uid-A/privateSecurity/photoVault', true);
    state.docs.set('users/uid-B/privateSecurity/photoVault', true);

    await deleteVaultDocument('uid-A');

    expect(state.docs.has('users/uid-A/privateSecurity/photoVault')).toBe(false);
    expect(state.docs.has('users/uid-B/privateSecurity/photoVault')).toBe(true);
  });
});
