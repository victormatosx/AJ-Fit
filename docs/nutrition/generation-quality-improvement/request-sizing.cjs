// Offline provider serialization using a stubbed fetch. NO requests leave this process.
const fs = require('node:fs');
const path = require('node:path');
const { OpenAiNutritionProvider } = require('../../../functions/lib/nutrition/ai/provider');
const { generateValidatedPlan } = require('../../../functions/lib/nutrition/generation/attempts');
const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, '../adaptive-ai-recovery-final/release-homologation/ledger.json'), 'utf8'));
const examples = ledger.runs.flatMap(r => r.calls.filter(c => c.reviewRequest).map(c => c.reviewRequest));
const rows = [];
(async () => {
 for (const run of ledger.runs) {
  const sample = run.calls.find(c => c.reviewRequest)?.reviewRequest ?? examples.find(r =>
   run.scenario === 'milk' ? r.profile.excludedAllergens.includes('milk') :
    run.scenario === 'gluten' ? r.profile.excludedSubstances.includes('gluten') : r.profile.dietaryPattern === 'vegetarian');
  let cursor = 0;
  const offline = new OpenAiNutritionProvider('offline-test-key', async (_url, init) => {
   const body = JSON.parse(init.body);
   rows.push({ job: run.index, call: cursor + 1, role: run.calls[cursor].role,
    inputBoundBytes: Buffer.byteLength(JSON.stringify({ input: body.input, schema: body.text.format.schema }), 'utf8') + 2048 });
   return new Response(JSON.stringify({ status: 'completed', model: 'gpt-6-luna', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }), { status: 200 });
  });
  const invoke = async (role, request) => {
   if (run.calls[cursor]?.role !== role) throw new Error('REPLAY_SEQUENCE_CHANGED');
   if (role === 'creator') await offline.generatePlan(request); else await offline.reviewPlan(request);
   return run.calls[cursor++].response;
  };
  try {
   await generateValidatedPlan({ generatePlan: r => invoke('creator', r), reviewPlan: r => invoke('reviewer', r) },
    sample.profile, sample.targets.engine, sample.goal, sample.foodNames, undefined, undefined, { physicalContext: sample.physicalContext });
  } catch (error) { if (error.code !== 'AI_RETRY_EXHAUSTED') throw error; }
  if (cursor !== run.calls.length) throw new Error('REPLAY_CALL_COUNT_CHANGED');
 }
 fs.writeFileSync(path.join(__dirname, 'request-sizing.json'), JSON.stringify({ kind: 'offline serialization, stubbed fetch, zero network',
  calls: rows.length, maxCreatorBound: Math.max(...rows.filter(r => r.role === 'creator').map(r => r.inputBoundBytes)),
  maxReviewerBound: Math.max(...rows.filter(r => r.role === 'reviewer').map(r => r.inputBoundBytes)), rows }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
