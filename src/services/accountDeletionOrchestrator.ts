import { httpsCallable } from 'firebase/functions';

import { auth } from '../lib/firebase';
import { getReauthenticationProviders } from '../lib/authProviders';
import { functions } from '../lib/firebaseFunctions';
import { revokeGoogleProviderAccess } from './accountDeletionProviderRevocation';

/**
 * The COMMIT BOUNDARY for "Excluir Conta" — Fase 3/5 correction (see
 * docs/25_exclusao_de_conta_arquitetura.md's "Correção Fases 3/5" section),
 * updated by Fase 16 (Apple prompt consolidation).
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
 *      backend has no way to revoke Google itself. UNCHANGED by Fase 16.
 *   2. Apple — Fase 16 CORRECTION: this orchestrator no longer opens a
 *      native Apple sheet itself. `preparedAppleAuthorizationCode` is
 *      material the caller (`useAccountDeletionFlow.ts`) already captured
 *      during `accountDeletionReauth.ts`'s `startAccountDeletionReauthentication`
 *      — the SAME Apple sign-in that established Firebase recent-auth. If
 *      the account has `apple.com` linked and no material was handed in,
 *      this returns `apple-material-missing` rather than opening Apple
 *      itself — the caller must send the user back through reauth to
 *      capture fresh material, never silently prompt mid-commit.
 *   3. `requestAccountDeletion` itself, carrying `appleAuthorizationCode`
 *      when step 2 produced one. The backend exchanges it server-side,
 *      inside the SAME call, before ever creating a deletion record
 *      (`functions/src/accountDeletion/requestAccountDeletion.ts`) —
 *      unchanged wire contract, so no backend change was needed for Fase 16.
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
  /** Fase 16: the account has `apple.com` linked but no Apple material was handed in — the caller must send the user back through reauth, this function never opens Apple to recover. */
  | { status: 'apple-material-missing' }
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

export async function requestAccountDeletionWithProviderPreparation(
  preparedAppleAuthorizationCode: string | null,
): Promise<AccountDeletionOrchestrationResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) return { status: 'identity-changed' };
  const uid = currentUser.uid;

  // ── 1. Google — client-only, must resolve before the request. UNCHANGED. ──
  const googleResult = await revokeGoogleProviderAccess(uid);
  if (googleResult.status === 'identity-changed') return { status: 'identity-changed' };
  if (googleResult.status === 'failed' || googleResult.status === 'revoked-unlink-failed') {
    return { status: 'google-revocation-failed' };
  }
  // 'not-linked' or 'revoked' — safe to proceed.

  // ── 2. Apple — Fase 16: CONSUME already-prepared material, never open
  // Apple here. `apple.com` may still be linked even if this attempt's
  // reauth used a different provider (a dual-linked account) — the backend
  // still requires material whenever apple.com is linked, regardless of
  // which provider satisfied recent-auth.
  if (getReauthenticationProviders(currentUser).includes('apple') && !preparedAppleAuthorizationCode) {
    return { status: 'apple-material-missing' };
  }

  // ── 3. COMMIT — requestAccountDeletion. ──
  try {
    const call = httpsCallable(functions, 'requestAccountDeletion');
    const payload = preparedAppleAuthorizationCode
      ? { appleAuthorizationCode: preparedAppleAuthorizationCode }
      : {};
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
