import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOOK = readFileSync('src/workoutExecution/useWorkoutExecution.ts', 'utf8');
const MODAL = readFileSync('src/components/workout/WorkoutExecutionPendingModal.tsx', 'utf8');
const SERVICE = readFileSync('src/services/workoutExecutions.ts', 'utf8');
const LOCALES = ['pt-BR', 'en', 'es'] as const;

/**
 * PRODUCTION INCIDENT, 2026-10-19 — the start failure surfaced as
 * `errorCode: UNKNOWN` even though the service had thrown a perfectly
 * specific `SESSION_ALREADY_FINISHED`. Only `CONFLICT` and `LEGACY_PENDING`
 * were ever mapped, so every other domain outcome — including the daily limit
 * doing exactly its job — was presented as "algo deu errado".
 *
 * What this pins is that the two domain outcomes the start path can legitimately
 * produce reach the UI as themselves.
 */
describe('start failures carry their real reason to the UI', () => {
  it('the service throws exactly the two message-coded domain outcomes', () => {
    expect(SERVICE).toContain("throw new Error('WORKOUT_DAILY_LIMIT_REACHED')");
    expect(SERVICE).toContain("throw new Error('SESSION_ALREADY_FINISHED')");
  });

  it('the error union names both instead of collapsing them into UNKNOWN', () => {
    expect(HOOK).toContain("| { code: 'DAILY_LIMIT' }");
    expect(HOOK).toContain("| { code: 'SESSION_ALREADY_FINISHED' }");
  });

  it('both are mapped BEFORE the UNKNOWN fallback', () => {
    const start = HOOK.indexOf('const startError: WorkoutExecutionStartError =');
    expect(start).toBeGreaterThan(-1);
    const block = HOOK.slice(start, HOOK.indexOf('setStartError(startError);', start));
    const daily = block.indexOf("message === 'WORKOUT_DAILY_LIMIT_REACHED'");
    const finished = block.indexOf("message === 'SESSION_ALREADY_FINISHED'");
    const unknown = block.lastIndexOf("{ code: 'UNKNOWN' }");
    expect(daily).toBeGreaterThan(-1);
    expect(finished).toBeGreaterThan(-1);
    expect(unknown).toBeGreaterThan(finished);
    expect(unknown).toBeGreaterThan(daily);
  });

  it('the typed transport errors still take precedence over the message codes', () => {
    // A CONFLICT must never be re-read as a domain outcome just because its
    // message happens to change one day.
    const start = HOOK.indexOf('const startError: WorkoutExecutionStartError =');
    const block = HOOK.slice(start, HOOK.indexOf('setStartError(startError);', start));
    expect(block.indexOf('WorkoutExecutionConflictError'))
      .toBeLessThan(block.indexOf("message === 'WORKOUT_DAILY_LIMIT_REACHED'"));
    expect(block.indexOf('WorkoutExecutionLegacyPendingError'))
      .toBeLessThan(block.indexOf("message === 'WORKOUT_DAILY_LIMIT_REACHED'"));
  });
});

describe('the daily limit reads as a rule, not as a failure', () => {
  it('gets its own title and body, not the generic start-error copy', () => {
    expect(MODAL).toContain("error?.code === 'DAILY_LIMIT'\n    ? t('dailyLimit.title')");
    expect(MODAL).toContain("? t('dailyLimit.body')");
  });

  it('offers no "abandon previous" action — there is nothing pending', () => {
    // `executionId` drives that button and is only ever set for CONFLICT and
    // LEGACY_PENDING, so the daily-limit state cannot offer it.
    const start = MODAL.indexOf('const executionId = ambiguous');
    // The ternary chain only, stopping at its own terminator — the comment
    // above `const title` legitimately names the codes.
    const block = MODAL.slice(start, MODAL.indexOf(': null;', start));
    expect(block).not.toContain('DAILY_LIMIT');
    expect(block).not.toContain('SESSION_ALREADY_FINISHED');
  });

  it('SESSION_ALREADY_FINISHED explains the date instead of saying "something went wrong"', () => {
    expect(MODAL).toContain("? t('startError.alreadyFinishedBody')");
  });

  it('keeps the generic copy for genuinely unknown failures', () => {
    expect(MODAL).toContain("t('startError.body')");
    expect(MODAL).toContain("t('startError.title')");
  });
});

describe('copy exists in every locale, additively', () => {
  for (const locale of LOCALES) {
    it(`${locale}`, () => {
      const json = JSON.parse(readFileSync(`src/i18n/resources/${locale}/workout.json`, 'utf8'));
      expect(typeof json.dailyLimit.title).toBe('string');
      expect(json.dailyLimit.body).toMatch(/amanh|tomorrow|mañana/i);
      expect(typeof json.startError.alreadyFinishedBody).toBe('string');
      // Pre-existing neighbours untouched.
      expect(typeof json.startError.title).toBe('string');
      expect(typeof json.startError.body).toBe('string');
    });
  }
});
