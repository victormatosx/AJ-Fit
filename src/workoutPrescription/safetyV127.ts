import type { SafetyDecision, SafetyReasonCode } from './types';

/**
 * Fase 9 §2 (follow-up correction) — `evaluateSafety` (safety.ts) is shared
 * verbatim with v2, where 5 of its `ADAPTED` reason codes back a REAL
 * composition-level modifier (`modifiers.ts`/`composition.ts`:
 * `safety:post_surgical_conservative`, `safety:dizziness_controlled`,
 * `safety:lipedema_conservative`, `safety:lipedema_mild`). v1.27 has
 * exactly two real modifiers (musculoskeletal_limitation, muscle_priority)
 * — population routing covers pregnancy/postpartum/frailty. For the other
 * three conditions (dizziness/vertigo, post-surgical, lipedema), v1.27's
 * composed plan is never actually different from a CLEAR user's — reporting
 * `ADAPTED` for them was a false signal (Fase 9 §12 audit).
 *
 * This is NOT a `safety.ts` change: `REQUIRES_CLEARANCE`/`BLOCKED` (the "no
 * clearance yet, block generation" outcomes) are untouched — those already
 * halt generation identically in both pipelines and are computed before
 * this function is ever consulted. Only `ADAPTED` is re-evaluated, and only
 * for `engineV127.ts`'s own trace/status — `evaluateSafety`'s v2 behavior,
 * and everything `modifiers.ts`/`composition.ts` does with it, is
 * unaffected.
 */
const V127_REAL_ADAPTATION_REASONS = new Set<SafetyReasonCode>([
  'PREGNANCY_POPULATION',
  'POSTPARTUM_POPULATION',
  'FUNCTIONAL_CAPACITY_LIMITATION',
  'FUNCTIONAL_BALANCE_OR_FALL_RISK',
  'MUSCULOSKELETAL_ADAPTATION_REQUIRED',
]);

const V127_REAL_MODIFIER_ID_PREFIXES = ['population:', 'safety:musculoskeletal_adaptation'];

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
    // 'stable_positioning' is the only protectedConstraint tied exclusively
    // to a dropped reason (dizziness_controlled); every other constraint
    // string (`balance_support_required`, `limitation:<region>`) is tied
    // only to a kept reason — see safety.ts's `add()` call sites.
    protectedConstraints: safety.protectedConstraints.filter((constraint) => constraint !== 'stable_positioning'),
  };
}
