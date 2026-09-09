#!/usr/bin/env node

// Phase 10 (docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md):
// the schedule rotation resolver (`src/scheduleEngine/{calendar,resolver,types,localDate}.ts`)
// is pure, dependency-free TS with no RN/Expo imports except the `Weekday` type from
// `src/state/AppState.tsx` (a React/RN module). To make the backend authoritative for
// "what session was expected on this date" (instead of trusting `execution.sessionIndex`),
// Cloud Functions needs the exact same resolver logic — not a hand-reimplementation that could
// drift from the client's behavior. Firebase deploy only packages `functions/`, so a bare
// cross-directory import would not survive `firebase deploy`; this script copies the pure
// source into a generated, gitignored directory inside `functions/` before build/test/typecheck.
// `src/scheduleEngine/` remains the single source of truth — never edit the generated copy.

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'src', 'scheduleEngine');
const DEST_DIR = path.join(REPO_ROOT, 'functions', 'src', 'workoutLifecycle', 'scheduleEngine');

const FILES = ['calendar.ts', 'resolver.ts', 'types.ts', 'localDate.ts', 'identities.ts'];

const HEADER = `// GENERATED FILE — do not edit directly.
// Synced from src/scheduleEngine by scripts/syncScheduleEngineToFunctions.cjs.
// Edit the source file in src/scheduleEngine/ and re-run \`npm run sync:scheduleEngine\`.
`;

mkdirSync(DEST_DIR, { recursive: true });

for (const file of FILES) {
  const sourcePath = path.join(SOURCE_DIR, file);
  if (!existsSync(sourcePath)) {
    console.error(`syncScheduleEngineToFunctions: missing source file ${sourcePath}`);
    process.exit(1);
  }
  let contents = readFileSync(sourcePath, 'utf8');
  // The only non-relative-to-scheduleEngine import in this closure: the pure
  // `Weekday`/`WEEKDAY_ORDER` type from the RN-only AppState module. Redirect
  // it to the hand-written, checked-in shim next to the generated copy.
  contents = contents.replace(/from ['"]\.\.\/state\/AppState['"]/g, "from './weekday'");
  writeFileSync(path.join(DEST_DIR, file), HEADER + contents);
}

console.log(`syncScheduleEngineToFunctions: synced ${FILES.length} files into ${path.relative(REPO_ROOT, DEST_DIR)}`);
