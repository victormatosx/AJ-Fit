/**
 * Regression tests for the first-app-entry readiness gate (audit: the
 * onboarding→Home lifecycle report). `App.tsx` is a real React root
 * component (Firebase/RN wiring) that can't be mounted under this Node-only
 * Vitest config (see `vitest.config.mts`'s doc comment) — following the same
 * established pattern this codebase already uses for that limitation (e.g.
 * `src/workoutPrescription/__tests__/loadingStateMachine.test.ts`,
 * `src/state/__tests__/appStateIdentityScope.test.ts`), these assertions
 * read the real source and pin the exact invariants that make Home-as-
 * generator architecturally impossible:
 *
 *   (H) `AppShell` — and therefore `HomeScreen`'s first mount — is never
 *       rendered except when `resolvedScreen === 'app'`.
 *   `resolvedScreen` is exactly `resolvePremiumGate(...)`'s return value,
 *       and that call is fed `workoutReadinessGate` from
 *       `useWorkoutReadinessGate` (proven NOT to resolve `'app'` while the
 *       gate isn't `'ready'` — see `src/lib/__tests__/premiumGate.test.ts`'s
 *       "workoutReadinessGate" describe block for that half of the proof).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

describe('App.tsx — first-app-entry readiness gate wiring', () => {
  it('imports and mounts useWorkoutReadinessGate', () => {
    expect(appSource).toContain("import { useWorkoutReadinessGate } from './src/workoutPrescription/useWorkoutReadinessGate';");
    expect(appSource).toContain('const workoutReadinessGate = useWorkoutReadinessGate({');
  });

  it('feeds workoutReadinessGate into the SAME resolvePremiumGate call that decides resolvedScreen', () => {
    const gateCallBlock = appSource.slice(
      appSource.indexOf('const resolvedScreen = resolvePremiumGate({'),
      appSource.indexOf('const resolvedScreen = resolvePremiumGate({') + 400,
    );
    expect(gateCallBlock).toContain('workoutReadinessGate,');
  });

  it('(H) AppShell is rendered ONLY when resolvedScreen === "app" — never unconditionally, never on a different branch', () => {
    expect(appSource).toContain(
      "{resolvedScreen === 'app' && <AppShell onHomeReady={onDestinationReady} />}",
    );
    // No other render site for AppShell exists in this file.
    expect((appSource.match(/<AppShell\s/g) ?? []).length).toBe(1);
  });

  it('the readiness gate is enabled only once auth + questionnaire are already confirmed found — never speculatively for a signed-out/unresolved user', () => {
    const hookCallBlock = appSource.slice(
      appSource.indexOf('const workoutReadinessGate = useWorkoutReadinessGate({'),
      appSource.indexOf('const resolvedScreen = resolvePremiumGate({'),
    );
    expect(hookCallBlock).toContain("enabled: Boolean(user) && questionnaireResolution === 'found',");
  });
});
