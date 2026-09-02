#!/usr/bin/env node

// Phase 10B (docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md):
// the deterministic workout-prescription engine (`src/workoutPrescription/`) and the pure
// cycle-evolution transformer (`src/prescriptionEvolution/`) are pure, dependency-free TS
// (verified: no RN/Expo/Firebase imports anywhere in the pipeline, no randomness). The backend
// needs the SAME code — not a hand-reimplementation that could drift — to independently compute
// the canonical prescription instead of trusting a client-submitted plan. This script mirrors
// the exact source-tree layout under a generated root so every existing relative import
// (`../data/...`, `../types/...`, `../lib/...`, `../../docs/...`) resolves unchanged; the only
// dependency that can't be copied as-is is the value-level `Quiz`/`WEEKDAY_ORDER`/`defaultQuiz`
// export from the RN-adjacent `src/state/AppState.tsx` (a React Context module) — this script
// mechanically extracts just its pure type/const prefix into the same generated tree, at the
// exact path (`state/AppState.ts`) the real file would occupy, so no import needs rewriting.
//
// Firebase deploy only packages `functions/`, so none of this survives at its real path — it is
// copied into a generated, gitignored directory inside `functions/` before build/test/typecheck.
// The `src/` originals remain the single source of truth; never edit the generated copies.

const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEST_ROOT = path.join(REPO_ROOT, 'functions', 'src', 'workoutLifecycle', 'prescriptionEngine');
// `../../docs/...` from `<DEST_ROOT>/workoutPrescription/catalog.ts` resolves here.
const DOCS_DEST_ROOT = path.join(REPO_ROOT, 'functions', 'src', 'workoutLifecycle', 'docs');

const HEADER = `// GENERATED FILE — do not edit directly.
// Synced by scripts/syncPrescriptionEngineToFunctions.cjs. Edit the source file and re-run
// \`npm run sync:prescriptionEngine\`.
`;

// Directory mirrors src/<dir>/ exactly, so every relative import between these
// files resolves without any rewriting.
const TS_FILES = [
  ['workoutPrescription', ['types', 'input', 'personalization', 'catalog', 'safety', 'selection',
    'modifiers', 'conflicts', 'composition', 'equipment', 'limitationResolver', 'validation',
    'engine', 'templateDocument', 'generationPolicy', 'weeklySchedule', 'frequency',
    'restPrescription', 'limitationDataset', 'localLimitationCatalog', 'index']],
  ['data', ['exercisesSeedData']],
  ['types', ['exercise']],
  ['lib', ['questionnaireSchema']],
  ['onboarding', ['steps']],
  ['workoutLifecycle', ['types']],
  ['prescriptionEvolution', ['config', 'cycleEvolution', 'equivalence', 'levelPromotion']],
  // Phase 10D (docs/workout-lifecycle/v2/architecture/
  // 23_PHASE_10D_FINAL_AUTHORITY_BYPASS_REMEDIATION.md): the backend's
  // Intermediate→Advanced earned-cycle count must use the exact same rule
  // as the client's local mirror — a hand-reimplementation previously
  // under-counted legacy pre-8A V2 cycles relative to this module.
  ['progressionEngineV2', ['earnedCycles']],
];

const JSON_FILES = [
  'workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json',
  'workout-modifiers/exercise-limitations/15_LIMITATION_PROFILES_TECHNICAL_v2.json',
  'workout-modifiers/exercise-limitations/limitation-dataset-identity.json',
];

for (const [dir, files] of TS_FILES) {
  const destDir = path.join(DEST_ROOT, dir);
  mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const sourcePath = path.join(REPO_ROOT, 'src', dir, `${file}.ts`);
    if (!existsSync(sourcePath)) {
      console.error(`syncPrescriptionEngineToFunctions: missing source file ${sourcePath}`);
      process.exit(1);
    }
    const contents = readFileSync(sourcePath, 'utf8');
    writeFileSync(path.join(destDir, `${file}.ts`), HEADER + contents);
  }
}

for (const relativePath of JSON_FILES) {
  const sourcePath = path.join(REPO_ROOT, 'docs', relativePath);
  const destPath = path.join(DOCS_DEST_ROOT, relativePath);
  if (!existsSync(sourcePath)) {
    console.error(`syncPrescriptionEngineToFunctions: missing catalog JSON ${sourcePath}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(destPath), { recursive: true });
  copyFileSync(sourcePath, destPath);
}

// `state/AppState.ts`: a generated (not hand-written) extraction of AppState.tsx's pure
// type/const prefix — the Quiz type surface is too large to hand-maintain safely (unlike the
// small scheduleEngine `weekday.ts` shim), so it is mechanically sliced from the real file on
// every sync instead, guaranteeing it can never silently drift.
const appStateSourcePath = path.join(REPO_ROOT, 'src', 'state', 'AppState.tsx');
const appStateSource = readFileSync(appStateSourcePath, 'utf8');

const TYPES_START_MARKER = 'export type Sex =';
const UI_ONLY_START_MARKER = '\nexport type TabId =';
const DEFAULT_QUIZ_MARKER = '\nexport const defaultQuiz:';
const REACT_CONTEXT_MARKER = '\nconst AppStateContext = createContext';

const typesStart = appStateSource.indexOf(TYPES_START_MARKER);
const uiOnlyStart = appStateSource.indexOf(UI_ONLY_START_MARKER);
const defaultQuizStart = appStateSource.indexOf(DEFAULT_QUIZ_MARKER);
const reactContextStart = appStateSource.indexOf(REACT_CONTEXT_MARKER);
if (typesStart < 0 || uiOnlyStart < 0 || defaultQuizStart < 0 || reactContextStart < 0
  || !(typesStart < uiOnlyStart && uiOnlyStart < defaultQuizStart && defaultQuizStart < reactContextStart)) {
  console.error(
    'syncPrescriptionEngineToFunctions: AppState.tsx no longer matches the expected shape '
    + '(Sex/.../Quiz types, then TabId/Ctx, then defaultQuiz, then the React Context). '
    + 'Update the markers in this script to match the current file before re-running.',
  );
  process.exit(1);
}
// Pure types (Sex..Quiz) + defaultQuiz, skipping the RN/Firebase-adjacent TabId/Ctx block
// in between (never needed by the engine).
const appStateShim = HEADER
  + appStateSource.slice(typesStart, uiOnlyStart)
  + appStateSource.slice(defaultQuizStart + 1, reactContextStart);
mkdirSync(path.join(DEST_ROOT, 'state'), { recursive: true });
writeFileSync(path.join(DEST_ROOT, 'state', 'AppState.ts'), appStateShim);

console.log(`syncPrescriptionEngineToFunctions: synced ${TS_FILES.reduce((sum, [, files]) => sum + files.length, 0)} TS files, ${JSON_FILES.length} JSON catalogs, and the AppState type shim into ${path.relative(REPO_ROOT, DEST_ROOT)}`);
