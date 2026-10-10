#!/usr/bin/env node
// The app's pure nutrition contracts, engine and math are the single source of truth.
// Functions deploy packages only functions/, so sync the same sources before build/test.
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  'types/nutrition.ts',
  'nutrition/rolloutCore.ts',
  ...['index', 'constants', 'calculateEnergyTarget', 'calculateFiber', 'calculateMacros',
    'calculateRmr', 'calculateTdee', 'distributeMeals', 'errors', 'resolveGoalCategory',
    'validateInput'].map((name) => `nutrition/engine/${name}.ts`),
  'nutrition/catalog/math.ts',
  'nutrition/analytics/contract.ts',
];
const shim = `export type Sex = 'm' | 'f';
export type PrimaryGoal = 'gain_muscle' | 'lose_fat' | 'strength' | 'conditioning' | 'health';
export type DeprecatedGoal = 'body_composition' | 'return_to_training';
export type LegacyGoal = 'hyper' | 'cut' | 'perf' | 'def' | 'recon';
`;
function expected() {
  return [
    { dest: 'state/AppState.ts', content: shim },
    ...files.map((file) => ({ dest: file, content: `// GENERATED from src/${file}; do not edit.\n` + readFileSync(path.join(root, 'src', file), 'utf8') })),
  ];
}
function sync(check = false) {
  const stale = [];
  for (const { dest, content } of expected()) {
    const target = path.join(root, 'functions/src/nutrition/shared', dest);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) {
      stale.push(dest);
      if (!check) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, content); }
    }
  }
  return stale;
}
if (require.main === module) {
  const stale = sync(process.argv.includes('--check'));
  if (process.argv.includes('--check') && stale.length) { console.error(stale.join('\n')); process.exitCode = 1; }
  else console.log(`Nutrition shared sources: ${stale.length} synchronized`);
}
module.exports = { sync };
