/**
 * Pure derivation behind the root router's `preferencesReconciling` flag
 * (`App.tsx`'s `RootNavigator`).
 *
 * ROOT CAUSE this replaces: the previous implementation was a plain
 * `useState(false)` flipped to `true` from a `useEffect` that watched for a
 * `profileLoading: true → false` transition. `useEffect`s run AFTER the
 * render that flipped `profileLoading` to `false` has already committed and
 * painted — so `resolvePremiumGate` computed and rendered its output for
 * that render with `preferencesReconciling` still `false` (its previous
 * value), matching every other prerequisite and opening the gate to
 * `'app'`. Only on the NEXT render (once the effect had run and called
 * `setPreferencesReconciling(true)`) did the gate close again — producing
 * exactly the reported bug: `resolvedScreen: 'app' → 'unresolved' → 'app'`
 * within a single identity bootstrap.
 *
 * The fix: derive `preferencesReconciling` synchronously, during render,
 * from whether the current uid has already been reconciled this session —
 * never from a state variable that can only be updated a render late. The
 * caller still starts the actual async reconciliation from a `useEffect`
 * (side effects belong there), but the GATE-FACING boolean this function
 * returns is already correct on the very first render where `profileLoading`
 * becomes `false`, so `resolvePremiumGate` never observes a false "ready"
 * moment before reconciliation has even started.
 */
export type ReconciliationGateInput = {
  authInitializing: boolean;
  profileLoading: boolean;
  uid: string | null;
  hasProfile: boolean;
  /** uid most recently reconciled to completion, or `null` before any. */
  reconciledUid: string | null;
};

export function needsPreferencesReconciliation(input: ReconciliationGateInput): boolean {
  if (input.authInitializing || input.profileLoading) return false;
  if (!input.uid || !input.hasProfile) return false;
  return input.reconciledUid !== input.uid;
}
