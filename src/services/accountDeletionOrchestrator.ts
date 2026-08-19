import { httpsCallable } from 'firebase/functions';

import { auth } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import {
  prepareAppleProviderRevocationMaterial,
  revokeGoogleProviderAccess,
} from './accountDeletionProviderRevocation';

/**
 * The COMMIT BOUNDARY for "Excluir Conta" — Fase 3/5 correction (see
 * docs/25_exclusao_de_conta_arquitetura.md's "Correção Fases 3/5" section).
 *
 * This is the ONLY function that may call the `requestAccountDeletion`
 * callable. It sequences every interactive/client-dependent step that MUST
 * happen before the backend accepts the request, so that once this function
 * resolves with `{status: 'accepted'}`, the client is no longer required
 * for anything — see the backend's own integration proof
 * (`functions/src/accountDeletion/__tests__/backendAutonomy.integration.test.ts`).
 *
 * ORDER (deliberate):
 *   1. Google — `revokeGoogleProviderAccess` (client-only revoke + Firebase
 *      `unlink`, Fase 3/5 correction). Must complete (or determine the
 *      account has no Google linked) BEFORE the request, because the
 *      backend has no way to revoke Google itself.
 *   2. Apple — `prepareAppleProviderRevocationMaterial` (fresh
 *      `authorizationCode` capture only — no backend call yet).
 *   3. `requestAccountDeletion` itself, carrying `appleAuthorizationCode`
 *      when step 2 produced one. The backend exchanges it server-side,
 *      inside the SAME call, before ever creating a deletion record
 *      (`functions/src/accountDeletion/requestAccountDeletion.ts`).
 *
 * Deliberately NOT implemented here (out of scope for this correction, see
 * the phase's own rules): no screen, no confirmation UI, no call to
 * `finalizeAccountDeletionClientShutdown` (Fase 5/11) — a future Fase 12
 * screen owns presenting this flow and calling shutdown/logout afterward.
 * This function's contract ends at "the backend has durably accepted the
 * deletion, or it has not".
 */

export type AccountDeletionOrchestrationResult =
  | { status: 'accepted'; deletionId: string; deduplicated: boolean; requiresReconciliation: boolean }
  | { status: 'identity-changed' }
  | { status: 'google-revocation-failed' }
  | { status: 'apple-preparation-cancelled' }
  | { status: 'apple-preparation-unavailable' }
  | { status: 'request-failed'; code: string };

/** Firebase prefixes callable error codes with `functions/`. Accept both — same convention as `services/photoVault.ts`. */
function callableCode(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
}

interface RequestAccountDeletionResponse {
  deletionId: string;
  status: string;
  accepted: boolean;
  deduplicated: boolean;
  requiresReconciliation: boolean;
}

function isValidResponse(data: unknown): data is RequestAccountDeletionResponse {
  const d = data as Partial<RequestAccountDeletionResponse> | null;
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof d.deletionId === 'string' &&
    typeof d.accepted === 'boolean' &&
    typeof d.deduplicated === 'boolean'
  );
}

export async function requestAccountDeletionWithProviderPreparation(): Promise<AccountDeletionOrchestrationResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) return { status: 'identity-changed' };
  const uid = currentUser.uid;

  // ── 1. Google — client-only, must resolve before the request. ──
  const googleResult = await revokeGoogleProviderAccess(uid);
  if (googleResult.status === 'identity-changed') return { status: 'identity-changed' };
  if (googleResult.status === 'failed' || googleResult.status === 'revoked-unlink-failed') {
    return { status: 'google-revocation-failed' };
  }
  // 'not-linked' or 'revoked' — safe to proceed.

  // ── 2. Apple — fresh material capture only, no backend call yet. ──
  const appleResult = await prepareAppleProviderRevocationMaterial(uid);
  if (appleResult.status === 'identity-changed') return { status: 'identity-changed' };
  if (appleResult.status === 'cancelled') return { status: 'apple-preparation-cancelled' };
  if (appleResult.status === 'unavailable') return { status: 'apple-preparation-unavailable' };
  // 'not-linked' or 'ready' — safe to proceed.

  // ── 3. COMMIT — requestAccountDeletion. ──
  try {
    const call = httpsCallable(functions, 'requestAccountDeletion');
    const payload = appleResult.status === 'ready' ? { appleAuthorizationCode: appleResult.authorizationCode } : {};
    const response = await call(payload);
    if (!isValidResponse(response.data)) {
      return { status: 'request-failed', code: 'invalid-response' };
    }
    return {
      status: 'accepted',
      deletionId: response.data.deletionId,
      deduplicated: response.data.deduplicated,
      requiresReconciliation: response.data.requiresReconciliation === true,
    };
  } catch (err) {
    return { status: 'request-failed', code: callableCode(err) || 'unknown' };
  }
}
