import { describe, it, expect } from 'vitest';
import { completeAnswers } from './fixtures';
import { selectTemplate } from '../selection';
import { generateWorkoutPrescription } from '../engine';
import { getTemplateById } from '../catalog';
import { resolveModifiers } from '../modifiers';
import { equipmentContextFor } from '../equipment';
import type { SafetyDecision } from '../types';

const CLEAR_SAFETY: SafetyDecision = { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] };

function generate(equipment: string[]) {
  const answers = completeAnswers({
    sex: 'm', goal: 'gain_muscle', level: 'never_or_starting', days: 7,
    place: 'home', equipment, specialConditions: ['none'],
  });
  const selection = selectTemplate(answers);
  if (selection.status !== 'SELECTED') return { selectionStatus: selection.status } as const;
  const template = getTemplateById(selection.decision.templateId);
  const result = generateWorkoutPrescription(answers, { template });
  return { selectionStatus: 'SELECTED', templateId: selection.decision.templateId, result } as const;
}

describe('regression: equipment "other" must never force INVALID_CONFIGURATION on its own', () => {
  it('(A) home + equipment=["other"] never fails specifically with OTHER_EQUIPMENT_HAS_NO_CANONICAL_MAPPING', () => {
    const { result } = generate(['other']);
    expect(result).toBeDefined();
    if (result!.status !== 'SUCCESS') {
      expect(result!.reasonCodes.some((c) => c.includes('other_unmapped') || c.includes('OTHER_EQUIPMENT_HAS_NO_CANONICAL_MAPPING'))).toBe(false);
    }
  });

  it('(B) home: adding "other" to a full valid equipment set never changes the structural outcome vs the same set without "other"', () => {
    const fullEquipment = ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell'];
    const withoutOther = generate(fullEquipment);
    const withOther = generate([...fullEquipment, 'other']);

    expect(withoutOther.result?.status).toBe('SUCCESS');
    expect(withOther.result?.status).toBe('SUCCESS');
    if (withoutOther.result?.status === 'SUCCESS' && withOther.result?.status === 'SUCCESS') {
      // Structurally equivalent: same template, same sessions/exercises/sets —
      // "other" contributed no capability and removed none.
      expect(withOther.templateId).toBe(withoutOther.templateId);
      expect(JSON.stringify(withOther.result.plan.sessions)).toBe(JSON.stringify(withoutOther.result.plan.sessions));
      expect(withOther.result.plan.trace.unresolvedModifiers).toEqual([]);
    }
  });

  it('(D) equipmentContextFor("other") contributes zero equipment beyond the conservative baseline', () => {
    const answers = completeAnswers({ place: 'home', equipment: ['other'] });
    const context = equipmentContextFor(answers, 'home');
    expect(context.availableEquipment).toEqual(new Set(['bodyweight']));
  });

  it('a genuinely insufficient real-equipment combination for a given template still fails closed (unmasked)', () => {
    // No dumbbells/barbell/bands/bench for a template that needs them —
    // this must remain a real, reported failure, never silently hidden.
    const { result } = generate(['bodyweight']);
    expect(result).toBeDefined();
    expect(result!.status).not.toBe('SUCCESS');
    if (result!.status !== 'SUCCESS') {
      expect(result!.reasonCodes.some((c) => c.startsWith('NO_SAFE_EQUIPMENT_SUBSTITUTE'))).toBe(true);
    }
  });

  it('(E) a genuinely unresolved safety modifier still produces RULE_DEFINITION_REQUIRED / fails closed', () => {
    const answers = completeAnswers({ place: 'gym', equipment: [] });
    const unresolvedSafety: SafetyDecision = {
      status: 'ADAPTED',
      reasons: [],
      requiredModifierIds: ['safety:genuinely_undocumented_case'],
      protectedConstraints: [],
    };
    const modifiers = resolveModifiers(answers, unresolvedSafety);
    const target = modifiers.find((m) => m.id === 'safety:genuinely_undocumented_case');
    expect(target?.application).toBe('RULE_DEFINITION_REQUIRED');
    expect(target?.reasonCode).toBe('SAFE_EXECUTABLE_TRANSFORMATION_NOT_DOCUMENTED');
  });

  it('resolveModifiers never emits an "equipment:other_unmapped" modifier anymore, for any place/equipment combination', () => {
    for (const place of ['home', 'gym'] as const) {
      for (const equipment of [['other'], ['bodyweight', 'other'], ['other', 'none']]) {
        const answers = completeAnswers({ place, equipment });
        const modifiers = resolveModifiers(answers, CLEAR_SAFETY);
        expect(modifiers.some((m) => m.id === 'equipment:other_unmapped')).toBe(false);
      }
    }
  });
});
