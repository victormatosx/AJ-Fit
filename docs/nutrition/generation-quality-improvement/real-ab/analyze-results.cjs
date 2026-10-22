// Offline analysis of the complete ledger and terminal emulator snapshots. No AI calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const here = __dirname;
const ledger = JSON.parse(fs.readFileSync(path.join(here, 'ledger.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(here, 'PLAN.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'comparison-snapshots.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(here, 'firestore-final-evidence.json'), 'utf8'));
const sha = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const avg = xs => xs.length ? xs.reduce((a,b) => a+b, 0)/xs.length : null;
const median = xs => { if (!xs.length) return null; const a=[...xs].sort((a,b)=>a-b); return a.length%2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2; };
const counts = xs => xs.reduce((o,k)=>(o[k]=(o[k]??0)+1,o),{});
const rows = [], diagnostics = [], safety = [];
(async () => {
 for (const run of ledger.runs) {
  assert(run.result, 'Unresolved job');
  const scheduled = plan.jobs[run.index-1]; const arm = run.result.arm;
  assert.equal(scheduled.arm, arm); assert.equal(scheduled.scenario,run.scenario);
  const evidence = snapshot.jobs.find(j => j.index === run.index);
  const { parseAiOutput, validateAndBuildPlan } = require(path.join(manifest.arms[arm].work,'lib/nutrition/generation/domain'));
  const { inspectFoodEvidence } = require(path.join(manifest.arms[arm].work,'lib/nutrition/generation/reviewEvidence'));
  const { candidateDigest, parseNutritionReview } = require(path.join(manifest.arms[arm].work,'lib/nutrition/ai/review'));
  const { profile, engine, foodNames } = evidence.context;
  const operations = run.result.operations.sort((a,b)=>a.callNumber-b.callNumber);
  assert.equal(operations.length,run.calls.length); assert.equal(evidence.operations.length,run.calls.length);
  assert(run.calls.length <= 4); assert(run.result.aiReservedUsd <= .03); assert.equal(run.result.creditUsed,false);
  assert(['completed','failed'].includes(evidence.job.status)); assert.equal(evidence.planExists, run.result.success);
  const dailyFoodNames = [], mealCounts = [];
  let firstValid = false, firstCompact = 0, appliedCorrections = 0, totalMealsCorrected = 0;
  for (let i=0;i<run.calls.length;i++) {
   const call=run.calls[i]; const op=operations[i];
   assert.equal(op.callNumber,i+1); assert.equal(op.agentRole,call.role); assert(call.httpStartedAt); assert.equal(call.state,'responded');
   assert(call.estimatedCostUsd !== null); assert.equal(call.checkpoint.aiCallCount,i+1);
   const expectedReserved=run.calls.slice(0,i+1).reduce((s,c)=>s+c.reservedUsd,0);
   assert(Math.abs(call.checkpoint.aiReservedUsd-expectedReserved)<1e-8);
   if(call.role==='creator') assert(call.checkpoint.aiReservedUsd+.00715<=.030000001);
   if(call.role==='reviewer') {
    assert.equal(candidateDigest(call.reviewRequest.candidate),call.reviewRequest.candidateDigest);
    const review=parseNutritionReview(call.response.output,call.reviewRequest.candidateDigest);
    safety.push({job:run.index,call:i+1,type:'review_digest_contract',valid:true,status:review.status});
    diagnostics.push({job:run.index,arm,scenario:run.scenario,call:i+1,role:'reviewer',status:review.status,issues:review.issues});
    continue;
   }
   let replayCode=null, reason=null, diag=null, foodFailure=null, built=null;
   try {
    const parsed=parseAiOutput(call.response.output);
    await inspectFoodEvidence(parsed.meals.flatMap(m=>m.foods),profile,foodNames);
    built=validateAndBuildPlan(call.response.output,profile.mealSlots,engine,profile.excludedAllergens,true,
      {dietaryPattern:profile.dietaryPattern,excludedFoodNames:foodNames.excluded});
   } catch(error) { replayCode=error.code;reason=error.message;diag=error.diagnostics??null;foodFailure=error.foodFailure??null; }
   assert.equal(replayCode,op.failureCode,`Job ${run.index} creator ${i+1} replay divergence`);
   if(built) {
    const corrected=built.diagnostics.meals.filter(m=>m.correction.status==='applied');
    totalMealsCorrected+=corrected.length;appliedCorrections+=Number(built.corrected);
    diag=built.diagnostics;
   }
   if(i===0) {
    firstValid=replayCode===null;
    const meals=call.response.output?.meals??[];
    for(const m of meals) {
     mealCounts.push(m.foods?.length??0);
     if(m.foods?.length===1 && /^(prato|porcao|porcoes)$/.test(norm(m.foods[0].unit))) firstCompact++;
     for(const f of m.foods??[]) dailyFoodNames.push(norm(f.name));
    }
   }
   diagnostics.push({job:run.index,arm,scenario:run.scenario,call:i+1,role:'creator',failureCode:replayCode,
    reason,foodFailure,diagnostics:diag,corrected:built?.corrected??false});
  }
  if(run.result.success) {
   const last=run.calls.at(-1);assert.equal(last.role,'reviewer');assert.equal(last.response.output.status,'approved');
   assert.equal(evidence.plan.generationMetadata.review.candidateDigest,candidateDigest(last.reviewRequest.candidate));
   const validated=validateAndBuildPlan(last.reviewRequest.candidate,profile.mealSlots,engine,profile.excludedAllergens,false,
    {dietaryPattern:profile.dietaryPattern,excludedFoodNames:foodNames.excluded});
   assert(isDeepStrictEqual(validated.meals,evidence.plan.meals)); assert(isDeepStrictEqual(validated.dailyTotals,evidence.plan.dailyTotals));
   await inspectFoodEvidence(last.reviewRequest.candidate.meals.flatMap(m=>m.foods),profile,foodNames);
   assert.equal(evidence.prior.status,'archived');assert.equal(evidence.rate.activePlanId,run.generationId);
   safety.push({job:run.index,type:'approved_revalidation_persistence',valid:true,digest:candidateDigest(last.reviewRequest.candidate)});
  } else {
   assert(isDeepStrictEqual(evidence.prior,{planId:'synthetic-prior',status:'active',marker:'release-preservation-fixture'}));
   assert.equal(evidence.rate.activePlanId,'synthetic-prior');
   safety.push({job:run.index,type:'failed_prior_plan_preservation',valid:true});
  }
  rows.push({job:run.index,block:scheduled.block,scenario:run.scenario,arm,generationId:run.generationId,uid:run.uid,
   success:run.result.success,firstValid,firstApproved:run.result.firstCreationApproved,approvedAfterCorrection:run.result.approvedAfterCorrection,
   calls:run.calls.length,creatorCalls:run.calls.filter(c=>c.role==='creator').length,reviewerCalls:run.calls.filter(c=>c.role==='reviewer').length,
   sameFirstCreatorApproved:run.result.success&&run.calls.filter(c=>c.role==='creator').length===1,reservedUsd:run.calls.reduce((s,c)=>s+c.reservedUsd,0),costUsd:run.calls.reduce((s,c)=>s+c.estimatedCostUsd,0),
   durationMs:run.result.durationMs,lastFailureCode:run.result.success?null:run.result.lastFailureCode,
   sequence:operations.map(o=>({call:o.callNumber,role:o.agentRole,code:o.failureCode,status:o.reviewStatus??null})),
   firstCandidateFoods:dailyFoodNames.length,firstCandidateUniqueFoods:new Set(dailyFoodNames).size,firstCandidateFoodNames:dailyFoodNames,
   firstCandidateMeals:mealCounts.length,firstCandidateCompactMeals:firstCompact,firstCandidateFoodsPerMeal:avg(mealCounts),
   creatorCandidatesCorrected:appliedCorrections,mealsCorrected:totalMealsCorrected,
   approvedFoodNames:run.result.success?evidence.plan.meals.flatMap(m=>m.options[0].foods.map(f=>norm(f.name))):[],
  });
 }
 function aggregate(xs) {
  const creators=xs.flatMap(r=>diagnostics.filter(d=>d.job===r.job&&d.role==='creator'));
  const reviews=xs.flatMap(r=>diagnostics.filter(d=>d.job===r.job&&d.role==='reviewer'));
  const first=xs.map(r=>creators.find(d=>d.job===r.job));
  const cost=xs.reduce((s,r)=>s+r.costUsd,0), approved=xs.filter(r=>r.success);
  const selectedCalls=ledger.runs.filter(r=>xs.some(x=>x.job===r.index)).flatMap(r=>r.calls);
  const tokenTotals=Object.fromEntries(['inputTokens','outputTokens','cachedInputTokens'].map(k=>[k,selectedCalls.reduce((s,c)=>s+(c.response?.usage?.[k]??0),0)]));
  return {jobs:xs.length,tokenTotals,firstValid:xs.filter(r=>r.firstValid).length,firstApproved:xs.filter(r=>r.firstApproved).length,
   finalApproved:approved.length,sameFirstCreatorApproved:xs.filter(r=>r.sameFirstCreatorApproved).length,approvedAfterCorrection:xs.filter(r=>r.approvedAfterCorrection).length,failed:xs.filter(r=>!r.success).length,
   calls:xs.reduce((s,r)=>s+r.calls,0),meanCalls:avg(xs.map(r=>r.calls)),reservedUsd:xs.reduce((s,r)=>s+r.reservedUsd,0),costUsd:cost,
   costPerStartedJob:xs.length?cost/xs.length:null,costPerApprovedJobIncludingFailures:approved.length?cost/approved.length:null,
   meanJobSeconds:avg(xs.map(r=>r.durationMs/1000)),medianJobSeconds:median(xs.map(r=>r.durationMs/1000)),
   meanApprovedJobSeconds:avg(approved.map(r=>r.durationMs/1000)),
   firstCreationFailures:counts(first.filter(d=>d?.failureCode).map(d=>d.failureCode)),
   allCreatorFailures:counts(creators.filter(d=>d.failureCode).map(d=>d.failureCode)),
   finalFailureCodes:counts(xs.filter(r=>!r.success).map(r=>r.lastFailureCode)),reviewStatuses:counts(reviews.map(d=>d.status)),
   reviewerIssueCategories:counts(reviews.flatMap(d=>d.issues.map(i=>i.category))),
   meanFirstCandidateFoodCount:avg(xs.map(r=>r.firstCandidateFoods)),meanFirstCandidateUniqueFoods:avg(xs.map(r=>r.firstCandidateUniqueFoods)),
   meanFirstCandidateFoodsPerMeal:avg(xs.map(r=>r.firstCandidateFoodsPerMeal)),firstCandidateCompactMeals:xs.reduce((s,r)=>s+r.firstCandidateCompactMeals,0),
   firstCandidateMealCount:xs.reduce((s,r)=>s+r.firstCandidateMeals,0),firstCandidateDistinctFoodNames:new Set(xs.flatMap(r=>r.firstCandidateFoodNames)).size,
   meanApprovedUniqueFoods:avg(approved.map(r=>new Set(r.approvedFoodNames).size)),approvedDistinctFoodNames:new Set(approved.flatMap(r=>r.approvedFoodNames)).size,
   creatorCandidatesCorrected:xs.reduce((s,r)=>s+r.creatorCandidatesCorrected,0),mealsCorrected:xs.reduce((s,r)=>s+r.mealsCorrected,0)};
 }
 const arms=Object.fromEntries(['baseline','candidate'].map(arm=>[arm,aggregate(rows.filter(r=>r.arm===arm))]));
 const profiles=Object.fromEntries([...new Set(plan.jobs.map(j=>j.scenario))].map(s=>[s,Object.fromEntries(['baseline','candidate'].map(a=>[a,aggregate(rows.filter(r=>r.scenario===s&&r.arm===a))]))]));
 const b=arms.baseline,c=arms.candidate;
 const priority=['vegetarian','milk','gluten'];
 const criteria={complete36:rows.length===36&&b.jobs===18&&c.jobs===18,
  safetyPassed:safety.every(s=>s.valid),firstApprovalGainAtLeast3:c.firstApproved>=b.firstApproved+3,
  finalApprovalNotLower:c.finalApproved>=b.finalApproved,firstDeterministicValidityNotLower:c.firstValid>=b.firstValid,
  firstCompositionEvidenceFailuresReduced:['AI_MACRO_VALIDATION_FAILED','AI_EVIDENCE_INSUFFICIENT'].reduce((s,k)=>s+(c.firstCreationFailures[k]??0),0)<['AI_MACRO_VALIDATION_FAILED','AI_EVIDENCE_INSUFFICIENT'].reduce((s,k)=>s+(b.firstCreationFailures[k]??0),0),
  priorityProfilesWithFirstApprovalGain:priority.filter(s=>profiles[s].candidate.firstApproved>profiles[s].baseline.firstApproved),
  priorityProfilesWithFinalApprovalGain:priority.filter(s=>profiles[s].candidate.finalApproved>profiles[s].baseline.finalApproved),
 };
 assert(rows.reduce((s,r)=>s+r.reservedUsd,0)<=1.08000001);assert.equal(snapshot.totalOperations,rows.reduce((s,r)=>s+r.calls,0));
 const out={kind:'real authorized A/B, fixed plan, no statistical superiority claim',stopped:ledger.stopped,
  jobs:rows.length,paidHttpCalls:rows.reduce((s,r)=>s+r.calls,0),reservedUsd:rows.reduce((s,r)=>s+r.reservedUsd,0),
  estimatedCostUsd:rows.reduce((s,r)=>s+r.costUsd,0),criteria,arms,profiles,individualResults:rows};
 fs.writeFileSync(path.join(here,'SUMMARY.json'),JSON.stringify(out,null,2)+'\n');
 fs.writeFileSync(path.join(here,'diagnostics.json'),JSON.stringify(diagnostics,null,2)+'\n');
 fs.writeFileSync(path.join(here,'safety-verification.json'),JSON.stringify({checks:safety,allPassed:true},null,2)+'\n');
 console.log(JSON.stringify({arms,criteria,reservedUsd:out.reservedUsd,estimatedCostUsd:out.estimatedCostUsd},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
