import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const binding = readFileSync('src/workoutLifecycle/workoutActionCapability.ts', 'utf8');
const index = readFileSync('src/index.ts', 'utf8');
const endpoint = readFileSync('src/workoutLifecycle/externalWorkoutAction.ts', 'utf8');
const exampleEnv = readFileSync('../.env.example', 'utf8');

describe('Fase 4 preflight — HMAC remains server only', () => {
  it('defines one Secret Manager binding used explicitly by issuer and endpoint', () => {
    expect(binding).toContain("defineSecret('WORKOUT_ACTION_CAPABILITY_SECRET')");
    expect(index).toContain('{ enforceAppCheck: true, secrets: [WORKOUT_ACTION_CAPABILITY_SECRET] }');
    expect(index).toContain('{ secrets: [WORKOUT_ACTION_CAPABILITY_SECRET] }');
    expect(binding).toContain('deps.secret ?? WORKOUT_ACTION_CAPABILITY_SECRET.value()');
    expect(endpoint).toContain('deps.secret ?? WORKOUT_ACTION_CAPABILITY_SECRET.value()');
    expect(exampleEnv).not.toMatch(/EXPO_PUBLIC_.*(HMAC|CAPABILITY_SECRET)/);
  });

  it('verifies signature before trusting claims, without logging token or HMAC key', () => {
    expect(endpoint.indexOf('verifyWorkoutActionCapability(request.token, secret)'))
      .toBeLessThan(endpoint.indexOf('const claims = verification.claims'));
    expect(endpoint).toContain('claims.executionId !== request.executionId');
    expect(endpoint).not.toMatch(/log(?:Info|Warn)\([^\n]*\b(?:token|secret)\b/);
    expect(binding).not.toMatch(/console\.(?:log|error|warn)\(/);
  });
});
