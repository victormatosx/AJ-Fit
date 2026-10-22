// Creates isolated, frozen A/B source trees. Never runs AI or reads credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const here = __dirname;
const root = path.resolve(here, '../../..');
const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'ajfit-quality-comparison-'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const before = JSON.parse(fs.readFileSync(path.join(here, 'source-before.json'), 'utf8'));
const manifest = { destination, planSha256: sha(fs.readFileSync(path.join(here, 'PLAN.json'))), arms: {} };
for (const arm of ['baseline', 'candidate']) {
  const work = path.join(destination, arm, 'functions');
  fs.mkdirSync(work, { recursive: true });
  fs.cpSync(path.join(root, 'functions/src'), path.join(work, 'src'), { recursive: true });
  for (const name of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.mts']) {
    fs.copyFileSync(path.join(root, 'functions', name), path.join(work, name));
  }
  fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(work, 'node_modules'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, arm, 'node_modules'));
  // Only the five quality files differed from the task's initial runtime.
  if (arm === 'baseline') {
    for (const name of ['ai/prompt.ts', 'ai/config.ts', 'generation/attempts.ts', 'generation/domain.ts', 'generation/reviewEvidence.ts']) {
      const saved = fs.readFileSync(path.join(here, 'baseline', name + '.snapshot'));
      if (sha(saved) !== before[`functions/src/nutrition/${name}`]) throw new Error('BASELINE_HASH_MISMATCH');
      fs.writeFileSync(path.join(work, 'src/nutrition', name), saved);
    }
  }
  // Test-only policy normalization in disposable copies, identical in both arms.
  const configPath = path.join(work, 'src/nutrition/ai/config.ts');
  const config = fs.readFileSync(configPath, 'utf8');
  if (!config.includes('MAX_AI_CALLS = 5;') || !config.includes('MAX_JOB_RESERVED_USD = 0.04;')) throw new Error('UNEXPECTED_LOCAL_POLICY');
  fs.writeFileSync(configPath, config.replace('MAX_AI_CALLS = 5;', 'MAX_AI_CALLS = 4;')
    .replace('MAX_JOB_RESERVED_USD = 0.04;', 'MAX_JOB_RESERVED_USD = 0.03;'));
  fs.copyFileSync(path.join(here, 'comparison.manual.test.ts.template'),
    path.join(work, 'src/nutrition/__tests__/generationQualityComparison.manual.test.ts'));
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(file); }
      else if (entry.name.endsWith('.ts')) files[path.relative(work, file)] = sha(fs.readFileSync(file));
    }
  }
  walk(path.join(work, 'src/nutrition'));
  manifest.arms[arm] = { work, files, harnessSha256: sha(fs.readFileSync(path.join(work, 'src/nutrition/__tests__/generationQualityComparison.manual.test.ts'))) };
}
const a = manifest.arms.baseline.files, b = manifest.arms.candidate.files;
manifest.qualityDelta = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(file => a[file] !== b[file]);
const expected = ['src/nutrition/ai/config.ts', 'src/nutrition/ai/prompt.ts', 'src/nutrition/generation/attempts.ts',
  'src/nutrition/generation/domain.ts', 'src/nutrition/generation/reviewEvidence.ts'];
if (JSON.stringify(manifest.qualityDelta.sort()) !== JSON.stringify(expected.sort())) throw new Error('UNEXPECTED_COMPARISON_DELTA');
fs.copyFileSync(path.join(here, 'PLAN.json'), path.join(destination, 'PLAN.json'));
fs.writeFileSync(path.join(here, 'comparison-snapshots.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.copyFileSync(path.join(here, 'comparison-snapshots.json'), path.join(destination, 'comparison-snapshots.json'));
console.log(destination);
