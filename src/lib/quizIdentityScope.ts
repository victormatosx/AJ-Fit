/**
 * Pure decision for `AppStateProvider`'s render-time reset (see the comment
 * there for the full incident this fixes): `quiz` is in-memory, app-lifetime
 * state read directly by `AuthScreen`'s signup/link calls, uid-unaware. A
 * `lastUid !== uid` transition — logout (uid -> null), a fresh login, or a
 * fast account switch — means whatever is in `quiz` was answered under a
 * DIFFERENT identity (or no identity yet) and must never be carried into the
 * new one, even for a single render. Same-uid transitions (a token refresh,
 * a re-render) must NOT reset — that would erase a user's own in-progress
 * answers on every unrelated update.
 *
 * Generic (not `Quiz`-specific) so it has no dependency on `state/AppState`
 * — that module imports this one, not the other way around.
 */
export function nextValueForIdentity<T>(
  lastUid: string | null,
  uid: string | null,
  currentValue: T,
  resetValue: T,
): T {
  return lastUid === uid ? currentValue : resetValue;
}
