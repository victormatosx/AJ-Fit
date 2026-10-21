import type { SafetyDecision,SafetyReasonCode } from './types';


const V127_REAL_ADAPTATION_REASONS = new Set<SafetyReasonCode>([
  'PREGNANCY_POPULATION',
  'POSTPARTUM_POPULATION',
  'FUNCTIONAL_CAPACITY_LIMITATION',
  'FUNCTIONAL_BALANCE_OR_FALL_RISK',
]);

const V127_REAL_MODIFIER_ID_PREFIXES = ['population:'];

function isRealV127ModifierId(id: string): boolean {
  return V127_REAL_MODIFIER_ID_PREFIXES.some((prefix) => id === prefix || id.startsWith(prefix));
}

/**
 * `BLOCKED`/`REQUIRES_CLEARANCE` pass through untouched. `CLEAR` passes
 * through untouched. Only `ADAPTED` is re-scoped to the reasons v1.27
 * actually backs with a real composition difference; if none remain, the
 * effective status downgrades to `CLEAR` — never a fabricated adaptation.
 */
export function effectiveSafetyV127(safety: SafetyDecision): SafetyDecision {
  if (safety.status !== 'ADAPTED') return safety;
  const reasons = safety.reasons.filter((reason) => V127_REAL_ADAPTATION_REASONS.has(reason));
  if (reasons.length === 0) {
    return { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] };
  }
  return {
    status: 'ADAPTED',
    reasons,
    requiredModifierIds: safety.requiredModifierIds.filter(isRealV127ModifierId),
    protectedConstraints: safety.protectedConstraints.filter((constraint) => constraint !== 'stable_positioning'),
  };
}
