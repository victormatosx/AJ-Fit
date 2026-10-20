#!/usr/bin/env node

// Phase 10 (docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md):
// the schedule rotation resolver and calendar authority
// (`src/scheduleEngine/{calendar,resolver,types,localDate,calendarAuthority}.ts`)
// is pure, dependency-free TS with no RN/Expo imports except the `Weekday` type from
// `src/state/AppState.tsx` (a React/RN module). To make the backend authoritative for
// "what session was expected on this date" (instead of trusting `execution.sessionIndex`),
// Cloud Functions needs the exact same resolver logic — not a hand-reimplementation that could
// drift from the client's behavior. Firebase deploy only packages `functions/`, so a bare
// cross-directory import would not survive `firebase deploy`; this script copies the pure
// source into a generated, gitignored directory inside `functions/` before build/test/typecheck.
// `src/scheduleEngine/` remains the single source of truth — never edit the generated copy.
//
// `--check` (audit hardening): verifies the generated directory already matches what the
// transform below would produce from the CURRENT source, without writing anything. Exposed as
// `module.exports` too, so `functions/src/workoutLifecycle/__tests__/scheduleEngineSync.test.ts`
// can run the exact same check as a normal Vitest assertion — a safety net for any entry point
// (a direct `vitest`/`tsc` invocation, an IDE test runner) that bypasses the `pretest`/
// `pretypecheck`/`prebuild` npm hooks which otherwise re-run this script unconditionally.

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'src', 'scheduleEngine');
const DEST_DIR = path.join(REPO_ROOT, 'functions', 'src', 'workoutLifecycle', 'scheduleEngine');

const FILES = ['calendar.ts', 'resolver.ts', 'types.ts', 'localDate.ts', 'identities.ts', 'calendarAuthority.ts', 'reposition.ts', 'sessionSuggestion.ts', 'dailyWorkoutLimit.ts', 'freeScheduleResolver.ts', 'workoutPilot.ts'];

const HEADER = `// GENERATED FILE — do not edit directly.
// Synced from src/scheduleEngine by scripts/syncScheduleEngineToFunctions.cjs.
// Edit the source file in src/scheduleEngine/ and re-run \`npm run sync:scheduleEngine\`.
`;

/**
 * Pure: the exact content each generated file must have right now, derived
 * from the current `src/scheduleEngine/` source. This is the ONLY place that
 * knows the transform rule (header + the `AppState` import redirect) —
 * `sync()` (write) and `check()` (read-only compare) both call this, so
 * there is never a second, independently maintained copy of "what the
 * generated file should look like" to drift from this one.
 */
function expectedSyncedFiles() {
  return FILES.map((file) => {
    const sourcePath = path.join(SOURCE_DIR, file);
    if (!existsSync(sourcePath)) {
      throw new Error(`syncScheduleEngineToFunctions: missing source file ${sourcePath}`);
    }
    let contents = readFileSync(sourcePath, 'utf8');
    // The only non-relative-to-scheduleEngine import in this closure: the pure
    // `Weekday`/`WEEKDAY_ORDER` type from the RN-only AppState module. Redirect
    // it to the hand-written, checked-in shim next to the generated copy.
    contents = contents.replace(/from ['"]\.\.\/state\/AppState['"]/g, "from './weekday'");
    return { file, destPath: path.join(DEST_DIR, file), expected: HEADER + contents };
  });
}

/** Original default behavior: writes the synced files to disk, unconditionally. */
function sync() {
  mkdirSync(DEST_DIR, { recursive: true });
  const synced = expectedSyncedFiles();
  for (const { destPath, expected } of synced) writeFileSync(destPath, expected);
  return synced;
}

/**
 * Read-only: every generated file that is currently missing or whose content
 * doesn't match what `sync()` would write right now. Empty = fully in sync.
 * Never writes anything, so it is safe to call from a test or a CI step.
 */
function check() {
  return expectedSyncedFiles().filter(({ destPath, expected }) => (
    !existsSync(destPath) || readFileSync(destPath, 'utf8') !== expected
  ));
}

function runCli() {
  if (process.argv.includes('--check')) {
    const stale = check();
    if (stale.length > 0) {
      console.error('syncScheduleEngineToFunctions --check: OUT OF SYNC with src/scheduleEngine/.');
      for (const { file, destPath } of stale) {
        console.error(`  - ${file} -> ${path.relative(REPO_ROOT, destPath)} (missing or stale)`);
      }
      console.error('Run `npm run sync:scheduleEngine` (inside functions/) before building/testing/deploying.');
      process.exit(1);
    }
    console.log(`syncScheduleEngineToFunctions --check: ${FILES.length} files in sync.`);
    return;
  }
  const synced = sync();
  console.log(`syncScheduleEngineToFunctions: synced ${synced.length} files into ${path.relative(REPO_ROOT, DEST_DIR)}`);
}

if (require.main === module) {
  runCli();
}

module.exports = { FILES, SOURCE_DIR, DEST_DIR, expectedSyncedFiles, sync, check };
