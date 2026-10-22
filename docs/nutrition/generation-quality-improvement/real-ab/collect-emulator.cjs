// Read-only collection of synthetic experiment evidence, no provider/API call.
const fs = require('node:fs');
const path = require('node:path');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== 'demo-ajfit-quality-comparison') throw new Error('EMULATOR_ONLY');
const root = path.resolve(__dirname, '../../../..');
const fromFunctions = require('node:module').createRequire(path.join(root, 'functions/package.json'));
const { initializeApp } = fromFunctions('firebase-admin/app');
const { getFirestore } = fromFunctions('firebase-admin/firestore');
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();
const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, 'ledger.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'comparison-snapshots.json'), 'utf8'));
(async () => {
 const results = [];
 for (const r of ledger.runs) {
  if (!r.uid.startsWith('synthetic-quality-')) throw new Error('UNEXPECTED_USER');
  const user = db.collection('users').doc(r.uid);
  const { loadGenerationContext } = require(path.join(manifest.arms[r.result.arm].work, 'lib/nutrition/generation/context'));
  const context = await loadGenerationContext(db, r.uid);
  const job = await user.collection('nutritionGenerationJobs').doc(r.generationId).get();
  const plan = await user.collection('nutritionPlans').doc(r.generationId).get();
  const prior = await user.collection('nutritionPlans').doc('synthetic-prior').get();
  const rate = await db.collection('nutritionRateLimits').doc(r.uid).get();
  const operations = await db.collection('nutritionAiOperations').where('generationId', '==', r.generationId).get();
  results.push({ index: r.index, uid: r.uid, generationId: r.generationId, context, job: job.data(), planExists: plan.exists,
    plan: plan.data() ?? null, prior: prior.data(), rate: rate.data(), operations: operations.docs.map(d => ({ id: d.id, ...d.data() })) });
 }
 fs.writeFileSync(path.join(__dirname, 'firestore-final-evidence.json'), JSON.stringify({ emulatorProject: process.env.GCLOUD_PROJECT,
  jobs: results, totalOperations: (await db.collection('nutritionAiOperations').get()).size }, null, 2) + '\n');
 await db.terminate(); console.log('Captured terminal synthetic jobs: ' + results.length);
})().catch(error => { console.error(error); process.exitCode = 1; });
