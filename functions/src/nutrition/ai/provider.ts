import {
  NUTRITION_FOOD_ALLERGENS,
  type MealNutritionTarget, type NutritionEngineOutput, type NutritionGoal, type NutritionProfile,
} from '../shared/types/nutrition';
import type { NutritionPromptFoodNames } from '../generation/foodNames';
import { logWarn } from '../../lib/logger';
import { AI_SCHEMA_VERSION, NUTRITION_AI_MODELS } from './config';
import {
  FULL_PLAN_SYSTEM_PROMPT, fullPlanContext, MEAL_ALTERNATIVE_SYSTEM_PROMPT, mealAlternativeContext,
  UNTRUSTED_DATA_SYSTEM_PROMPT,
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
export interface FullPlanRequest {
  profile: NutritionProfile;
  engine: NutritionEngineOutput;
  goal: NutritionGoal;
  foodNames: NutritionPromptFoodNames;
  feedback?: string;
  fallback?: boolean;
}
export interface MealAlternativeRequest {
  profile: NutritionProfile;
  target: MealNutritionTarget;
  avoidFoodNames: readonly string[];
  goal: NutritionGoal;
  foodNames: NutritionPromptFoodNames;
  feedback?: string;
  fallback?: boolean;
}
export interface NutritionAiProvider {
  generatePlan(request: FullPlanRequest): Promise<AiResult>;
  generateMealAlternative?(request: MealAlternativeRequest): Promise<AiResult>;
}
export class NutritionAiProviderError extends Error {
  constructor(readonly code: 'AI_SCHEMA_INVALID' | 'AI_RATE_LIMIT' | 'AI_PROVIDER_ERROR' | 'AI_SAFETY_VALIDATION_FAILED',
    readonly retryable: boolean,
    /**
     * The MODEL's own short policy statement for why it refused (from the
     * Responses API's `refusal` field) — never diet content, never a
     * reflection of the request. Truncated defensively; logged (Cloud
     * Logging only, never Firestore/`nutritionAiOperations`) so a real
     * refusal pattern is diagnosable without ever persisting prompt/output.
     */
    readonly refusalReason?: string) { super(code); }
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
  required: ['name', 'quantity', 'unit', 'preparationNote', 'estimatedNutrition', 'allergens'],
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
  ): Promise<AiResult> {
    const started = Date.now();
    const response = await this.fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
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
      body: JSON.stringify({ model, store: false, max_output_tokens: 8000,
        // Minimal reasoning: this is a bounded structured-output
        // composition task against a strict JSON schema, not an
        // open-ended reasoning task — a high effort budget would only add
        // billed reasoning tokens with no quality benefit here.
        reasoning: { effort: 'low' },
        // `system` carries ONLY the injection-boundary rule (a real safety
        // directive); the task-specific composition rules go in `developer`
        // — see UNTRUSTED_DATA_SYSTEM_PROMPT's comment in prompt.ts.
        input: [{ role: 'system', content: UNTRUSTED_DATA_SYSTEM_PROMPT },
          { role: 'developer', content: developerPrompt }, { role: 'user', content: userContent }],
        text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
      }),
    });
    if (!response.ok) throw new NutritionAiProviderError(response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_ERROR',
      response.status === 429 || response.status >= 500);
    const payload = await response.json() as ResponsePayload;
    const contents = payload.output?.flatMap((item) => item.content ?? []) ?? [];
    const refusal = contents.find((item) => item.type === 'refusal' || typeof item.refusal === 'string');
    if (refusal) {
      throw new NutritionAiProviderError('AI_SAFETY_VALIDATION_FAILED', false,
        typeof refusal.refusal === 'string' ? refusal.refusal.slice(0, 200) : undefined);
    }
    const content = contents.find((item) => item.type === 'output_text');
    if (payload.status !== 'completed' || !content?.text) {
      // Never logs prompt/response text — only the Responses API's own
      // status/reason, so a truncated-output incident (`incomplete_details.
      // reason === 'max_output_tokens'`) is distinguishable from a genuine
      // schema violation without digging through Firestore (see `max_output_
      // tokens`'s comment above for the incident that motivated this).
      logWarn('nutrition.generation', 'ai_response_not_completed', {
        model, status: payload.status ?? null, incompleteReason: payload.incomplete_details?.reason ?? null,
      });
      throw new NutritionAiProviderError('AI_SCHEMA_INVALID', true);
    }
    let output: unknown;
    try { output = JSON.parse(content.text); }
    catch { throw new NutritionAiProviderError('AI_SCHEMA_INVALID', true); }
    return { output, model: payload.model ?? model, latencyMs: Date.now() - started,
      usage: { inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null } };
  }

  async generatePlan(request: FullPlanRequest): Promise<AiResult> {
    const model = request.fallback ? NUTRITION_AI_MODELS.fallback : NUTRITION_AI_MODELS.fullPlan;
    return this.callResponsesApi(model, FULL_PLAN_SYSTEM_PROMPT,
      fullPlanContext(request.profile, request.engine, request.goal, request.foodNames, request.feedback),
      `nutrition_plan_${AI_SCHEMA_VERSION.replaceAll('.', '_')}`, OPENAI_PLAN_SCHEMA);
  }

  async generateMealAlternative(request: MealAlternativeRequest): Promise<AiResult> {
    const model = request.fallback ? NUTRITION_AI_MODELS.fallback : NUTRITION_AI_MODELS.mealAlternative;
    return this.callResponsesApi(model, MEAL_ALTERNATIVE_SYSTEM_PROMPT,
      mealAlternativeContext(request.profile, request.target, request.avoidFoodNames, request.goal, request.foodNames, request.feedback),
      `nutrition_meal_alternative_${AI_SCHEMA_VERSION.replaceAll('.', '_')}`, OPENAI_MEAL_ALTERNATIVE_SCHEMA);
  }
}
