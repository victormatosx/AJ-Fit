/* global __dirname */
// Read-only prepublication inventory for the MAIN workspace. Never deploys.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'functions/package.json'));
const { applicationDefault } = req('firebase-admin/app');
const project = 'ajfit-2f321';
const expectedRules = '8e39e577775ff786fa7039871a0db167548356e3a9045252cb9bc26433b4dfcd';
const expectedDiaryRevision = '2026-10-19T01:54:15.683197417Z';

(async () => {
  const token = (await applicationDefault().getAccessToken()).access_token;
  async function get(url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Management read HTTP ${response.status}`);
    return response.json();
  }
  const inventory = await get(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/us-central1/functions?pageSize=100`);
  if (inventory.nextPageToken) throw Error('Inventory incomplete; review pagination before publication');
  const release = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
  const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  const rules = ruleset.source.files.find(file => file.name === 'firestore.rules').content;
  const hash = crypto.createHash('sha256').update(rules).digest('hex');
  if (hash !== expectedRules) throw Error('Published Rules changed independently: stop and review; never overwrite from the local workspace');
  const target = inventory.functions.find(f => f.name.endsWith('/mutateNutritionDiaryV1'));
  if (!target || target.state !== 'ACTIVE') throw Error('Existing diary endpoint not ACTIVE');
  if (target.updateTime !== expectedDiaryRevision) throw Error('Diary endpoint changed independently: stop and compare its source before publication');
  const output = { project, checkedAt: new Date().toISOString(), productionWrites: 0,
    publishedRulesSHA256: hash, localRulesIdentical: rules === fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'),
    rulesDeploymentNeededForGlobalMode: false,
    recommendedFutureTarget: 'functions:mutateNutritionDiaryV1',
    target: { state: target.state, updateTime: target.updateTime,
      enabled: target.serviceConfig?.environmentVariables?.NUTRITION_PLAN_SNAPSHOT_ENABLED,
      legacyUIDAllowlistPresent: !!target.serviceConfig?.environmentVariables?.NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS },
    functions: inventory.functions.map(f => ({ name: f.name.split('/').pop(), updateTime: f.updateTime })) };
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, functions: `${output.functions.length} revisions inventoried` }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
