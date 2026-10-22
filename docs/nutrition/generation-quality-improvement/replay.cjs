// Offline replay only. No provider, credentials, Firestore or network access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const here = __dirname;
const { parseAiOutput, validateAndBuildPlan } = require('../../../functions/lib/nutrition/generation/domain');
const { inspectFoodEvidence } = require('../../../functions/lib/nutrition/generation/reviewEvidence');
const source = path.resolve(here, '../adaptive-ai-recovery-final/release-homologation/ledger.json');
const ledger = JSON.parse(fs.readFileSync(source, 'utf8'));
const reviews = ledger.runs.flatMap(r => r.calls.filter(c => c.role === 'reviewer'));
const engines = new Set(reviews.map(c => JSON.stringify(c.reviewRequest.targets.engine)));
if (engines.size !== 1) throw new Error('Cannot infer common targets for unrevised historical jobs');
const engine = reviews[0].reviewRequest.targets.engine;
const names = { preferred: [], usual: [], excluded: [] };
const profiles = {
 milk: { dietaryPattern: 'omnivore', excludedAllergens: ['milk'], excludedSubstances: [], supplements: ['whey_or_protein'] },
 vegetarian: { dietaryPattern: 'vegetarian', excludedAllergens: [], excludedSubstances: [], supplements: [] },
 gluten: { dietaryPattern: 'omnivore', excludedAllergens: [], excludedSubstances: ['gluten'], supplements: [] },
};
(async () => {
 const results = [];
 for (const run of ledger.runs) {
  const profile = { ...profiles[run.scenario], mealSlots: engine.mealTargets.map(t => t.slot) };
  const calls = [];
  for (let index = 0; index < run.calls.length; index++) {
   const c = run.calls[index]; const original = run.result.operations.find(o => o.callNumber === index + 1);
   if (c.role === 'reviewer') {
    calls.push({ call: index + 1, role: c.role, status: c.response.output.status,
      issues: c.response.output.issues, digest: c.response.output.candidateDigest }); continue;
   }
   let replayFailure = null; let reason; let foodFailure; let diagnostics; let item;
   try {
    const parsed = parseAiOutput(c.response.output);
    await inspectFoodEvidence(parsed.meals.flatMap(m => m.foods), profile, names);
    validateAndBuildPlan(c.response.output, profile.mealSlots, engine, profile.excludedAllergens, true,
      { dietaryPattern: profile.dietaryPattern, excludedFoodNames: names.excluded });
   } catch (error) {
    replayFailure = error.code; reason = error.message; foodFailure = error.foodFailure; diagnostics = error.diagnostics;
    if (foodFailure) item = c.response.output.meals.flatMap(m => m.foods)[foodFailure.itemIndex];
   }
   if (replayFailure !== original.failureCode) throw new Error(`Replay divergence at job ${run.index} call ${index + 1}`);
   calls.push({ call: index + 1, role: c.role, originalFailure: original.failureCode,
    replayFailure, reason, foodFailure, item, diagnostics });
  }
  results.push({ job: run.index, scenario: run.scenario, calls });
 }
 const counts = {};
 for (const r of results) for (const c of r.calls) {
  const key = c.role === 'creator' ? c.replayFailure ?? 'creator_valid' : `reviewer_${c.status}`;
  counts[key] = (counts[key] ?? 0) + 1;
 }
 fs.writeFileSync(path.join(here, 'offline-replay.json'), JSON.stringify({
  kind: 'offline historical replay, not new real AI', sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  commonTargetsVerified: true, catalog: 'no product evidence; same empty optional source as recorded harness', counts, results,
 }, null, 2) + '\n');
 console.log(JSON.stringify(counts));
})().catch(error => { console.error(error); process.exitCode = 1; });
