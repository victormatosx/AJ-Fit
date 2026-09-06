/**
 * Pure regression coverage (docs/workout-lifecycle/v2/qa/ — root-cause fix)
 * for the PREPARE bug: `pending.targetContentIdentity` was hashed from
 * `canonical.targetPlan` while `pending.plan` was persisted as a SEPARATE
 * `withoutUndefined(canonical.targetPlan)` call. The fix (`workoutLifecycleApplication.ts`)
 * now computes both from a single `persistedTargetPlan` variable. This file
 * proves, independent of Firestore, that `contentIdentityFor` is stable
 * across a `withoutUndefined` pass for a spec-conformant `FinalWorkoutPlan`
 * (so the fix costs nothing when the two representations already agree),
 * while still detecting a genuine content change in every field it reads.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: undefined }));

const { contentIdentityFor, withoutUndefined } = await import('../workoutPrograms');

type PlanShape = Parameters<typeof contentIdentityFor>[0]['plan'];

const TEMPLATE = { id: 'T003' as never, version: 2, contentHash: 'e3aa4b3cba2d1122334455667788990011223344556677889900112233445566' };

function basePlan(overrides: Partial<PlanShape> = {}): PlanShape {
  return {
    planId: 'wp_9032847a',
    templateId: 'T003',
    requestedDays: 4,
    prescribedStructuredDays: 4,
    population: 'general',
    environment: 'gym',
    goalFamily: 'gain_muscle',
    split: 'upper_lower',
    limitationDatasetVersion: 'lim_v3',
    limitationDatasetHash: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    sessions: [],
    versions: {
      templateLibrary: '2.0.0', selectionEngine: '2.0.0', safetyRules: '1.0.0',
      modifierRules: '2.0.0', compositionEngine: '2.1.0', limitationResolver: '1.0.0',
    },
    trace: {} as never,
    ...overrides,
  } as PlanShape;
}

describe('contentIdentityFor is stable across withoutUndefined (item 9 — the exact PREPARE boundary)', () => {
  it('a plan with `adaptationStage: undefined` (non-beginner target — the real case for this account\'s BEGINNER→INTERMEDIATE promotion) hashes identically before and after withoutUndefined', () => {
    const raw = basePlan({ adaptationStage: undefined });
    const stripped = withoutUndefined(raw);
    expect('adaptationStage' in stripped).toBe(false); // withoutUndefined removes the key entirely
    expect('adaptationStage' in raw).toBe(true); // vs. present-but-undefined on the raw object
    const idFromRaw = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: raw, template: TEMPLATE });
    const idFromStripped = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: stripped, template: TEMPLATE });
    expect(idFromRaw).toBe(idFromStripped);
  });

  it('a plan with `adaptationStage` entirely absent (never assigned) hashes identically to one with an explicit `undefined`', () => {
    const raw = basePlan({ adaptationStage: undefined });
    const { adaptationStage: _omitted, ...withoutKey } = raw as PlanShape & { adaptationStage?: unknown };
    const idFromRaw = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: raw, template: TEMPLATE });
    const idFromAbsent = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: withoutKey as PlanShape, template: TEMPLATE });
    expect(idFromRaw).toBe(idFromAbsent);
  });

  it('withoutUndefined never changes a plan\'s `versions` key set/order for a spec-conformant plan (no undefined values inside it)', () => {
    const raw = basePlan();
    const stripped = withoutUndefined(raw);
    expect(JSON.stringify(stripped.versions)).toBe(JSON.stringify(raw.versions));
  });

  it('a genuine `versions` content change is still detected after withoutUndefined', () => {
    const a = withoutUndefined(basePlan());
    const b = withoutUndefined(basePlan({ versions: { ...a.versions, safetyRules: '2.0.0' } }));
    const idA = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: a, template: TEMPLATE });
    const idB = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: b, template: TEMPLATE });
    expect(idA).not.toBe(idB);
  });

  it('a genuine `limitationDatasetVersion`/`limitationDatasetHash` content change is still detected after withoutUndefined', () => {
    const a = withoutUndefined(basePlan());
    const b = withoutUndefined(basePlan({ limitationDatasetVersion: 'lim_v4' }));
    const c = withoutUndefined(basePlan({ limitationDatasetHash: 'ffff9999eeee8888dddd7777cccc6666ffff9999eeee8888dddd7777cccc6666' }));
    const idA = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: a, template: TEMPLATE });
    const idB = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: b, template: TEMPLATE });
    const idC = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan: c, template: TEMPLATE });
    expect(idA).not.toBe(idB);
    expect(idA).not.toBe(idC);
  });

  it('a genuine template metadata (version/contentHash) or questionnaireVersion change is still detected', () => {
    const plan = withoutUndefined(basePlan());
    const base = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 1, plan, template: TEMPLATE });
    const differentTemplateVersion = contentIdentityFor({
      questionnaireId: 'q1', questionnaireVersion: 1, plan, template: { ...TEMPLATE, version: 3 },
    });
    const differentTemplateHash = contentIdentityFor({
      questionnaireId: 'q1', questionnaireVersion: 1, plan,
      template: { ...TEMPLATE, contentHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' },
    });
    const differentQuestionnaireVersion = contentIdentityFor({ questionnaireId: 'q1', questionnaireVersion: 2, plan, template: TEMPLATE });
    expect(differentTemplateVersion).not.toBe(base);
    expect(differentTemplateHash).not.toBe(base);
    expect(differentQuestionnaireVersion).not.toBe(base);
  });
});
