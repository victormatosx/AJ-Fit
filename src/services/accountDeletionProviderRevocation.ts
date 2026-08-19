import { unlink } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { getReauthenticationProviders } from '../lib/authProviders';
import { revokeGoogleAccess } from './providers/google';

/**
 * Client-side provider revocation preparation for "Excluir Conta" — Fase 3,
 * corrected by the Fase 3/5 audit (see
 * docs/25_exclusao_de_conta_arquitetura.md's "Correção Fases 3/5" section).
 *
 * Nothing in this module cancels a subscription or disables/deletes an
 * account. `revokeGoogleProviderAccess` feeds into `requestAccountDeletion()`
 * as PRE-COMMIT preparation, called from `accountDeletionOrchestrator.ts`
 * BEFORE the request itself — this is the fix for the gap the Fase 3/5 audit
 * found: previously nothing ever called it, and its doc comment even said
 * the opposite of what's correct (revoke AFTER commit) — see this function's
 * current doc comment for why that was wrong.
 *
 * Google performs the ONLY action that can revoke AJ Fit's Google OAuth
 * grant (`GoogleSignin.revokeAccess()`, client-side, no backend equivalent
 * — Fase 3's own researched conclusion, unchanged) AND unlinks `google.com`
 * from the Firebase Auth user, so that the backend's OWN server-side
 * snapshot (`admin.auth().getUser(uid)`, unchanged since Fase 4) correctly
 * reflects "not linked" the moment `requestAccountDeletion` runs — no
 * client boolean is ever trusted.
 *
 * Apple's equivalent preparation (`prepareAppleProviderRevocationMaterial`)
 * was REMOVED by Fase 16 (Apple prompt consolidation —
 * docs/25_exclusao_de_conta_arquitetura.md's Fase 16 section): capturing
 * Apple's `authorizationCode` moved into `accountDeletionReauth.ts`'s
 * `startAccountDeletionReauthentication`, the SAME native Apple sign-in
 * that already proves Firebase recent-auth — a second, dedicated Apple-only
 * sheet here was exactly the redundant prompt Fase 16 eliminated. See that
 * file for Apple's current preparation path.
 */

export type GoogleProviderRevocationResult =
  | { status: 'not-linked' }
  | { status: 'identity-changed' }
  /** Revoke AND unlink both succeeded — the backend's next provider snapshot will correctly show `google.com` absent. */
  | { status: 'revoked' }
  /**
   * Revoke succeeded at Google but the Firebase `unlink()` call itself
   * failed (Fase 3/5 correction §17 — this exact trade-off must be
   * surfaced, never hidden). The caller MUST NOT proceed to
   * `requestAccountDeletion()` in this state: the backend's provider
   * snapshot would still show `google.com` linked (Firebase's own
   * `providerData` is unchanged), which would require Apple-style
   * backend material that does not exist for Google — the exact stuck
   * state this correction exists to prevent. The account is NOT deleted;
   * the caller should let the user retry (retrying re-attempts both calls;
   * `GoogleSignin.revokeAccess()` on an already-revoked grant is safe to
   * call again, and `unlink()` on an already-unlinked provider succeeds
   * trivially the next time around).
   */
  | { status: 'revoked-unlink-failed' }
  | { status: 'failed' };

/**
 * Revokes AJ Fit's Google OAuth grant on this device AND unlinks
 * `google.com` from the Firebase Auth user — Fase 3/5 correction.
 *
 * ORDERING (corrected — the opposite of Fase 3's original assumption):
 * this function must be called BEFORE `requestAccountDeletion()`, never
 * after. The backend has no way to revoke a Google OAuth grant itself
 * (`GoogleSignin.revokeAccess()` has no server-side equivalent — Fase 3's
 * own researched conclusion), so the ONLY way `PROVIDER_REVOCATION`'s
 * Google sub-step can ever reach a terminal state without depending on the
 * client staying open is for it to never need to run an action at all —
 * achieved by making sure `google.com` is already gone from
 * `admin.auth().getUser(uid).providerData` by the time
 * `requestAccountDeletion` takes its snapshot. `initialProviderRevocationSubState`
 * (`functions/src/accountDeletion/providerRevocation/types.ts`, unchanged)
 * already treats "not linked" as `SKIPPED_BY_POLICY` — this function is
 * what makes that condition true, honestly, before the snapshot is ever
 * taken, rather than a client asserting it after the fact.
 */
export async function revokeGoogleProviderAccess(
  expectedUid: string,
): Promise<GoogleProviderRevocationResult> {
  const initialUser = auth.currentUser;
  if (!initialUser || initialUser.uid !== expectedUid) {
    return { status: 'identity-changed' };
  }
  if (!getReauthenticationProviders(initialUser).includes('google')) {
    return { status: 'not-linked' };
  }

  const outcome = await revokeGoogleAccess();

  if (auth.currentUser?.uid !== expectedUid) {
    return { status: 'identity-changed' };
  }
  if (outcome !== 'revoked') {
    return { status: 'failed' };
  }

  try {
    await unlink(auth.currentUser, 'google.com');
  } catch {
    return { status: 'revoked-unlink-failed' };
  }

  if (auth.currentUser?.uid !== expectedUid) {
    return { status: 'identity-changed' };
  }

  return { status: 'revoked' };
}
