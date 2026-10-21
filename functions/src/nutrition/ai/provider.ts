import {
  NUTRITION_FOOD_ALLERGENS,
  type MealNutritionTarget, type NutritionEngineOutput, type NutritionGoal, type NutritionProfile,
} from '../shared/types/nutrition';
import type { NutritionPromptFoodNames } from '../generation/foodNames';
import { logInfo, logWarn } from '../../lib/logger';
import { AI_SCHEMA_VERSION, NUTRITION_AI_MODELS, AI_STAGE_LIMITS } from './config';
import { OPENAI_REVIEW_SCHEMA, REVIEW_SYSTEM_PROMPT, type NutritionReviewRequest } from './review';
import {
  FULL_PLAN_SYSTEM_PROMPT, fullPlanContext, MEAL_ALTERNATIVE_SYSTEM_PROMPT, mealAlternativeContext,
  UNTRUSTED_DATA_SYSTEM_PROMPT, CATALOG_INTENT_INSTRUCTIONS,
} from './prompt';

/**
 * First real smoke test (2026-10-09, ajfit-2f321) hit `AI_TIMEOUT` on all 3
 * attempts at a near-identical ~45.0-45.1s — the previous 45000ms value was
 * consistently too tight for a real full-plan structured-output response
 * (then on `gpt-6.1-sol`; now primary is the faster/cheaper `gpt-6-luna`,
 * see config.ts), not a one-off network blip. 90s keeps a ~30s margin
 * under `requestNutritionMealAlternative`'s tighter 120s callable budget
 * (the full-plan worker has a much larger 540s budget, so it was never the
 * binding constraint).
 */
export const OPENAI_REQUEST_TIMEOUT_MS = 90_000;

export interface AiUsage { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null }
export interface AiResult { output: unknown; model: string; usage: AiUsage; latencyMs: number }
/** Safety flags stay inside deterministic eligibility checks, never in AI requests. */
export type NutritionAiProfile = Omit<NutritionProfile, 'pregnant' | 'breastfeeding' | 'updatedAt'>;
export function nutritionAiProfile(profile: NutritionProfile): NutritionAiProfile {
  const { pregnant: _pregnant, breastfeeding: _breastfeeding, updatedAt: _updatedAt, ...answers } = profile;
  return answers;
}

export interface FullPlanRequest {
  physicalContext?: unknown;
  trace?: { generationId: string; attempt: number };
  profile: NutritionAiProfile;
  engine: NutritionEngineOutput;
  goal: NutritionGoal;
  foodNames: NutritionPromptFoodNames;
  feedback?: string;
  fallback?: boolean;
  catalogMode?: boolean;
  timeoutMs?: number;
}
export interface MealAlternativeRequest {
  physicalContext?: unknown;
  profile: NutritionAiProfile;
  target: MealNutritionTarget;
  avoidFoodNames: readonly string[];
  goal: NutritionGoal;
  foodNames: NutritionPromptFoodNames;
  feedback?: string;
  fallback?: boolean;
  catalogMode?: boolean;
  timeoutMs?: number;
}
export interface NutritionAiProvider {
  generatePlan(request: FullPlanRequest): Promise<AiResult>;
  generateMealAlternative?(request: MealAlternativeRequest): Promise<AiResult>;
  reviewPlan?(request: NutritionReviewRequest): Promise<AiResult>;
}
export class NutritionAiProviderError extends Error {
  constructor(readonly code: 'AI_SCHEMA_INVALID' | 'AI_RATE_LIMIT' | 'AI_PROVIDER_ERROR' | 'AI_PROVIDER_REFUSAL'
    | 'AI_REVIEW_PROVIDER_REFUSAL' | 'AI_REVIEW_SCHEMA_INVALID' | 'AI_REVIEW_UNAVAILABLE'
    | 'AI_REVIEW_TIMEOUT' | 'AI_REVIEW_RATE_LIMIT' | 'AI_COST_LIMIT_EXCEEDED',
    readonly retryable: boolean,
    /** Bounded refusal for internal audit consumers; never log free-form text,
     * since a model refusal can echo sensitive input. */
    readonly refusalReason?: string, readonly result?: AiResult) { super(code); }
}

// Free-form AI food item — no foodId, no catalog reference (diet-quality-v3,
// 2026-10-10). `preparationNote` is required (never truly optional) because
// OpenAI's strict structured-output mode requires every schema property to
// be listed in `required`; an empty string means "no note". Numeric/array
// bounds and post-validation requirements are enforced by
// parseAiOutput/the validator in `generation/domain.ts`, independently of
// this schema.
const FOOD_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'quantity', 'unit', 'preparationNote', 'estimatedNutrition', 'allergens', 'ingredients'],
  properties: {
    name: { type: 'string' },
    quantity: { type: 'number' },
    unit: { type: 'string' },
    preparationNote: { type: 'string' },
    estimatedNutrition: {
      type: 'object', additionalProperties: false, required: ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'],
      properties: {
        kcal: { type: 'number' }, proteinG: { type: 'number' }, carbsG: { type: 'number' },
        fatG: { type: 'number' }, fiberG: { type: 'number' },
      },
    },
    ingredients: { type: 'array', minItems: 1, maxItems: 30, items: {
      type: 'object', additionalProperties: false, required: ['name', 'origin'], properties: {
        name: { type: 'string' },
        origin: { type: 'string', enum: ['plant', 'mineral', 'dairy', 'egg', 'fish', 'shellfish', 'terrestrial_animal', 'other_animal', 'unknown'] },
      },
    } },
    allergens: { type: 'array', items: { type: 'string', enum: [...NUTRITION_FOOD_ALLERGENS] } },
  },
} as const;

// Shared shape for one meal's set of equivalent options — used only by the
// single-meal alternative schema now (cost pass, 2026-10-10): the full plan
// no longer asks for 2-3 options per meal, so it has no need for this
// options/recommendedOptionIndex wrapper — see FULL_PLAN_MEAL_SCHEMA below.
const MEAL_OPTIONS_SCHEMA = {
  type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['foods'], properties: {
      foods: { type: 'array', items: FOOD_ITEM_SCHEMA },
    },
  },
} as const;

// One recommended option per meal on the initial generation (cost pass,
// 2026-10-10) — alternatives are generated on demand via
// OPENAI_MEAL_ALTERNATIVE_SCHEMA when the user asks to swap a meal, so the
// full plan never pays for options it may never use.
const FULL_PLAN_MEAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slot', 'foods'], properties: {
    slot: { type: 'string', enum: ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'] },
    foods: { type: 'array', items: FOOD_ITEM_SCHEMA },
  },
} as const;

export const OPENAI_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['meals'], properties: {
    meals: { type: 'array', items: FULL_PLAN_MEAL_SCHEMA },
  },
} as const;

export const OPENAI_MEAL_ALTERNATIVE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['recommendedOptionIndex', 'options'], properties: {
    recommendedOptionIndex: { type: 'integer' },
    options: MEAL_OPTIONS_SCHEMA,
  },
} as const;

interface ResponseContent { type?: string; text?: string; refusal?: string }
interface ResponseOutput { content?: ResponseContent[] }
interface ResponsePayload {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: ResponseOutput[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  model?: string;
}

export class OpenAiNutritionProvider implements NutritionAiProvider {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  private async callResponsesApi(
    model: string, developerPrompt: string, userContent: string, schemaName: string, schema: object,
    trace: { generationId?: string; attempt?: number; role?: 'creator' | 'reviewer';
      retryFeedbackPresent?: boolean; repairCandidatePresent?: boolean } = {},
    timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
  ): Promise<AiResult> {
    const started = Date.now();
    const role = trace.role ?? 'creator';
    const limits = AI_STAGE_LIMITS[role];
    const input = [{ role: 'system', content: UNTRUSTED_DATA_SYSTEM_PROMPT },
      { role: 'developer', content: developerPrompt }, { role: 'user', content: userContent }];
    // Byte fallback is a conservative token upper bound for UTF-8 text, with
    // 2k framing allowance. Count schema and prompts too; never truncate restrictions.
    if (Buffer.byteLength(JSON.stringify({ input, schema }), 'utf8') + 2048 > limits.inputTokenUpperBound) {
      throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
    }
    logInfo('nutrition.generation', 'ai_request_started', { ...trace, model, stage: 'provider' });
    const response = await this.fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(Math.max(1, Math.min(limits.timeoutMs, timeoutMs))),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      /**
       * 16000 (sized for 6 meals x 3 options x 8 foods) was right for the
       * old multi-option-per-meal schema — real incident `e304516e`
       * (2026-10-10) showed truncation (`status` never `completed`) at the
       * old 4500 cap under that shape. Cost pass (2026-10-10): the full
       * plan now asks for exactly ONE option per meal (worst case 6 meals x
       * 8 foods — a third of the old item count), and a meal alternative
       * only ever covers 1 meal x up to 3 options x 8 foods — smaller
       * still. 8000 keeps comfortable headroom over the new worst case
       * without paying for the old cap; see the `incomplete_details` log
       * below if this ever needs raising again.
       */
      body: JSON.stringify({ model, service_tier: 'default', truncation: 'disabled', store: false, max_output_tokens: limits.outputTokens,
        // Minimal reasoning: this is a bounded structured-output
        // composition task against a strict JSON schema, not an
        // open-ended reasoning task — a high effort budget would only add
        // billed reasoning tokens with no quality benefit here.
        reasoning: { effort: 'low' },
        // `system` carries ONLY the injection-boundary rule (a real safety
        // directive); the task-specific composition rules go in `developer`
        // — see UNTRUSTED_DATA_SYSTEM_PROMPT's comment in prompt.ts.
        input,
        text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null;
      const safeEnum = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
      logWarn('nutrition.generation', 'ai_http_error', { ...trace, model, httpStatus: response.status,
        openAiErrorCode: safeEnum(body?.error?.code), openAiErrorType: safeEnum(body?.error?.type),
        durationMs: Date.now() - started });
      throw new NutritionAiProviderError(response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_ERROR',
        (response.status === 429 && body?.error?.code !== 'insufficient_quota') || response.status >= 500);
    }
    logInfo('nutrition.generation', 'ai_http_completed', { ...trace, model,
      httpStatus: response.status, durationMs: Date.now() - started });
    let payload: ResponsePayload;
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_payload');
      payload = body as ResponsePayload;
      if (!Array.isArray(payload.output) || payload.output.some(item => !item || typeof item !== 'object'
        || item.content !== undefined && (!Array.isArray(item.content) || item.content.some(c => !c || typeof c !== 'object')))) throw new Error('invalid_output');
    } catch { throw new NutritionAiProviderError('AI_SCHEMA_INVALID', true); }
    const received: AiResult = { output: null, model: payload.model ?? model, latencyMs: Date.now() - started,
      usage: { inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null } };
    const contents = payload.output?.flatMap((item) => item.content ?? []) ?? [];
    const refusal = contents.find((item) => item.type === 'refusal' || typeof item.refusal === 'string');
    if (refusal) {
      // This is an opaque upstream model-side refusal, not a deterministic
      // rule of ours — it carries no known relationship to any specific
      // condition (pregnancy, allergens, etc.) and can be a one-off
      // classification quirk, so it gets its own retryable code distinct
      // from `AI_SAFETY_VALIDATION_FAILED` (reserved for OUR deterministic
      // safety checks in attempts.ts/alternative.ts/domain.ts, which have a
      // known, provable cause). Conflating the two previously caused the UI
      // to show a specific, false diagnosis (see `generationStage.ts`).
      throw new NutritionAiProviderError('AI_PROVIDER_REFUSAL', true,
        typeof refusal.refusal === 'string' ? refusal.refusal.slice(0, 200) : undefined, received);
    }
    const content = contents.find((item) => item.type === 'output_text');
    if (payload.status !== 'completed' || typeof content?.text !== 'string' || !content.text) {
      // Never logs prompt/response text — only the Responses API's own
      // status/reason, so a truncated-output incident (`incomplete_details.
      // reason === 'max_output_tokens'`) is distinguishable from a genuine
      // schema violation without digging through Firestore (see `max_output_
      // tokens`'s comment above for the incident that motivated this).
      logWarn('nutrition.generation', 'ai_response_not_completed', {
        ...trace, model, status: payload.status ?? null, incompleteReason: payload.incomplete_details?.reason ?? null,
      });
      throw new NutritionAiProviderError('AI_SCHEMA_INVALID', true, undefined, received);
    }
    let output: unknown;
    try { output = JSON.parse(content.text); }
    catch { throw new NutritionAiProviderError('AI_SCHEMA_INVALID', true, undefined, received); }
    return { output, model: payload.model ?? model, latencyMs: Date.now() - started,
      usage: { inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null } };
  }

  async generatePlan(request: FullPlanRequest): Promise<AiResult> {
    const model = NUTRITION_AI_MODELS.fullPlan;
    let repairCandidatePresent = false;
    try { repairCandidatePresent = Boolean(JSON.parse(request.feedback ?? 'null')?.previousPlan); }
    catch { /* Older retries may contain only a technical error enum. */ }
    return this.callResponsesApi(model, request.catalogMode ? FULL_PLAN_SYSTEM_PROMPT + CATALOG_INTENT_INSTRUCTIONS : FULL_PLAN_SYSTEM_PROMPT,
      JSON.stringify({ ...JSON.parse(fullPlanContext(request.profile, request.engine, request.goal, request.foodNames, request.feedback, request.catalogMode)),
        physicalContext: request.physicalContext ?? null, energy: request.engine.energy, dailyMacros: request.engine.macros }),
      `nutrition_plan_${AI_SCHEMA_VERSION.replaceAll('.', '_')}`, OPENAI_PLAN_SCHEMA,
      { ...request.trace, retryFeedbackPresent: Boolean(request.feedback), repairCandidatePresent }, request.timeoutMs);
  }

  async generateMealAlternative(request: MealAlternativeRequest): Promise<AiResult> {
    const model = NUTRITION_AI_MODELS.mealAlternative;
    return this.callResponsesApi(model, request.catalogMode ? MEAL_ALTERNATIVE_SYSTEM_PROMPT + CATALOG_INTENT_INSTRUCTIONS : MEAL_ALTERNATIVE_SYSTEM_PROMPT,
      JSON.stringify({ ...JSON.parse(mealAlternativeContext(request.profile, request.target, request.avoidFoodNames,
        request.goal, request.foodNames, request.feedback, request.catalogMode)), physicalContext: request.physicalContext ?? null }),
      `nutrition_meal_alternative_${AI_SCHEMA_VERSION.replaceAll('.', '_')}`, OPENAI_MEAL_ALTERNATIVE_SCHEMA, {}, request.timeoutMs);
  }

  async reviewPlan(request: NutritionReviewRequest): Promise<AiResult> {
    const { timeoutMs, ...reviewContext } = request;
    try {
      return await this.callResponsesApi(NUTRITION_AI_MODELS.reviewer, REVIEW_SYSTEM_PROMPT,
        JSON.stringify(reviewContext), 'nutrition_independent_review_v1', OPENAI_REVIEW_SCHEMA,
        { role: 'reviewer' }, timeoutMs);
    } catch (error) {
      if (error instanceof NutritionAiProviderError) {
        const code = error.code === 'AI_PROVIDER_REFUSAL' ? 'AI_REVIEW_PROVIDER_REFUSAL'
          : error.code === 'AI_SCHEMA_INVALID' ? 'AI_REVIEW_SCHEMA_INVALID'
          : error.code === 'AI_RATE_LIMIT' ? 'AI_REVIEW_RATE_LIMIT'
          : error.code === 'AI_COST_LIMIT_EXCEEDED' ? error.code : 'AI_REVIEW_UNAVAILABLE';
        throw new NutritionAiProviderError(code, error.retryable, undefined, error.result);
      }
      throw new NutritionAiProviderError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'AI_REVIEW_TIMEOUT' : 'AI_REVIEW_UNAVAILABLE', true);
    }
  }
}
