import { describe, expect, it } from 'vitest';
import { readinessStatusForPrescription } from '../readiness';
import type { PrescriptionFailureCode } from '../types';

/**
 * Root-cause fix: `useWorkoutReadinessGate` used to resolve `'ready'` on ANY
 * terminal prescription outcome, including a confirmed `NEEDS_QUESTIONNAIRE_UPDATE`
 * — which is exactly how a Fluxo B account with a missing required field could
 * reach Home with an "informações insuficientes" card instead of being sent back
 * to the questionnaire. This pure function is the single place that decision now
 * lives, reusing `PrescriptionResult.status` (the engine's own, single source of
 * truth for "is this input complete") instead of a second, independent list of
 * required fields.
 */
describe('readinessStatusForPrescription', () => {
  it('maps NEEDS_QUESTIONNAIRE_UPDATE to needsQuestionnaire — the one fixable-right-now failure', () => {
    expect(readinessStatusForPrescription('NEEDS_QUESTIONNAIRE_UPDATE')).toBe('needsQuestionnaire');
  });

  it('maps SUCCESS to ready', () => {
    expect(readinessStatusForPrescription('SUCCESS')).toBe('ready');
  });

  it.each<PrescriptionFailureCode>([
    'REQUIRES_CLEARANCE',
    'BLOCKED',
    'INVALID_CONFIGURATION',
    'MISSING_TEMPLATE',
    'MISSING_EXERCISE',
    'NO_EXECUTABLE_SESSION',
  ])('maps every other terminal failure (%s) to ready — AppShell already renders a correct degraded UI for these', (status) => {
    expect(readinessStatusForPrescription(status)).toBe('ready');
  });
});
