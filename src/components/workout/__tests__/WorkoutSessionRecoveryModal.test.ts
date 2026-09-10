import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `WorkoutSessionRecoveryModal.tsx` cannot be rendered in this project's
 * test suite (no React Native test renderer — same constraint documented in
 * `workoutScreenFinishStructure.test.ts`). This locks the long-session
 * alert's structure textually: single source of truth for elapsed time
 * (Firestore `execution.startedAt`, via the shared `workoutSessionTimer`
 * helpers), no locally-owned ticking, and a plain (non-alarming) fallback
 * for a normal, recently-started session.
 */
const source = readFileSync(new URL('../WorkoutSessionRecoveryModal.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../../../screens/AppShell.tsx', import.meta.url), 'utf8');

describe('WorkoutSessionRecoveryModal — long-session alert', () => {
  it('derives elapsed/format/threshold from the shared workoutSessionTimer module, never a reimplementation', () => {
    expect(source).toContain("from '../../lib/workoutSessionTimer'");
    expect(source).toContain('computeWorkoutElapsedSeconds');
    expect(source).toContain('formatWorkoutSessionDuration');
    expect(source).toContain('isLongWorkoutSession');
    expect(source).toContain('safeStartedAtMs');
  });

  it('reads elapsed time from execution.startedAt — Firestore is the only source of truth, never a second locally-tracked instant', () => {
    expect(source).toContain('safeStartedAtMs(execution.startedAt)');
  });

  it('never owns a setInterval/ticking loop — it is a short-lived decision surface, not the workout timer', () => {
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
  });

  it('shows the long-session copy only when isLongWorkoutSession is true, with a formatted duration interpolated', () => {
    expect(source).toMatch(/isLongSession\s*&&\s*durationLabel/);
    expect(source).toContain("t('sessionRecovery.longSessionBody', { duration: durationLabel })");
  });

  it('falls back to the plain, non-alarming copy for a normal (short) session', () => {
    expect(source).toContain("t('sessionRecovery.body')");
  });

  it('the long-session copy never replaces the modal title — only the body changes', () => {
    const titleAssignment = source.slice(source.indexOf('const title ='), source.indexOf('const body ='));
    expect(titleAssignment).not.toContain('longSession');
  });
});

describe('"Agora não" (dismiss) — must stay a non-destructive, purely local deferral', () => {
  it('dismissRecovery only clears local recovery state, never abandons, never touches schedule, never starts a workout', () => {
    const start = appShell.indexOf('const dismissRecovery = () => {');
    expect(start).toBeGreaterThan(-1);
    const end = appShell.indexOf('};', start);
    const body = appShell.slice(start, end);
    expect(body).toContain('recovery.resolve()');
    expect(body).not.toContain('abandonWorkoutExecution');
    expect(body).not.toContain('schedule.');
    expect(body).not.toContain('execution.start');
    expect(body).not.toContain('execution.adoptExecution');
  });

  it('is wired to the modal\'s onDismiss, distinct from onResume/onDiscard', () => {
    expect(appShell).toContain('onDismiss={dismissRecovery}');
    expect(appShell).not.toContain('onResume={dismissRecovery}');
    expect(appShell).not.toContain('onDiscard={dismissRecovery}');
  });
});
