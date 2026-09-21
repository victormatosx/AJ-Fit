import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateWorkoutPrescriptionRouted } from '../generatePrescription';
import { resolveGenerationVersion } from '../generationVersion';
import { completeAnswers } from './fixtures';

/**
 * Fase 9 §2/§18 — `generatePrescription.ts`'s `generateWorkoutPrescriptionRouted`
 * is the ONE place `resolveGenerationVersion`'s decision turns into an
 * actual engine call. This proves both the routing behavior itself and,
 * structurally, that no other production file makes this decision
 * independently (no scattered `if (version === ...)`/direct `engineV127`
 * import anywhere else).
 */
describe('generateWorkoutPrescriptionRouted — central dispatcher', () => {
  it('defaults to v1.27 (resolveGenerationVersion(), Fase 11 cutover) with no override', () => {
    const answers = completeAnswers();
    const routed = generateWorkoutPrescriptionRouted(answers, 'INTERMEDIATE');
    expect(routed.status).toBe('SUCCESS');
    if (routed.status === 'SUCCESS') expect(routed.plan.versions.templateLibrary).toBe('1.27.0');
  });

  it('overriding to v1.27 routes to engineV127 and produces a v1.27-versioned plan', () => {
    const answers = completeAnswers({ days: 4, goal: 'gain_muscle', level: 'intermediate' });
    const routed = generateWorkoutPrescriptionRouted(answers, 'INTERMEDIATE', {}, 'v1.27');
    expect(routed.status).toBe('SUCCESS');
    if (routed.status === 'SUCCESS') {
      expect(routed.plan.versions.templateLibrary).toBe('1.27.0');
      expect(routed.plan.templateId.startsWith('T0')).toBe(true);
    }
  });

  it('overriding to v2 explicitly still routes to the legacy engine', () => {
    const answers = completeAnswers();
    const routed = generateWorkoutPrescriptionRouted(answers, 'INTERMEDIATE', {}, 'v2');
    expect(routed.status).toBe('SUCCESS');
    if (routed.status === 'SUCCESS') expect(routed.plan.versions.templateLibrary).toBe('2.0.0');
  });
});

const SRC_ROOT = join(__dirname, '../..');
const EXCLUDED_DIR_NAMES = new Set(['__tests__', 'node_modules']);

/** Strips line and block comments so doc-comment mentions of a module/function name don't false-positive as real usage. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function collectProductionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) collectProductionFiles(fullPath, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) out.push(fullPath);
  }
  return out;
}

describe('Fase 9 §18 — generation-version decision is structurally centralized', () => {
  const functionsPrefix = 'functions' + sep;
  const productionFiles = collectProductionFiles(SRC_ROOT)
    .filter((path) => !relative(SRC_ROOT, path).startsWith(functionsPrefix));

  function endsWithSegment(path: string, name: string): boolean {
    return path.endsWith(sep + name);
  }

  it('no production file other than generatePrescription.ts imports engineV127', () => {
    const offenders = productionFiles.filter((path) => {
      if (endsWithSegment(path, 'generatePrescription.ts')) return false;
      if (endsWithSegment(path, 'engineV127.ts')) return false;
      const source = stripComments(readFileSync(path, 'utf8'));
      return source.includes('engineV127');
    });
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it('no production file other than generatePrescription.ts and generationVersion.ts itself calls resolveGenerationVersion', () => {
    const offenders = productionFiles.filter((path) => {
      if (endsWithSegment(path, 'generatePrescription.ts')) return false;
      if (endsWithSegment(path, 'generationVersion.ts')) return false;
      if (endsWithSegment(path, 'engineV127.ts')) return false;
      const source = stripComments(readFileSync(path, 'utf8'));
      return source.includes('resolveGenerationVersion');
    });
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it('resolveGenerationVersion itself still hardcodes a single default line (Fase 11: v1.27)', () => {
    expect(resolveGenerationVersion()).toBe('v1.27');
  });

  it('an explicit v2 override remains a single-point rollback', () => {
    expect(resolveGenerationVersion('v2')).toBe('v2');
  });
});
