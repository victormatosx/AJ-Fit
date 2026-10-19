import { assertCatalogBindingsCurrent } from '../catalogLinking/pipeline';
import { catalogLinkingEnabled, CATALOG_PIPELINE_VERSION, CATALOG_PLAN_SCHEMA_VERSION } from '../catalogLinking/config';
import { CatalogSearchSession, firestoreCatalogReader } from '../catalogLinking/search';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { logInfo, logWarn } from '../../lib/logger';
import { OPENAI_API_KEY, PROMPT_VERSION, AI_SCHEMA_VERSION, NUTRITION_AI_MODELS, FOOD_CATALOG_VERSION_PLACEHOLDER } from '../ai/config';
import { OpenAiNutritionProvider, type NutritionAiProvider } from '../ai/provider';
import { classifyAttemptError, generateValidatedPlan, GenerationAttemptsExhausted, type AttemptCode } from './attempts';
import { loadGenerationContext } from './context';
import { requireNutritionGenerationRollout } from './rollout';
import { resolvePromptFoodNames } from './foodNames';
import { recordAiOperation } from './operations';
import { trackNutritionBackendEvent } from '../analytics';
import { countBucket, durationBucket } from '../shared/nutrition/analytics/contract';
import { logValidationDiagnostics } from './diagnostics';

const LEASE_MS = 8 * 60 * 1000;
const JOB_STATUS_ACTIVE = ['queued', 'running', 'validating'];
type FinalCode = AttemptCode | 'FEATURE_DISABLED'
  | 'INVALID_NUTRITION_CONTEXT' | 'ACCOUNT_INACTIVE' | 'AI_PROVIDER_ERROR';

function errorCode(error: unknown): FinalCode {
  if (error instanceof GenerationAttemptsExhausted) return error.code;
  if (error instanceof Error && ['NUTRITION_GENERATION_DISABLED',
    'INVALID_NUTRITION_CONTEXT', 'ACCOUNT_INACTIVE', 'AI_PROVIDER_ERROR'].includes(error.message)) {
    return error.message === 'NUTRITION_GENERATION_DISABLED' ? 'FEATURE_DISABLED' : error.message as FinalCode;
  }
  return classifyAttemptError(error);
}
async function claim(db: Firestore, ref: DocumentReference, now: Timestamp): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || !JOB_STATUS_ACTIVE.includes(doc.get('status'))) return false;
    const lease = doc.get('leaseUntil');
    if (doc.get('status') !== 'queued' && lease instanceof Timestamp && lease.toMillis() > now.toMillis()) return false;
    const lock = await tx.get(db.collection('accountDeletionLocks').doc(ref.parent.parent!.id));
    if (lock.exists) return false;
    tx.update(ref, { status: 'running', startedAt: doc.get('startedAt') ?? now,
      leaseUntil: Timestamp.fromMillis(now.toMillis() + LEASE_MS),
      nextAttemptAt: Timestamp.fromMillis(now.toMillis() + LEASE_MS), updatedAt: now });
    return true;
  });
}

async function fail(db: Firestore, ref: DocumentReference, code: FinalCode): Promise<void> {
  const uid = ref.parent.parent!.id;
  const rate = db.collection('nutritionRateLimits').doc(uid);
  await db.runTransaction(async (tx) => {
    const [job, limit] = await Promise.all([tx.get(ref), tx.get(rate)]);
    if (!job.exists || job.get('status') === 'completed') return;
    tx.update(ref, { status: 'failed', errorCode: code, completedAt: Timestamp.now(), leaseUntil: null,
      nextAttemptAt: null });
    if (limit.get('activeGenerationId') === ref.id) tx.update(rate, { activeGenerationId: null, updatedAt: Timestamp.now() });
  });
  // `logWarn`'s sanitizer redacts ANY context key literally named `code`
  // (meant for secrets like OTP/verification codes) — this diagnostic enum
  // isn't one, so it's logged under `failureCode` instead, or Cloud Logging
  // would show `"[redacted]"` for every failure, exactly what made this
  // class of bug hard to diagnose from logs alone.
  logWarn('nutrition.generation', 'job_failed', { generationId: ref.id, failureCode: code });
}

export async function processNutritionGenerationJob(
  uid: string, generationId: string, provider: NutritionAiProvider,
  db: Firestore = defaultDb,
): Promise<boolean> {
  const operationStartedAt = Date.now();
  let observedAttempt = 0;
  const user = db.collection('users').doc(uid);
  const ref = user.collection('nutritionGenerationJobs').doc(generationId);
  if (!(await claim(db, ref, Timestamp.now()))) return false;
  let stage = 'context';
  logInfo('nutrition.generation', 'job_started', { generationId, stage });
  try {
    await requireNutritionGenerationRollout(db, uid);
    const context = await loadGenerationContext(db, uid);
    const foodNames = await resolvePromptFoodNames(db, context.profile, uid);
    const claimedJob = await ref.get();
    const catalogMode = claimedJob.get('generationMode') === 'catalog';
    if (catalogMode && !catalogLinkingEnabled()) throw new Error('NUTRITION_GENERATION_DISABLED');
    const deadline = operationStartedAt + 430_000;
    const catalogSession = catalogMode ? new CatalogSearchSession(firestoreCatalogReader(db), deadline) : undefined;
    const usedAttempts = claimedJob.get('aiAttemptCount');
    const startAttempt = typeof usedAttempts === 'number' && Number.isInteger(usedAttempts) ? usedAttempts + 1 : 1;
    const previousFailureCode = claimedJob.get('lastFailureCode');
    const { validated, result, attempt, fallback } = await generateValidatedPlan(
      provider, context.profile, context.engine, context.physical.goal, foodNames,
      async (audit) => {
        observedAttempt = audit.attempt;
        logValidationDiagnostics(audit.validationDiagnostics, { generationId, attempt: audit.attempt });
        logInfo('nutrition.generation', 'attempt_completed', { generationId, attempt: audit.attempt,
          stage: audit.result ? 'validation' : 'provider', failureCode: audit.code,
          durationMs: audit.latencyMs, fallback: audit.fallback,
          validationScope: audit.validationIssue?.scope, slot: audit.validationIssue?.slot,
          nutrients: audit.validationIssue?.nutrients });
        await recordAiOperation(db, { ownerUid: uid, generationId, operation: 'full_plan',
          defaultModel: audit.fallback ? NUTRITION_AI_MODELS.fallback : NUTRITION_AI_MODELS.fullPlan,
          attempt: audit.attempt, result: audit.result, code: audit.code, fallback: audit.fallback, latencyMs: audit.latencyMs, ...(catalogSession ? { catalogMetrics: { ...catalogSession.metrics } } : {}) });
        // Never log free-form model refusals: they can echo user input.
        // `lastFailureCode` intentionally only tracks a NON-final attempt's
        // failure (attempt < 3) — generateValidatedPlan reads it back as
        // `previousFailureCode` purely to decide whether the LAST attempt
        // should escalate to the fallback model (only for AI_SCHEMA_INVALID/
        // AI_MACRO_VALIDATION_FAILED). It is NOT "the most recent failure" —
        // that's `errorCode` on the job doc, written by `fail()` below from
        // the exhausted GenerationAttemptsExhausted.code. A final (3rd)
        // attempt's own code is deliberately excluded here since there's no
        // subsequent attempt left for it to influence.
        if (audit.code && audit.attempt < 3) await ref.update({ status: 'running', retryCount: audit.attempt - 1,
          lastFailureCode: audit.code, updatedAt: Timestamp.now() });
      },
      async (currentAttempt) => { stage = 'validation'; await ref.update({ status: 'validating', retryCount: currentAttempt - 1,
        updatedAt: Timestamp.now() }); },
      { startAttempt, generationId, ...(catalogSession ? { catalogSession, deadline } : {}), previousFailureCode: typeof previousFailureCode === 'string'
        ? previousFailureCode as AttemptCode : undefined,
      onBeforeAttempt: async (currentAttempt) => { stage = 'provider'; await ref.update({ aiAttemptCount: currentAttempt,
        updatedAt: Timestamp.now() }); } },
    );
        stage = 'persistence';
        logInfo('nutrition.generation', 'persistence_started', { generationId, stage });
        const now = Timestamp.now();
        const planRef = user.collection('nutritionPlans').doc(generationId);
        const rateRef = db.collection('nutritionRateLimits').doc(uid);
        await db.runTransaction(async (tx) => {
          const [job, rate, existingPlan, deletionLock, latestProfile] = await Promise.all([
            tx.get(ref), tx.get(rateRef), tx.get(planRef), tx.get(db.collection('accountDeletionLocks').doc(uid)),
            tx.get(user.collection('nutritionProfile').doc('current')),
          ]);
          if (!latestProfile.get('updatedAt')?.isEqual(context.profile.updatedAt)) throw new Error('STALE_GENERATION');
          if (deletionLock.exists || rate.get('activeGenerationId') !== generationId
            || job.get('status') !== 'validating' || existingPlan.exists) throw new Error('STALE_GENERATION');
          const oldId = rate.get('activePlanId');
          const oldPlanRef = typeof oldId === 'string' ? user.collection('nutritionPlans').doc(oldId) : null;
          const oldPlan = oldPlanRef ? await tx.get(oldPlanRef) : null;
          if (catalogSession) await assertCatalogBindingsCurrent(tx, db, validated.meals.flatMap(m => m.options), context.profile, foodNames, catalogSession);
          if (oldPlanRef && oldPlan?.exists && oldPlan.get('status') === 'active') {
            tx.update(oldPlanRef, { status: 'archived', archivedAt: now });
          }
          tx.create(planRef, { planId: generationId, generationId, status: 'active',
            profileSnapshot: { questionnaireVersion: context.questionnaireVersion,
              inherited: context.input.inherited, nutritionAnswers: context.profile, capturedAt: now },
            physicalSnapshot: context.physical,
            engineSnapshot: { output: { ...context.engine, versions: {
              ...context.engine.versions, foodCatalogVersion: catalogMode ? CATALOG_PIPELINE_VERSION : FOOD_CATALOG_VERSION_PLACEHOLDER } }, ruleVersions: {
              ...context.engine.versions, foodCatalogVersion: catalogMode ? CATALOG_PIPELINE_VERSION : FOOD_CATALOG_VERSION_PLACEHOLDER } },
            meals: validated.meals, dailyTotals: validated.dailyTotals,
            versions: { planSchemaVersion: catalogMode ? CATALOG_PLAN_SCHEMA_VERSION : '2.0.0', nutritionEngineVersion: context.engine.versions.nutritionEngineVersion,
              questionnaireVersion: context.questionnaireVersion, foodCatalogVersion: catalogMode ? CATALOG_PIPELINE_VERSION : FOOD_CATALOG_VERSION_PLACEHOLDER,
              aiGenerationSchemaVersion: AI_SCHEMA_VERSION, promptVersion: catalogMode ? `${PROMPT_VERSION}+catalog-intent-v1` : PROMPT_VERSION },
            generationMetadata: { ...(catalogMode ? { mode: 'catalog' } : {}), provider: 'openai', model: result.model, attempts: attempt,
              corrected: validated.corrected, fallbackUsed: fallback },
            createdAt: now, activatedAt: now, archivedAt: null });
          tx.update(ref, { status: 'completed', planId: generationId, completedAt: now,
            retryCount: attempt - 1, leaseUntil: null, nextAttemptAt: null });
          tx.update(rateRef, { activeGenerationId: null, activePlanId: generationId, updatedAt: now });
        });
        logInfo('nutrition.generation', 'job_completed', { generationId, stage: 'completed', attempts: attempt, fallback,
          durationMs: Date.now() - operationStartedAt });
        await trackNutritionBackendEvent({ name: 'nutrition_generation_completed', properties: {
          durationBucket: durationBucket(Date.now() - operationStartedAt),
          retryCountBucket: countBucket(attempt - 1), fallbackUsed: fallback,
          mealSlotCountBucket: countBucket(context.profile.mealSlots.length),
        } });
        return true;
  } catch (error) {
    logWarn('nutrition.generation', 'job_stage_failed', { generationId, stage,
      failureCode: errorCode(error), durationMs: Date.now() - operationStartedAt });
    const transientCode = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code : null;
    if (typeof transientCode === 'number' && [4, 8, 10, 13, 14].includes(transientCode)) {
      logWarn('nutrition.generation', 'job_transient_error', { generationId, grpcCode: transientCode });
      return false; // lease expiry lets the scheduler resume the same job
    }
    const code = errorCode(error);
    await fail(db, ref, code);
    await trackNutritionBackendEvent({ name: 'nutrition_generation_failed', properties: {
      durationBucket: durationBucket(Date.now() - operationStartedAt),
      retryCountBucket: countBucket(Math.max(0, observedAttempt - 1)),
      failureCode: code,
    } });
    return false;
  }
}

export const onNutritionGenerationJobCreated = onDocumentCreated(
  { document: 'users/{uid}/nutritionGenerationJobs/{generationId}', secrets: [OPENAI_API_KEY], timeoutSeconds: 540 },
  async (event) => {
    if (!event.params.uid || !event.params.generationId) return;
    await processNutritionGenerationJob(event.params.uid, event.params.generationId,
      new OpenAiNutritionProvider(OPENAI_API_KEY.value()));
  },
);

/** Repairs queued jobs and expired worker leases after process/instance loss. */
export const retryNutritionGenerationJobs = onSchedule(
  { schedule: 'every 5 minutes', secrets: [OPENAI_API_KEY], timeoutSeconds: 540 },
  async () => {
    const now = Timestamp.now();
    const jobs = await defaultDb.collectionGroup('nutritionGenerationJobs')
      .where('status', 'in', ['queued', 'running', 'validating'])
      .where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(3).get();
    const provider = new OpenAiNutritionProvider(OPENAI_API_KEY.value());
    for (const job of jobs.docs) {
      const lease = job.get('leaseUntil');
      if (job.get('status') !== 'queued' && lease instanceof Timestamp && lease.toMillis() > now.toMillis()) continue;
      const uid = job.ref.parent.parent?.id;
      if (uid) await processNutritionGenerationJob(uid, job.id, provider);
    }
  },
);
