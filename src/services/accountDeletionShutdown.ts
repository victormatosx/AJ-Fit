import { clearOnboardingDraft } from '../onboarding/draftStorage';
import { removeCachedThumbnailsForUser } from './photoVaultEncryptedCache';
import { clearWorkoutSubstitutionPreferences } from './workoutSubstitutionsStorage';
import { clearStoredUnitsPreference } from '../units/unitsStorage';

/**
 * Client-side shutdown after `requestAccountDeletion` has durably accepted
 * a deletion — Fase 5 ("Bloqueio imediato da conta").
 *
 * Deliberately THIN. The audit for this phase found that most of what a
 * naive reading of the task might suggest building already exists, tested,
 * and wired correctly:
 *
 *   - RevenueCat logout + listener detach: `SubscriptionContext` already
 *     reacts to `useAuth().user` becoming `null` and calls
 *     `logoutRevenueCat()` + `detachCustomerInfoListener()` on its own
 *     (`src/state/SubscriptionContext.tsx`) — nothing new to build.
 *   - Secure session + Photo Vault key: `signOutUser()`
 *     (`src/services/auth.ts`), already called by `AuthContext.logout()`,
 *     already clears the encrypted session envelope's key
 *     (`clearSecureAuthSession()`) and deletes the local Vault key
 *     (`deleteVaultKey(uid)`), best-effort.
 *   - Navigation: `App.tsx` gates its ENTIRE screen tree declaratively on
 *     `useAuth()`'s `user` — once `user` becomes `null`, every private
 *     screen unmounts from the React tree (not just a stack entry hidden
 *     behind a nav push), and `AuthScreen` renders. There is no private
 *     route left for back-navigation to return to; nothing new to build.
 *
 * What was NOT already covered, and is genuinely new here: the encrypted
 * Photo Vault THUMBNAIL cache (a separate on-disk cache from the vault key
 * itself, see `photoVaultEncryptedCache.ts`) and the onboarding draft are
 * not cleared by ordinary logout (correctly — logout is not "this account
 * is being permanently deleted"). For an ACCEPTED deletion specifically,
 * clearing them now, on the device, rather than waiting for the remote
 * hard-delete phases, is strictly more defensive.
 *
 * Fase 11 audit finding: `WorkoutScreen`'s "permanent" exercise-substitution
 * preferences (`ajfit-subs`, `workoutSubstitutionsStorage.ts`) are stored
 * under a single global AsyncStorage key with no uid namespace and no
 * per-uid reconciliation. `WorkoutScreen` has no uid of its own today (it is
 * not yet wired to a per-user Firestore workout document), so the only
 * available fix at this layer is clearing the key outright on deletion — the
 * same treatment as the onboarding draft.
 *
 * Fase 11 audit finding: the local `units` preference (`ajfit-units-preference`,
 * `units/unitsStorage.ts`) IS reconciled by uid on every login
 * (`reconcileUnitsOnLoad` refuses to apply a pending value stamped with a
 * different uid), so it is not a full cross-account leak — but that self-heal
 * only takes effect once reconciliation actually runs. Clearing it here too
 * removes the race window entirely for the deletion path specifically,
 * rather than relying on the next login's reconciliation to overwrite it
 * first. `language` (`i18n/languageStorage.ts`) is deliberately excluded —
 * its own doc comment documents that logout/deletion must NOT clear it (the
 * outgoing user's chosen UI language intentionally stays as the pre-auth
 * default).
 *
 * Fase 11 §31/§60 gate ("Conta A → Conta B" on the same device) is not
 * limited to the deletion path — this cleanup point is exercised any time
 * deletion is accepted, but a PLAIN account switch without deletion still
 * relies on `photoVaultEncryptedCache.ts`/`photoVaultGallery.ts`'s own
 * identity-change effects (`PhotoVaultContext.tsx`) for the Photo Vault
 * surface, and on `reconcileUnitsOnLoad`/`reconcileLanguageOnLoad` for
 * units/language. `ajfit-subs` remains a known residual gap for a plain
 * account switch (not full deletion) until `WorkoutScreen` is wired to a
 * real per-user data model — documented here rather than silently left
 * unaddressed.
 *
 * Local cleanup runs FIRST and best-effort (each call independent, one
 * failure never blocks the others or blocks `logout`) — Fase 5 §52: local
 * cleanup does not depend on network/Firebase state succeeding, so it
 * should not be blocked by (or block) it either. `logout` is awaited last;
 * if it throws, the caller is still responsible for forcing the user out of
 * any private UI state — the backend lock (Fase 5's Firestore/Storage Rules
 * gate) is already the authority regardless of whether this client-side
 * step fully completes (Fase 5 §63).
 */
export async function finalizeAccountDeletionClientShutdown(
  uid: string,
  logout: () => Promise<void>,
): Promise<void> {
  await Promise.allSettled([
    Promise.resolve().then(() => removeCachedThumbnailsForUser(uid)),
    clearOnboardingDraft(),
    clearWorkoutSubstitutionPreferences(),
    clearStoredUnitsPreference(),
  ]);

  await logout();
}
