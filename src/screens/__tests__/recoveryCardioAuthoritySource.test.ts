import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

function handleFinishRecoveryBody(): string {
  const start = shell.indexOf('const handleFinishRecovery = () => {');
  const end = shell.indexOf('const retryWorkoutCompletion = async () =>', start);
  return shell.slice(start, end);
}

describe('recovery finish — authoritative cardio-finisher source (root-cause fix)', () => {
  it('never decides EARLY/NORMAL from the in-memory activeProgram cache', () => {
    const body = handleFinishRecoveryBody();
    // The old call site passed this expression straight into
    // `recoveryFinalizationMode`'s second argument; only the explanatory
    // comment (added by this fix) may still mention it in text.
    expect(body).not.toContain('recoveryFinalizationMode(\n          fresh,\n          !!activeProgram');
    expect(body).toContain('const mode = recoveryFinalizationMode(fresh, hasCardioFinisher);');
  });

  it('reads the same authoritative program document the backend preflight uses', () => {
    const body = handleFinishRecoveryBody();
    expect(body).toContain('resolveAuthoritativeCardioFinisherPresence({');
    expect(body).toContain('loadProgram: (programId) => loadWorkoutProgramSnapshot(user.uid, programId)');
    expect(shell).toContain(
      "import {\n  loadAuthoritativelyCommittedFinalization,\n  resolveAuthoritativeCardioFinisherPresence,\n} from '../workoutLifecycle/finalizationRecovery';",
    );
  });

  it('only pays for the authoritative read in the one case it can change the outcome', () => {
    const body = handleFinishRecoveryBody();
    const guard = body.slice(
      body.indexOf('let hasCardioFinisher = false;'),
      body.indexOf('resolveAuthoritativeCardioFinisherPresence({'),
    );
    expect(guard).toContain('if (!fresh.finalizationMode && !hasPendingSet && !cardioSettled) {');
  });

  it('never silently falls back to NORMAL when the authoritative read fails or is ambiguous', () => {
    const body = handleFinishRecoveryBody();
    const failureBranch = body.slice(
      body.indexOf('if (presence === null) {'),
      body.indexOf('} else {\n            hasCardioFinisher = presence;'),
    );
    expect(failureBranch).toContain('hasCardioFinisher = true;');
    expect(failureBranch).toContain("logWarn('workout_execution', 'recovery_cardio_finisher_lookup_failed'");
    expect(failureBranch).not.toContain('hasCardioFinisher = false');
  });

  it('still feeds the resolved presence into the existing pure recoveryFinalizationMode, unchanged', () => {
    const body = handleFinishRecoveryBody();
    expect(body).toContain('const mode = recoveryFinalizationMode(fresh, hasCardioFinisher);');
    expect(body).toContain('const result = await runWorkoutCompletion(true, undefined, mode, fresh);');
  });
});
