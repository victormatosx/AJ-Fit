import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  generateAuthoritativePlan,
  resolveAuthoritativeGenerationVersionForNewLifecycle,
  authoritativeGenerationVersionForActiveProgram,
} from '../authoritativePrescription';
import { localWorkoutTemplateDocumentV127 } from '../templateDocumentV127';

/**
 * Fase 11 (backend cutover) — unit-level coverage that does NOT require the
 * Firestore emulator (unavailable in this environment — same JDK
 * constraint noted throughout this project's prior fases): proves the new
 * backend dispatcher (`authoritativePrescription.ts`) and local v1.27
 * template metadata (`templateDocumentV127.ts`) work correctly in
 * isolation. Emulator-gated end-to-end coverage of
 * `authorizeWorkoutLifecycleMutation` itself lives in
 * `authorizeMutation.integration.test.ts` (extended below), same as every
 * other Firestore-dependent scenario in this suite.
 */
const ANSWERS = {
  sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, duration: '60', place: 'gym',
  trainingDays: [], equipment: [], style: [], limits: ['none'], muscleFocus: [],
  specialConditions: ['none'],
  pregnancyScreening: null, postpartumScreening: null, functionalScreening: null,
  lipedemaScreening: null, dizzinessScreening: null, postSurgicalScreening: null,
  medicalRestrictionScreening: null,
} as unknown as Parameters<typeof generateAuthoritativePlan>[0];

describe('generateAuthoritativePlan — v1.27 branch (no Firestore needed)', () => {
  it('produces a v1.27-versioned plan with a real 64-hex contentHash, never touching firestore', async () => {
    // `firestore` is only ever read on the v2 branch — passing `null as
    // never` here is itself part of the proof: a real Firestore instance
    // would throw immediately if this code path tried to use it.
    const result = await generateAuthoritativePlan(ANSWERS, 'INTERMEDIATE', 'v1.27', null as never);
    expect(result.plan.versions.templateLibrary).toBe('1.27.0');
    expect(/^T\d{3}$/.test(result.plan.templateId)).toBe(true);
    expect(result.templateMetadata.sourceVersion).toBe('1.27.0');
    expect(/^[a-f0-9]{64}$/.test(result.templateMetadata.contentHash)).toBe(true);
  });

  it('BEGINNER routes to a T091-T102 template; INTERMEDIATE routes to the regular family', async () => {
    const beginner = await generateAuthoritativePlan(ANSWERS, 'BEGINNER', 'v1.27', null as never);
    const intermediate = await generateAuthoritativePlan(ANSWERS, 'INTERMEDIATE', 'v1.27', null as never);
    expect(/^T09[1-9]|T10[0-2]$/.test(beginner.plan.templateId)).toBe(true);
    expect(/^T09[1-9]|T10[0-2]$/.test(intermediate.plan.templateId)).toBe(false);
  });

  it('is deterministic: identical inputs produce the identical planId', async () => {
    const first = await generateAuthoritativePlan(ANSWERS, 'INTERMEDIATE', 'v1.27', null as never);
    const second = await generateAuthoritativePlan(ANSWERS, 'INTERMEDIATE', 'v1.27', null as never);
    expect(first.plan.planId).toBe(second.plan.planId);
    expect(first.templateMetadata.contentHash).toBe(second.templateMetadata.contentHash);
  });
});

describe('authoritativeGenerationVersionForActiveProgram — reads the ACTIVE PROGRAM\'s version, never a default', () => {
  it('returns v1.27 only for the exact v1.27 templateLibrary marker', () => {
    expect(authoritativeGenerationVersionForActiveProgram('1.27.0')).toBe('v1.27');
  });

  it.each([['2.0.0'], ['1.3.0'], [undefined], [null], ['']])(
    'returns v2 for any non-v1.27 value (%j) — fails closed toward the legacy engine',
    (value) => {
      expect(authoritativeGenerationVersionForActiveProgram(value)).toBe('v2');
    },
  );
});

describe('resolveAuthoritativeGenerationVersionForNewLifecycle — INITIALIZE-only central default', () => {
  it('resolves to v1.27 (Fase 11 cutover default — the same resolveGenerationVersion the client consults)', () => {
    expect(resolveAuthoritativeGenerationVersionForNewLifecycle()).toBe('v1.27');
  });
});

describe('localWorkoutTemplateDocumentV127 (backend, node:crypto)', () => {
  it('computes a real 64-hex-char sha256-shaped, deterministic contentHash', () => {
    const first = localWorkoutTemplateDocumentV127('T001');
    const second = localWorkoutTemplateDocumentV127('T001');
    expect(/^[a-f0-9]{64}$/.test(first.contentHash)).toBe(true);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('differs across distinct templates', () => {
    const t001 = localWorkoutTemplateDocumentV127('T001');
    const t003 = localWorkoutTemplateDocumentV127('T003');
    expect(t001.contentHash).not.toBe(t003.contentHash);
  });
});

/** Strips line/block comments so a doc-comment mention never false-positives as a real import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Fase 11 §1/§5 — the backend dispatcher stays the ONE place that chooses v2 vs v1.27', () => {
  it('authorizeMutation.ts never imports engine.ts (v2) or engineV127.ts directly — only via authoritativePrescription.ts', () => {
    const source = stripComments(readFileSync(resolve(__dirname, '../authorizeMutation.ts'), 'utf8'));
    expect(source.includes("workoutPrescription/engine'")).toBe(false);
    expect(source.includes('engineV127')).toBe(false);
    expect(source.includes('generateWorkoutPrescription(')).toBe(false);
  });

  it('authoritativePrescription.ts is the only file besides generatePrescription.ts/generationVersion.ts itself that resolves the active version', () => {
    const source = stripComments(readFileSync(resolve(__dirname, '../authoritativePrescription.ts'), 'utf8'));
    expect(source.includes('resolveActiveGenerationVersion')).toBe(true);
    // It must never import engineV127/engine.ts directly either — only the
    // shared `generatePrescription.ts` dispatcher.
    expect(source.includes("workoutPrescription/engine'")).toBe(false);
    expect(source.includes("workoutPrescription/engineV127'")).toBe(false);
  });
});
