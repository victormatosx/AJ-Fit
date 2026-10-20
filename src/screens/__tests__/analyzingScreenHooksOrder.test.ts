import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the "Rendered fewer hooks than expected" crash that
 * followed `onboarding_workout_generation_failed`. This project has no
 * React Native component-render test infrastructure (vitest here runs with
 * `environment: 'node'`, no jsdom/testing-library — see vitest.config.mts),
 * so a real render test isn't available; this mirrors the codebase's
 * existing pattern of source-text structural regression guards (e.g.
 * `src/screens/__tests__/authOnboardingContext.test.ts`) instead.
 *
 * Root cause (fixed alongside this test): `AnalyzingScreen` called
 * `useRef`/`useEffect` for its pulse animation AFTER an early
 * `if (computeStatus === 'error') return (...)`. On the first render
 * (`computeStatus === 'pending'`) every hook ran; the moment a real
 * generation failure flipped `computeStatus` to `'error'`, that same
 * component instance called two fewer hooks than its previous render —
 * exactly what triggers React's "Rendered fewer hooks than expected"
 * invariant violation. With no error boundary anywhere in the app
 * (confirmed: no `componentDidCatch`/`getDerivedStateFromError` in `src/`),
 * that crash tore down the whole tree, which is what actually produced
 * `onboarding_funnel_unmounted` — not the generation failure itself.
 */
const analyzingScreen = readFileSync(
  new URL('../AnalyzingScreen.tsx', import.meta.url),
  'utf8',
);

/** Slice out only `AnalyzingScreen`'s own function body — `StepPill` and
 *  `StepIndicator` are separate top-level components declared afterward and
 *  legitimately have their own hooks. */
function analyzingScreenBody(source: string): string {
  const start = source.indexOf('export function AnalyzingScreen(');
  const end = source.indexOf('\n// ── Checklist pieces ──', start);
  if (start === -1 || end === -1) {
    throw new Error('AnalyzingScreen function boundaries not found — update this test if the file was restructured');
  }
  return source.slice(start, end);
}

describe('AnalyzingScreen — Rules of Hooks regression guard', () => {
  const body = analyzingScreenBody(analyzingScreen);
  const earlyReturnIndex = body.indexOf("if (computeStatus === 'error')");

  it('has the error-state early return this guard is anchored to', () => {
    expect(earlyReturnIndex).toBeGreaterThan(-1);
  });

  it('calls hooks before the error-state early return (sanity: the guard below is not vacuous)', () => {
    const beforeReturn = body.slice(0, earlyReturnIndex);
    const hookCallsBefore = beforeReturn.match(/\buse[A-Z]\w*\s*\(/g) ?? [];
    // The reusable ring owns no animation hooks. An exact count would make
    // this test brittle to unrelated edits, but the screen still owns its
    // state and effects before the conditional return.
    expect(hookCallsBefore.length).toBeGreaterThanOrEqual(6);
  });

  it('never calls a hook after the error-state early return', () => {
    const afterReturn = body.slice(earlyReturnIndex);
    // Skip past the early-return's own JSX block (which ends at the first
    // top-level `}` closing the `if`) — anything after that, up to the end
    // of AnalyzingScreen's body, must be hook-free besides plain values.
    const hookCallsAfter = afterReturn.match(/\buse[A-Z]\w*\s*\(/g) ?? [];
    expect(hookCallsAfter).toEqual([]);
  });

  it('delegates the ring and the mascot to one component instead of local animation hooks', () => {
    expect(body).toContain('<AnalysisAjRing');
    expect(body).not.toContain('useRef(new Animated.Value(0.75))');
  });

  it('preserves domain outcomes and sends non-retryable safety results back to answer review', () => {
    expect(body).toContain('onboardingGenerationFailurePresentation(failureStatus)');
    expect(body).toContain("presentation.action === 'retry'");
    expect(body).toContain(': onReviewAnswers');
    expect(body).toContain('tPlan(`prescription.${presentation.outcomeKey}.title`)');
    expect(body).toContain("t('analyzing.error.reviewAnswers')");
  });
});
