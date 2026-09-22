/**
 * Regression tests for two real bugs reported after Phase 3:
 *
 *   (1) Home kept showing "Preparando seu treino" (generatingState) even
 *       when Phase 3 had already persisted the program before Paywall.
 *   (2) Home flashed "Atualize suas informações" (NEEDS_QUESTIONNAIRE_UPDATE)
 *       on cold start, before the real Firestore read had a chance to run.
 *
 * Root cause: `useWorkoutPrescription` modeled its "haven't read Firestore
 * yet" placeholder as a real, renderable `NEEDS_QUESTIONNAIRE_UPDATE`
 * `PrescriptionResult`, with no separate signal callers could use to tell
 * "unknown/loading" apart from "confirmed, the user must update the
 * questionnaire". `HomeScreen`/`AppShell` read `prescription.status`
 * directly and rendered whichever outcome copy matched.
 *
 * `vitest.config.mts` only collects pure `.ts` modules in a Node
 * environment — this hook is a real React hook (`useState`/`useEffect`)
 * that can't be mounted here. Following this codebase's established
 * pattern for structural regressions on files that can't be unit-tested
 * directly (see `src/state/__tests__/appStateIdentityScope.test.ts`,
 * `src/screens/__tests__/appShellNavigationStructure.test.ts`), these
 * assertions read the real source and pin the exact invariants that fixed
 * both bugs, so a future edit can't silently reintroduce either one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hookSource = readFileSync(
  new URL('../useWorkoutPrescription.ts', import.meta.url),
  'utf8',
);
const homeScreenSource = readFileSync(
  new URL('../../screens/HomeScreen.tsx', import.meta.url),
  'utf8',
);
const appShellSource = readFileSync(
  new URL('../../screens/AppShell.tsx', import.meta.url),
  'utf8',
);

describe('useWorkoutPrescription — loading is a distinct signal from prescription.status', () => {
  it('exposes a `loading` state, separate from `generating`', () => {
    expect(hookSource).toContain('loading: boolean');
    expect(hookSource).toContain('const [loading, setLoading] = useState(true)');
  });

  it('sets loading before the Firestore read and clears it on every exit branch of reload()', () => {
    const reloadBody = hookSource.slice(
      hookSource.indexOf('const reload = useCallback'),
      hookSource.indexOf('const generate = useCallback'),
    );
    expect(reloadBody).toContain('setLoading(true)');
    // reload() now delegates every real outcome (load-failed, program-found,
    // no-questionnaire, or the automatic-reconciliation fallback) to
    // `resolveWorkoutPrescription` — a single standalone function shared with
    // `useWorkoutReadinessGate` (see its own doc comment) — and always
    // resolves it before clearing loading, so there is exactly ONE
    // unconditional `setLoading(false)` after the `await`, plus the early
    // no-user return. Both must be present so no exit path can leave
    // `loading` stuck `true`.
    expect(reloadBody).toContain('await resolveWorkoutPrescription(');
    const setLoadingFalseCount = (reloadBody.match(/setLoading\(false\)/g) ?? []).length;
    expect(setLoadingFalseCount).toBeGreaterThanOrEqual(2);
  });

  it('resolveWorkoutPrescription clears no state itself — it is a pure async resolution reload() always awaits before reload() clears loading', () => {
    const resolveBody = hookSource.slice(
      hookSource.indexOf('export async function resolveWorkoutPrescription'),
      hookSource.indexOf('export function useWorkoutPrescription'),
    );
    // Every branch returns a real `PrescriptionResult` (never throws past its
    // own try/catch), so `reload()`'s single `await` + trailing
    // `setLoading(false)` always fires — this is what makes the count above
    // sufficient instead of needing one per branch.
    expect((resolveBody.match(/catch \(error\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((resolveBody.match(/return \{ status: 'INVALID_CONFIGURATION'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('the returned loading is forced true for a stale/unresolved identity, mirroring the existing prescription staleness guard', () => {
    expect(hookSource).toContain('const identityResolved = resolved.identity === identity');
    expect(hookSource).toContain('loading: identityResolved ? loading : true');
  });
});

describe('HomeScreen — never renders NEEDS_QUESTIONNAIRE_UPDATE/generatingState copy while the hook is still loading', () => {
  it('accepts a `loading` prop and only shows the neutral loadingState copy — never the questionnaire-update or generating copy — while it is true and no program is known yet', () => {
    expect(homeScreenSource).toContain('loading?: boolean');
    expect(homeScreenSource).toContain(
      "const showLoadingState = (Boolean(loading) && prescription.status !== 'SUCCESS')",
    );
    // loadingState must be checked BEFORE generating and BEFORE
    // prescriptionOutcomeKey(prescription.status) in the outcomeKey ladder.
    const outcomeKeyBlock = homeScreenSource.slice(
      homeScreenSource.indexOf('const outcomeKey = showLoadingState'),
      homeScreenSource.indexOf('const scheduledSessionIndex'),
    );
    expect(outcomeKeyBlock.indexOf("'loadingState'")).toBeLessThan(
      outcomeKeyBlock.indexOf('generating'),
    );
    expect(outcomeKeyBlock.indexOf('generating')).toBeLessThan(
      outcomeKeyBlock.indexOf('prescriptionOutcomeKey'),
    );
  });
});

describe('AppShell — StartWorkoutConfirmation modal respects the same loading guard as Home', () => {
  it('passes `prescriptionLoading` through to the confirmation modal and gates its outcome copy the same way', () => {
    expect(appShellSource).toContain('loading: prescriptionLoading,');
    expect(appShellSource).toContain('loading={prescriptionLoading}');
    expect(appShellSource).toContain('const showLoadingState = loading && !canStart;');
    expect(appShellSource).toContain('!canStart && !generating && !showLoadingState && canRetryGeneration');
  });
});
