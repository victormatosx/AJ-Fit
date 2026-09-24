import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_LIBRARY_VERSION } from '../catalog';

/**
 * Fase 8 proved `engine.ts` and `services/workoutPrograms.ts` were both
 * fully disconnected from every v1.27 module. Fase 10 (cutover)
 * deliberately wires `workoutPrograms.ts`/`PlanReadyScreen.tsx` to v1.27 —
 * but ONLY through the central dispatcher (`generatePrescription.ts`) and
 * the local template-metadata helper (`templateDocumentV127.ts`), never by
 * importing a low-level v1.27 module (selector/composition/canonical
 * catalog/modifiers) directly. This guard is narrowed accordingly:
 *
 *   - `engine.ts` (the legacy v2 engine itself) must still NEVER reference
 *     any v1.27 module — this is what makes v2 remain a clean, independent
 *     rollback target.
 *   - `workoutPrograms.ts`/`PlanReadyScreen.tsx` may reference
 *     `generatePrescription`/`generateWorkoutPrescriptionRouted`/
 *     `resolveActiveGenerationVersion`/`templateDocumentV127`/
 *     `PRESCRIPTION_VERSIONS_V127` (all sanctioned integration points) but
 *     must NEVER import the low-level v1.27 modules directly — that
 *     decision belongs only to `generatePrescription.ts`
 *     (`generatePrescriptionRouting.test.ts` already proves that
 *     centralization structurally).
 */
const LOW_LEVEL_V127_MODULE_NAMES = [
  'selectorV127', 'compositionV127', 'canonicalCatalog', 'canonicalExerciseIdentity',
  'canonicalActivities', 'canonicalMusculoskeletalLimitationV127', 'musculoskeletalLimitationV127',
  'canonicalMusclePriorityV127', 'musclePriorityV127', 'engineV127', 'safetyV127', 'validationV127',
];

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

/** Strips line/block comments so a doc-comment mention of a module name never false-positives as a real import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Fase 8/10 — engine.ts stays fully disconnected from v1.27 (v2 rollback stays clean)', () => {
  it('workoutPrescription/engine.ts never references any v1.27 module, including generationVersion/generatePrescription', () => {
    const source = stripComments(sourceOf('../engine.ts'));
    for (const moduleName of [...LOW_LEVEL_V127_MODULE_NAMES, 'generationVersion', 'generatePrescription']) {
      expect(source.includes(moduleName), `engine.ts unexpectedly references ${moduleName}`).toBe(false);
    }
  });

  it('the active runtime catalog is still v2.0.0 (T001-T090) — the one value engine.ts trusts', () => {
    expect(TEMPLATE_LIBRARY_VERSION).toBe('2.0.0');
  });
});

describe('Fase 10 — workoutPrograms.ts/PlanReadyScreen.tsx reach v1.27 ONLY through the central dispatcher', () => {
  it.each([
    ['services/workoutPrograms.ts', '../../services/workoutPrograms.ts'],
    ['screens/PlanReadyScreen.tsx', '../../screens/PlanReadyScreen.tsx'],
  ])('%s never imports a low-level v1.27 module directly', (_label, relativePath) => {
    const source = stripComments(sourceOf(relativePath));
    for (const moduleName of LOW_LEVEL_V127_MODULE_NAMES) {
      expect(source.includes(moduleName), `${relativePath} unexpectedly references ${moduleName} directly`).toBe(false);
    }
  });
});
