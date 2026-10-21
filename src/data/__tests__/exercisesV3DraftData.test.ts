import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXERCISES_SEED } from '../exercisesSeedData';
import { ACTIVITIES_V3_DRAFT, EXERCISES_V3_DRAFT, V3_DRAFT_METADATA } from '../exercisesV3DraftData';
import { validateExerciseSeed } from '../../validators/exerciseValidation';
import { CANONICAL_ACTIVITIES } from '../../workoutPrescription/canonicalActivities';
import { isExerciseExecutable, unrestrictedEquipmentContext } from '../../workoutPrescription/equipment';
import { evaluateManualSubstitutionCandidate } from '../../workoutPrescription/manualSubstitutionResolver';

const drafts = [...EXERCISES_V3_DRAFT, ...ACTIVITIES_V3_DRAFT];
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

describe('exercise authoring drafts', () => {
  it('keeps drafts outside the operational exercise and activity catalogs', () => {
    const operational = new Set([...EXERCISES_SEED, ...CANONICAL_ACTIVITIES].map(item => item.id));
    expect(drafts.length).toBeGreaterThan(0);
    expect(new Set(drafts.map(item => item.id)).size).toBe(drafts.length);
    for (const draft of drafts) {
      expect(operational.has(draft.id)).toBe(false);
      expect(draft.status).toBe('draft');
      expect(draft.availability.manualSelection).toBe(false);
      expect(draft.availability.workoutGeneration).toBe(false);
      expect(draft).not.toHaveProperty('limitationProfile');
    }
  });
});
