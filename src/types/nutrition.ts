/**
 * Nutrition domain contracts — shared across the pure Engine, catalog math,
 * Firestore services and future backend consumers.
 *
 * Source of truth: `docs/nutrition/README.md`, `docs/nutrition/canonical/*.json`
 * and `docs/nutrition/decisions/ADR-001-nutrition-architecture.md`. Enum-like
 * unions are copied verbatim from `canonical/*.json` wherever one exists;
 * concepts not covered by `canonical/` fall back to the `docs/nutrition/*.md`
 * markdown, each flagged with which document it came from.
 *
 * Firestore-timestamp fields are generic over `TTimestamp` (default
 * `unknown`), same convention as `workoutPrescription/types.ts` /
 * `src/types/exercise.ts`'s `ExerciseMetadata<TTimestamp>` — this file never
 * imports `firebase/firestore`'s `Timestamp` directly, so it stays usable
 * from any layer that already has its own representation of a server
 * timestamp.
 *
 * A first pass of this file (2026-10-08) surfaced several naming/shape
 * divergences between `canonical/*.json` and the `docs/nutrition/*.md`
 * prose. All of those have since been reconciled directly in `canonical/`
 * and the markdown — this file now just follows the reconciled contracts.
 * Any `DIVERGENCE:` comment remaining below is still open and summarized in
 * the implementation report delivered alongside the change that added it.
 */

import type { DeprecatedGoal, LegacyGoal, PrimaryGoal, Sex } from '../state/AppState';

export type { Sex } from '../state/AppState';

// ---------------------------------------------------------------------------
// 1. Nutrition goal — reused, not reinvented
// ---------------------------------------------------------------------------

/**
 * Nutrition has no independent goal (`canonical/nutrition_rules.json`
 * `goals.objectiveSource: "existing_aj_fit_goal"`,
 * `independentNutritionGoalAllowed: false`) — it is always the user's
 * existing AJ Fit goal, reused as-is. Never ask for a second goal choice in
 * the Perfil Nutricional.
 */
export type NutritionGoal = PrimaryGoal | DeprecatedGoal | LegacyGoal;

/**
 * The Nutrition Engine's 4 internal goal categories
 * (`canonical/nutrition_rules.json` `goals.allowed`) — a deliberately
 * different, smaller vocabulary than `NutritionGoal`. `NutritionGoal` is
 * normalized into this via `NUTRITION_GOAL_CATEGORY_MAP` below; the engine
 * never sees a raw `NutritionGoal` value.
 */
export const NUTRITION_GOAL_CATEGORIES = ['weight_loss', 'muscle_gain', 'maintenance', 'body_recomposition'] as const;
export type NutritionGoalCategory = (typeof NUTRITION_GOAL_CATEGORIES)[number];

/**
 * Deterministic `NutritionGoal` -> `NutritionGoalCategory` normalization
 * table (`docs/nutrition/03_nutrition_engine/goals_and_adjustments.md` §1.1,
 * `canonical/nutrition_rules.json` `goals.normalization`), closed against
 * the real copy in `src/i18n/resources/pt-BR/quiz.json` as of 2026-10-08.
 *
 * `null` means the mapping is NOT closed — `strength`/`conditioning`/`perf`/
 * `return_to_training`/`recon` describe a training focus with no stated
 * weight/body-composition direction (confirmed by real code, not just
 * copy: `src/workoutPrescription/input.ts`'s `LEGACY_GOAL_MAP` normalizes
 * `recon` to `return_to_training`, not to `body_composition`/`def` despite
 * the similar name, and the same file flags `perf` as
 * `LEGACY_PERFORMANCE_GOAL_AMBIGUOUS`). Guessing a category for any of them
 * would be a product assumption, not a derivation.
 *
 * Decision approved 2026-10-08 (`canonical/nutrition_rules.json`
 * `goals.normalization.ambiguous.status: "RESOLVED_VIA_NUTRITION_PROFILE_QUESTION"`):
 * this map is NOT extended with a silent default for these 5 values. Instead,
 * `NutritionProfile.nutritionGoalCategory` becomes a required answer in the
 * Perfil Nutricional whenever `NUTRITION_AMBIGUOUS_GOALS.includes(goal)`.
 * Conceptual resolution rule (not implemented as a function yet — that's
 * Nutrition Engine logic, out of scope here):
 *
 * ```text
 * if NUTRITION_GOAL_CATEGORY_MAP[goal] != null: use the mapped value
 * if NUTRITION_GOAL_CATEGORY_MAP[goal] == null: require nutritionProfile.nutritionGoalCategory
 * ```
 *
 * Callers must keep treating `null` here as "cannot resolve from the goal
 * alone" — never silently default to `maintenance` or any other category.
 *
 * `Record<NutritionGoal, ...>` is exhaustive by construction: adding a new
 * literal to `PrimaryGoal`/`DeprecatedGoal`/`LegacyGoal` in `AppState.tsx`
 * without updating this map is a compile error here.
 */
export const NUTRITION_GOAL_CATEGORY_MAP: Record<NutritionGoal, NutritionGoalCategory | null> = {
  gain_muscle: 'muscle_gain',
  hyper: 'muscle_gain',
  lose_fat: 'weight_loss',
  cut: 'weight_loss',
  body_composition: 'body_recomposition',
  def: 'body_recomposition',
  health: 'maintenance',
  strength: null,
  conditioning: null,
  perf: null,
  return_to_training: null,
  recon: null,
};

/**
 * The 5 `NutritionGoal` values with no direct category mapping — exactly
 * the keys mapped to `null` in `NUTRITION_GOAL_CATEGORY_MAP` above, kept as
 * an explicit, iterable list (`canonical/nutrition_rules.json`
 * `goals.normalization.ambiguous.values`) for callers that need to check
 * "does this goal require `nutritionGoalCategory`?" without filtering the
 * whole map.
 */
export const NUTRITION_AMBIGUOUS_GOALS = [
  'strength', 'conditioning', 'perf', 'return_to_training', 'recon',
] as const satisfies readonly NutritionGoal[];

// ---------------------------------------------------------------------------
// 2. Perfil Nutricional — enums from `canonical/questionnaire.json`
// ---------------------------------------------------------------------------

export const NUTRITION_PROGRESSION_PACES = ['gradual', 'moderate', 'accelerated'] as const;
export type NutritionProgressionPace = (typeof NUTRITION_PROGRESSION_PACES)[number];

export const NON_TRAINING_ACTIVITY_LEVELS = ['sedentary', 'low_active', 'active', 'very_active'] as const;
export type NonTrainingActivityLevel = (typeof NON_TRAINING_ACTIVITY_LEVELS)[number];

export const DIETARY_PATTERNS = ['omnivore', 'vegetarian', 'vegan', 'pescatarian'] as const;
export type DietaryPattern = (typeof DIETARY_PATTERNS)[number];

export const NUTRITION_MEAL_SLOTS = [
  'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper',
] as const;
export type NutritionMealSlot = (typeof NUTRITION_MEAL_SLOTS)[number];

/** `canonical/questionnaire.json` (`varietyPreference` question options) — `answer_schema.md` was corrected to match this. */
export const VARIETY_PREFERENCES = ['repeatable', 'variety', 'indifferent'] as const;
export type VarietyPreference = (typeof VARIETY_PREFERENCES)[number];

/**
 * `canonical/questionnaire.json` (`supplements` question options). Plain id
 * array, not `{ supplementType, usesOrAccepts }[]` — a selected id means
 * "uses or accepts"; there is no separate boolean. `answer_schema.md` §6
 * was corrected to match this (both naming and shape).
 */
export const NUTRITION_SUPPLEMENT_IDS = [
  'whey_or_protein', 'creatine', 'caffeine_or_preworkout', 'multivitamin', 'omega_3', 'other',
] as const;
export type NutritionSupplementId = (typeof NUTRITION_SUPPLEMENT_IDS)[number];

/**
 * Safety-gate blockers (`canonical/nutrition_constraints.json`
 * `eligibility.blockingGates`). Both are **current state**, owned by
 * `NutritionProfile` itself (`pregnant`/`breastfeeding` below) — never read
 * from `Quiz.pregnancyScreening` after the profile's first creation (see
 * `docs/nutrition/07_backend/firestore_schema.md` §3.1).
 */
export const NUTRITION_ELIGIBILITY_BLOCKERS = ['pregnancy', 'lactation'] as const;
export type NutritionEligibilityBlocker = (typeof NUTRITION_ELIGIBILITY_BLOCKERS)[number];

export type NutritionFoodId = string;

/**
 * `users/{uid}/nutritionProfile/current` — see `07_backend/firestore_schema.md` §3.
 * Does NOT duplicate sex/birthDate/height/weight/goal (those stay in their
 * existing AJ Fit sources; see `NutritionPhysicalContext` below).
 */
export interface NutritionProfile<TTimestamp = unknown> {
  questionnaireVersion: number;

  /** Required only when the inherited goal implies body-composition progression; not enforced at the type level. */
  progressionPace?: NutritionProgressionPace;
  targetWeightKg?: number | null;

  nonTrainingActivityLevel: NonTrainingActivityLevel;

  mealSlots: NutritionMealSlot[];

  dietaryPattern: DietaryPattern;

  preferredFoodIds: NutritionFoodId[];
  usualFoodIds: NutritionFoodId[];
  /** Hard exclusion — always wins over `preferredFoodIds`/`usualFoodIds` on conflict (`answer_schema.md` §9). */
  excludedFoodIds: NutritionFoodId[];
  /** Explicit structured allergy exclusions; unknown allergen review fails closed during generation. */
  excludedAllergens?: NutritionFoodAllergen[];

  supplements: NutritionSupplementId[];

  /**
   * Current state, not an inherited/immutable snapshot. `pregnant` is
   * pre-filled once from `Quiz.pregnancyScreening` when this document is
   * first created; `breastfeeding` has no prior AJ Fit source at all. Both
   * live and are revalidated here on every generation, never reread from
   * `Quiz` afterwards (`07_backend/firestore_schema.md` §3.1).
   */
  pregnant: boolean;
  breastfeeding: boolean;

  varietyPreference: VarietyPreference;

  /**
   * Resolves the energy direction the Nutrition Engine needs when the
   * user's general AJ Fit goal has no entry in `NUTRITION_GOAL_CATEGORY_MAP`
   * (i.e. `goal` is one of `NUTRITION_AMBIGUOUS_GOALS`). Structurally
   * optional, but required in that case — this file does not enforce that
   * conditional requirement (no logic here), only states it. Does NOT
   * create an independent nutrition goal: for every other goal, this field
   * is irrelevant and the direct mapping is used instead
   * (`docs/nutrition/03_nutrition_engine/goals_and_adjustments.md` §1.2/§1.3).
   */
  nutritionGoalCategory?: NutritionGoalCategory;

  updatedAt: TTimestamp;
}

// ---------------------------------------------------------------------------
// 3. Contexto físico — resolvido de fontes já existentes do AJ Fit
// ---------------------------------------------------------------------------

/**
 * Which real AJ Fit source a physical field was actually resolved from —
 * audit metadata only, the resolver itself is not implemented here. Mirrors
 * the hierarchy decided in `07_backend/firestore_schema.md` §3.2:
 * birthDate/height prefer `profile` (`UserProfile.profile`, mutable) over
 * `questionnaire` (`Quiz`, immutable onboarding); weight always comes from
 * `assessment` (`users/{uid}/assessments`); sex/goal always come from
 * `questionnaire` today, kept explicit in case a mutable source appears later.
 */
export type NutritionPhysicalFieldSource = 'profile' | 'questionnaire' | 'assessment';

/**
 * Snapshot of the physical data Nutrition reads from already-existing AJ
 * Fit sources. This is NOT a new source of truth — every field here is
 * resolved, at read time, from the sources in `firestore_schema.md` §3.2;
 * this type only describes the shape of that resolved snapshot.
 */
export interface NutritionPhysicalContext<TTimestamp = unknown> {
  sex: Sex;
  /** Raw value from whichever source resolved it (`UserProfile.profile.birthDate` or `Quiz.birthDate`). */
  birthDate: TTimestamp;
  /** Derived from `birthDate` at resolution time — never stored independently (same rule as `Quiz.birthDate`'s own doc comment in AppState.tsx). */
  ageYears: number;
  heightCm: number;
  weightKg: number;
  goal: NutritionGoal;

  sources: {
    birthDate: NutritionPhysicalFieldSource;
    height: NutritionPhysicalFieldSource;
    weight: NutritionPhysicalFieldSource;
    sex: NutritionPhysicalFieldSource;
    goal: NutritionPhysicalFieldSource;
  };
}

// ---------------------------------------------------------------------------
// 4. Integração com Treino — contrato fino aprovado
// ---------------------------------------------------------------------------

/**
 * The ONLY contact point between Nutrition and the Treino domain
 * (`10_integrations/workout_integration.md` §5). Resolving this from
 * `users/{uid}/workoutPrograms/{activeProgramId}.prescribedTrainingFrequency`
 * (fallback `Quiz.days`) is a future reader's job — never
 * `loadActiveWorkoutProgram` called directly from Nutrition code.
 */
export interface WorkoutNutritionContext {
  weeklyTrainingFrequency: number;
}

// ---------------------------------------------------------------------------
// 5. Nutrition Engine — targets e output (sem lógica, sem constantes PENDING)
// ---------------------------------------------------------------------------

/**
 * `NutritionEngineInput.inherited` per `03_nutrition_engine/nutrition_engine_contract.md`
 * (updated). Deliberately excludes `pregnancyStatus` — per
 * `07_backend/firestore_schema.md` §3.1, pregnancy/lactation are current
 * state owned by `NutritionProfile`, not something "inherited" from an
 * external source. The engine reads them from
 * `NutritionProfile.pregnant`/`.breastfeeding` instead.
 */
export interface NutritionEngineInheritedContext {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  currentWeightKg: number;
  goal: NutritionGoal;
}

export interface NutritionEngineInput {
  inherited: NutritionEngineInheritedContext;
  /**
   * The engine's only contact point with the Treino domain, reusing
   * `WorkoutNutritionContext` as-is — not duplicated. Added here because
   * `energy_calculation.md` §3 and `10_integrations/workout_integration.md`
   * require `weeklyTrainingFrequency` for TDEE, but no earlier version of
   * `NutritionEngineInput` had a field to carry it.
   */
  workout: WorkoutNutritionContext;
  nutritionProfile: NutritionProfile;
}

/** `min`/`max` bound a `target` — used for the per-meal ranges the engine produces (`nutrition_rules.json` `mealDistribution.engineProducesRanges`). */
export interface NutritionNumericRange {
  min: number;
  target: number;
  max: number;
}

export interface MealNutritionTarget {
  slot: NutritionMealSlot;
  kcal: NutritionNumericRange;
  proteinG: NutritionNumericRange;
  carbsG: NutritionNumericRange;
  fatG: NutritionNumericRange;
  fiberG?: NutritionNumericRange;
}

export interface NutritionEnergyTarget {
  rmrKcal: number;
  tdeeKcal: number;
  targetKcal: number;
  /** Whether the safety-floor clamp (`09_safety/nutrition_safety_rules.md` §3) had to be applied. */
  safetyClampApplied: boolean;
}

/** Daily macro targets are single resolved numbers; only the per-meal breakdown (`MealNutritionTarget`) is a range. */
export interface NutritionDailyMacroTargets {
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
}

/**
 * Opaque, engine-defined audit trail. No document specifies its internal
 * shape beyond the name (`nutrition_engine_contract.md` §4) — kept
 * structurally open until the Nutrition Engine itself defines it, rather
 * than guessing fields that aren't grounded in any doc.
 */
export type NutritionCalculationTrace = Record<string, unknown>;

export interface NutritionEngineOutput {
  eligible: boolean;
  blockers: NutritionEligibilityBlocker[];

  energy: NutritionEnergyTarget;
  macros: NutritionDailyMacroTargets;

  mealTargets: MealNutritionTarget[];
  calculationTrace: NutritionCalculationTrace;

  /**
   * So the output is self-describing/reproducible on its own, without a
   * separate wrapping step. `NutritionEngineSnapshot.ruleVersions` below
   * predates this field and still exists for the persisted-plan shape — the
   * two may need reconciling once Firestore persistence is implemented, but
   * that's out of scope for this pass; reusing `NutritionEngineRuleVersions`
   * here, not duplicating it.
   */
  versions: NutritionEngineRuleVersions;
}

/**
 * Internal engine rule versions required by `nutrition_engine_contract.md`
 * §6 ("Persistir no mínimo: ..."). Deliberately a separate type from
 * `NutritionPlanVersions` below, which only holds the canonical
 * `meal_plan_schema.json` version fields — these three
 * (`energyRulesVersion`/`macroRulesVersion`/`mealDistributionVersion`) live
 * inside `engineSnapshot` instead (`07_backend/firestore_schema.md` §3.3).
 */
export interface NutritionEngineRuleVersions {
  nutritionEngineVersion: string;
  energyRulesVersion: string;
  macroRulesVersion: string;
  mealDistributionVersion: string;
  questionnaireVersion: number;
  foodCatalogVersion: string;
}

/**
 * `NutritionPlan.engineSnapshot` — not field-specified by any canonical
 * schema (`meal_plan_schema.json` only says `"engineSnapshot": { "type":
 * "object" }`, unconstrained) nor spelled out in the markdown beyond the
 * name. This shape is this file's own synthesis of what §6 of
 * `nutrition_engine_contract.md` says must be reproducible/auditable from a
 * persisted plan — not something lifted verbatim from a doc.
 */
export interface NutritionEngineSnapshot {
  output: NutritionEngineOutput;
  ruleVersions: NutritionEngineRuleVersions;
}

// ---------------------------------------------------------------------------
// 6. Food Catalog — somente as referências usadas pelo plano
// ---------------------------------------------------------------------------
// Global catalog records are backend-owned; client writes stay under users/{uid}.

export interface NutritionFoodNutritionValues {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number | null;
}

/** A food + quantity, before nutrition values are attached (matches `canonical/ai_output_schema.json`'s food item shape exactly). */
export interface NutritionFoodReference {
  foodId: NutritionFoodId;
  grams: number;
}

/** Immutable snapshot of a food's nutrition data at generation time — protects diary history from future catalog edits (`04_food_catalog/food_catalog_model.md` §7). */
export interface NutritionFoodSnapshot extends NutritionFoodNutritionValues {
  name: string;
}

/** Only `approved` foods may be used by AI generation (`04_food_catalog/food_tags_and_classification.md` §9). */
export const NUTRITION_FOOD_GENERATION_STATUSES = ['approved', 'pending_review', 'blocked'] as const;
export type NutritionFoodGenerationStatus = (typeof NUTRITION_FOOD_GENERATION_STATUSES)[number];

export const NUTRITION_FOOD_CATEGORIES = [
  'protein_source', 'carbohydrate_source', 'fruit', 'vegetable', 'dairy',
  'fat_source', 'legume', 'cereal', 'beverage', 'supplement', 'other',
] as const;
export type NutritionFoodCategory = (typeof NUTRITION_FOOD_CATEGORIES)[number];
export const NUTRITION_FOOD_ALLERGENS = [
  'milk', 'egg', 'peanut', 'tree_nuts', 'soy', 'wheat', 'fish', 'shellfish', 'other',
] as const;
export type NutritionFoodAllergen = (typeof NUTRITION_FOOD_ALLERGENS)[number];
export const NUTRITION_FOOD_SOURCE_TYPES = ['tbca', 'taco', 'usda', 'label', 'manual'] as const;
export type NutritionFoodSourceType = (typeof NUTRITION_FOOD_SOURCE_TYPES)[number];

/**
 * Deterministic preparation classification, hand-reviewed per food (same
 * convention as `scripts/nutrition/sources/taco-v1-enrichment.json`'s
 * dietaryFlags/allergens — never inferred from a keyword function).
 * `composite` covers breaded/fried/sauced/baked-dish preparations (à
 * milanesa, frito, empanado, lasanha, estrogonofe, pizza, bolonhesa,
 * gratinado, recheado and similar) and is never eligible for AI generation.
 */
export const NUTRITION_FOOD_PREPARATIONS = ['raw', 'cooked', 'grilled', 'roasted', 'none', 'composite'] as const;
export type NutritionFoodPreparation = (typeof NUTRITION_FOOD_PREPARATIONS)[number];

/** Only these preparations may ever reach AI generation as a candidate — `composite` is permanently excluded. */
export const NUTRITION_GENERATION_ALLOWED_PREPARATIONS: readonly NutritionFoodPreparation[] = [
  'raw', 'cooked', 'grilled', 'roasted', 'none',
];

/**
 * Which meal context(s) a food is culturally coherent in, independent of its
 * macro `category` — e.g. a breaded cutlet and a grilled chicken breast are
 * both `protein_source`, but only the grilled one belongs in `main_meal`,
 * and neither belongs in `breakfast`.
 */
export const NUTRITION_MEAL_CONTEXTS = ['breakfast', 'snack', 'main_meal', 'supper'] as const;
export type NutritionMealContext = (typeof NUTRITION_MEAL_CONTEXTS)[number];

/** null = unreviewed/unknown, never interpreted as safe. */
export interface NutritionFoodDietaryFlags {
  vegetarian: boolean | null;
  vegan: boolean | null;
  pescatarian: boolean | null;
}
export interface NutritionFoodSource {
  type: NutritionFoodSourceType;
  sourceId: string;
  sourceName: string;
  sourceVersion?: string;
}
export interface NutritionFood<TTimestamp = unknown> {
  id: string;
  name: string;
  aliases: string[];
  category: NutritionFoodCategory;
  source: NutritionFoodSource;
  nutritionPer100g: NutritionFoodNutritionValues;
  dietaryFlags: NutritionFoodDietaryFlags;
  /** null means allergen review is incomplete; [] means reviewed and none known. */
  allergens: NutritionFoodAllergen[] | null;
  /** null means preparation review is incomplete — never treated as generation-eligible. See `NUTRITION_GENERATION_ALLOWED_PREPARATIONS`. */
  preparation: NutritionFoodPreparation | null;
  /** Optional metadata, not consulted by generation eligibility (diet-quality-v2, 2026-10-10) — null means unreviewed. */
  mealContexts: NutritionMealContext[] | null;
  /**
   * Provenance of `nutritionPer100g.fiberG` (fiber-catalog-widening round,
   * 2026-10-10) — absent/undefined means "measured" (the source dataset
   * reported this value directly, or the field is genuinely null/unknown).
   * `'inferred_zero'` means a hand-reviewed, per-item enrichment decision
   * (never a generic rule) set `fiberG` to `0` because the food belongs to
   * a class with no dietary fiber by definition (simple animal-source
   * protein/dairy/eggs) and the source dataset simply never measured it —
   * see `scripts/nutrition/sources/taco-v1-enrichment.json`'s
   * `inferFiberGZero` items for the exact reviewed list.
   */
  fiberGProvenance?: 'measured' | 'inferred_zero';
  generationStatus: NutritionFoodGenerationStatus;
  brand?: { name: string; productName?: string } | null;
  catalogVersion: string;
  /** Bounded prefixes for Firestore array-contains search; backend generated. */
  searchPrefixes: string[];
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export interface NutritionCatalogMeta<TTimestamp = unknown> {
  schemaVersion: 1;
  catalogVersion: string;
  importedAt: TTimestamp;
  sourceVersions: Partial<Record<NutritionFoodSourceType, string[]>>;
  sourceCounts: Partial<Record<NutritionFoodSourceType, number>>;
  importedRecordCount: number;
}

// ---------------------------------------------------------------------------
// 6b. Food Log Catalog — ampla, separada do catálogo de geração (Fase C2)
// ---------------------------------------------------------------------------
// `docs/nutrition/catalog-expansion/03_canonical_model.md`. This is a SECOND,
// independent global catalog for food-logging/search — never read by the
// Nutrition Engine/AI generation, which continues to read only
// `NutritionFood`/`nutritionFoods` above. Deliberately has no
// `generationStatus`/`dietaryFlags`/`allergens` — those carry an "approved
// for AI" meaning that doesn't apply here; see `status` below instead.

export const FOOD_LOG_SOURCE_TYPES = ['taco', 'tbca', 'off', 'fatsecret', 'manual'] as const;
export type FoodLogSourceType = (typeof FOOD_LOG_SOURCE_TYPES)[number];

export interface FoodLogSource {
  type: FoodLogSourceType;
  sourceId: string;
  sourceName: string;
  sourceVersion?: string;
}

/**
 * Independent of `NutritionFoodGenerationStatus` — this is a visibility gate
 * for search/logging only, never a safety-for-AI signal.
 * `active` = searchable/loggable; `hidden` = quality review failed or
 * duplicate, excluded from search but kept for audit; `deprecated` = a
 * newer record superseded this one (e.g. a source re-import), kept only so
 * historical diary snapshots referencing it remain resolvable.
 */
export const FOOD_LOG_STATUSES = ['active', 'hidden', 'deprecated'] as const;
export type FoodLogStatus = (typeof FOOD_LOG_STATUSES)[number];

export const FOOD_LOG_LICENSES = ['public_domain', 'odbl_share_alike', 'proprietary_contract', 'internal'] as const;
export type FoodLogLicense = (typeof FOOD_LOG_LICENSES)[number];

export interface FoodLogProvenance {
  license: FoodLogLicense;
  attributionRequired: boolean;
  attributionText?: string;
}

/**
 * Finer-grained, logging-only classification (Fase C3 round brief Part 7)
 * — purely additive metadata alongside `category` (which stays the
 * generation taxonomy, untouched). Never read by the Nutrition
 * Engine/generation. Deterministic keyword classification only (no AI),
 * see `src/nutrition/foodLog/subCategory.ts`.
 */
export const FOOD_LOG_SUB_CATEGORIES = [
  'poultry', 'beef', 'pork', 'fish', 'eggs', 'dairy', 'grains', 'legumes', 'fruits', 'vegetables',
  'breads', 'supplements', 'beverages', 'snacks', 'prepared_food', 'branded_product', 'other',
] as const;
export type FoodLogSubCategory = (typeof FOOD_LOG_SUB_CATEGORIES)[number];

export interface FoodLogEntry<TTimestamp = unknown> {
  id: string;
  source: FoodLogSource;
  name: string;
  aliases: string[];
  brand?: { name: string; productName?: string } | null;
  /** Normalized EAN/GTIN digits only, when the source provides one (Open Food Facts). */
  barcode?: string | null;
  locale: string;
  /** Reuses the generation catalog's taxonomy on purpose (`03_canonical_model.md`) — a broader taxonomy is deferred to C3. */
  category: NutritionFoodCategory;
  /** Optional, additive — absent on records imported before Fase C3 until backfilled/reimported. */
  subCategory?: FoodLogSubCategory;
  nutritionPer100g: NutritionFoodNutritionValues;
  status: FoodLogStatus;
  /** Operational lifecycle metadata; catalog rows are never deleted because diary snapshots may reference them. */
  deprecation?: { reason: 'missing_from_source' | 'source_record_rejected'; sourceVersion: string };
  provenance: FoodLogProvenance;
  catalogVersion: string;
  /** Same bounded-prefix search strategy as `NutritionFood.searchPrefixes`. */
  searchPrefixes: string[];
  /** Storage-level pre-ranking: generic composition tables before branded sources inside the bounded Firestore candidate pool. */
  searchSourcePriority: 0 | 1;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export interface FoodLogCatalogMeta<TTimestamp = unknown> {
  schemaVersion: 1;
  catalogVersion: string;
  importedAt: TTimestamp;
  sourceVersions: Partial<Record<FoodLogSourceType, string[]>>;
  sourceCounts: Partial<Record<FoodLogSourceType, number>>;
  rejectedCounts: Partial<Record<FoodLogSourceType, number>>;
  importedRecordCount: number;
}

// ---------------------------------------------------------------------------
// 7. Plano alimentar — recommendedPlan != actualIntake
// ---------------------------------------------------------------------------

export const NUTRITION_PLAN_STATUSES = ['active', 'archived'] as const;
export type NutritionPlanStatus = (typeof NUTRITION_PLAN_STATUSES)[number];

/** Shared by `NutritionMealOption.totals` and `NutritionDailyLog.totals`/`NutritionLoggedMeal.totals` — same shape in both canonical schema and `firestore_schema.md`. */
export interface NutritionTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

/**
 * Diet-quality-v3 (2026-10-10, "PLANO RECOMENDADO != CONSUMO REGISTRADO"):
 * a recommended-plan item is a free-form AI estimate, never resolved
 * against `nutritionFoods` — no `foodId`, no catalog snapshot. `quantity`+
 * `unit` replace `grams` (the AI picks whatever unit reads naturally —
 * "unidade", "xícara", "ml", "g" — not always grams). `estimatedNutrition`
 * is the AI's own estimate for the stated quantity (an absolute amount,
 * not per-100g). `allergens` is self-declared by the AI (closed enum) —
 * the ONE thing the validator still deterministically enforces against
 * `excludedAllergens`, since there is no catalog record left to check
 * safety against. The diary (`NutritionLoggedFoodItem`) is the only place
 * that still resolves a real catalog/food-log food when the user actually
 * registers what they ate.
 *
 * `estimatedNutrition`/`allergens` are REQUIRED for anything the backend
 * persists today (`functions/src/nutrition/generation/domain.ts`'s
 * `validRawFoodItem` + the OpenAI strict schema both reject an item
 * missing either). They're typed optional here only because a document
 * already persisted under the pre-diet-quality-v3 catalog architecture
 * (plain `{foodId, grams}`, resolved live against `nutritionFoods`) can
 * still be read back from an old `nutritionPlans`/`nutritionFavoriteMealOptions`
 * doc — that resolution code path no longer exists, so there is no way to
 * recompute a per-item snapshot for one. Every read site must treat an
 * absent value as "unknown for this historical item", never crash.
 */
export interface NutritionPlanFoodItem {
  name: string;
  quantity: number;
  unit: string;
  /** Short free-text note ("grelhado", "sem sal") — never a multi-step recipe. Empty string means none. */
  preparationNote: string;
  estimatedNutrition?: NutritionFoodNutritionValues;
  allergens?: NutritionFoodAllergen[];
}

export interface NutritionMealOption {
  id: string;
  foods: NutritionPlanFoodItem[];
  totals: NutritionTotals;
}

export interface NutritionMeal {
  slot: NutritionMealSlot;
  /** References one of `options[].id` — never an index, once persisted (contrast with `NutritionAiMeal.recommendedOptionIndex` below, pre-persistence). */
  recommendedOptionId: string;
  options: NutritionMealOption[];
}

/**
 * Exactly `canonical/meal_plan_schema.json`'s `versions` object
 * (`"additionalProperties": false` — only these 6 fields).
 * `questionnaireVersion` is `number` (decision final: integer, never
 * string — `canonical/questionnaire.json`'s own `questionnaireVersion: 1`
 * is the reference value). The three engine-internal rule versions
 * (`energyRulesVersion`/`macroRulesVersion`/`mealDistributionVersion`,
 * required by `nutrition_engine_contract.md` §6) deliberately do NOT appear
 * here — they live inside `engineSnapshot` via `NutritionEngineRuleVersions`
 * instead, which canonical leaves unconstrained
 * (`07_backend/firestore_schema.md` §3.3).
 */
export interface NutritionPlanVersions {
  planSchemaVersion: string;
  nutritionEngineVersion: string;
  questionnaireVersion: number;
  foodCatalogVersion: string;
  aiGenerationSchemaVersion: string;
  promptVersion: string;
}

/**
 * `NutritionGenerationProfileSnapshot` per `02_questionnaire/answer_schema.md`
 * §7, with `unknown` fields replaced by concrete types. Deliberately has no
 * `inherited.pregnancyStatus` — pregnancy/lactation are not an "inherited"
 * field (see `NutritionEngineInheritedContext`). The pregnant/breastfeeding
 * VALUE actually used for a given generation is still captured, but as part
 * of `nutritionAnswers` (`NutritionProfile`) below, not `inherited`.
 */
export interface NutritionGenerationProfileSnapshot<TTimestamp = unknown> {
  questionnaireVersion: number;
  inherited: NutritionEngineInheritedContext;
  nutritionAnswers: NutritionProfile<TTimestamp>;
  capturedAt: TTimestamp;
}

/**
 * Matches `canonical/meal_plan_schema.json` exactly — the generation
 * pipeline's output payload. `ownerUid` is deliberately absent, same
 * convention as `questionnaires`/`assessments`: implicit via the
 * `users/{uid}/nutritionPlans/{planId}` path, never duplicated in the
 * document body (`src/services/assessments.ts`'s own doc comment states
 * this convention explicitly for that sibling subcollection).
 */
export interface NutritionPlanPayload {
  planId: string;
  generationId: string;
  status: NutritionPlanStatus;
  profileSnapshot: NutritionGenerationProfileSnapshot;
  physicalSnapshot: NutritionPhysicalContext;
  engineSnapshot: NutritionEngineSnapshot;
  meals: NutritionMeal[];
  dailyTotals: NutritionTotals;
  generationMetadata: { provider: string; model: string; attempts: number; corrected: boolean; fallbackUsed: boolean };
  versions: NutritionPlanVersions;
}

/**
 * Full persisted Firestore document: `NutritionPlanPayload` plus the
 * server-assigned timestamps described in `07_backend/firestore_schema.md`
 * §4 and `05_meal_plan/meal_plan_model.md` §6 — fields that
 * `canonical/meal_plan_schema.json` does not mention at all (its schema has
 * no `createdAt`/`activatedAt`/`archivedAt`). Modeled here as payload +
 * metadata, the same split the codebase already uses for
 * `Exercise`/`ExerciseSeedInput` (`src/types/exercise.ts`), to reconcile the
 * two sources without silently picking one.
 */
export interface NutritionPlan<TTimestamp = unknown> extends NutritionPlanPayload {
  createdAt: TTimestamp;
  activatedAt: TTimestamp;
  archivedAt?: TTimestamp | null;
}

// ---------------------------------------------------------------------------
// 8. Geração por IA — shape bruto do modelo (pré-persistência)
// ---------------------------------------------------------------------------

/**
 * Matches `canonical/ai_output_schema.json` exactly — the model's raw
 * output, before `recommendedOptionIndex` is resolved into a persisted
 * option `id`. Diet-quality-v3: the AI's own `NutritionPlanFoodItem`
 * estimate IS the final persisted shape now (no catalog resolution step
 * in between), so this is structurally identical to the persisted
 * `NutritionMealOption.foods` — kept as a distinct type only to mark the
 * pre-persistence/pre-validation boundary.
 */
export interface NutritionAiMealOption {
  foods: NutritionPlanFoodItem[];
}

export interface NutritionAiMeal {
  slot: NutritionMealSlot;
  recommendedOptionIndex: number;
  options: NutritionAiMealOption[];
}

export interface NutritionAiMealPlanOutput {
  meals: NutritionAiMeal[];
}

// ---------------------------------------------------------------------------
// 9. Diário alimentar — consumo real, separado da recomendação
// ---------------------------------------------------------------------------

/**
 * What a logged food item actually is — formalized in
 * `canonical/nutrition_constraints.json` `diary.loggedItemSources`.
 *
 * `recommended_plan_option` is deliberately NOT one of these values: "the
 * user followed the recommended option" is a meal-level fact (the
 * recommended option is a *set* of foods, not one food), not something a
 * single logged item can carry on its own. That signal lives on
 * `NutritionLoggedMeal.followedRecommendedOptionId` below instead — see
 * `canonical/nutrition_constraints.json` `diary.recommendedOptionTracking`.
 */
export const NUTRITION_LOGGED_FOOD_SOURCES = ['catalog_food', 'custom_food', 'recipe', 'food_log_catalog'] as const;
export type NutritionLoggedFoodSource = (typeof NUTRITION_LOGGED_FOOD_SOURCES)[number];

export interface NutritionLoggedFoodItem<TTimestamp = unknown> extends NutritionFoodReference {
  /** Client-generated id, stable for the lifetime of this entry — addresses edit/move/remove without relying on array position. */
  id: string;
  source: NutritionLoggedFoodSource;
  snapshot: NutritionFoodSnapshot;
  loggedAt: TTimestamp;
}

export interface NutritionLoggedMeal<TTimestamp = unknown> {
  slot: NutritionMealSlot;
  /** Set when the user marked "I followed this recommended option" (`05_meal_plan/meal_plan_model.md` §8) — references `NutritionMealOption.id` from the plan active at log time, never the plan itself. */
  followedRecommendedOptionId?: string | null;
  items: NutritionLoggedFoodItem<TTimestamp>[];
  totals: NutritionTotals;
}

/**
 * `users/{uid}/nutritionDailyLogs/{localDate}` (`07_backend/firestore_schema.md` §5).
 *
 * `meals` is assembled by the service layer from the `meals/{slot}` (and
 * each meal's `items/{itemId}`) subcollections — NOT stored as a nested
 * array on this document. Six meals x six items, revalidated in full on
 * every write, exceeded Firestore Rules' 1000-expression-per-write budget
 * when the whole day was one document. `loggedItemCount` is the only
 * extra field this implies: a client-maintained running total of items
 * across all meals that day, so the backend (`nutritionNotificationContext.ts`)
 * can detect an empty day without reading every meal/item subcollection.
 */
export interface NutritionDailyLog<TTimestamp = unknown> {
  localDate: string;
  timezone: string;
  meals: NutritionLoggedMeal<TTimestamp>[];
  totals: NutritionTotals;
  loggedItemCount: number;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

// ---------------------------------------------------------------------------
// 10. Alimentos próprios e receitas — macros sempre derivados
// ---------------------------------------------------------------------------

/** `users/{uid}/nutritionFoods/{foodId}` — user-registered food, never auto-approved for AI generation (`04_food_catalog/food_catalog_model.md` §5). */
export interface NutritionCustomFood<TTimestamp = unknown> {
  id: string;
  name: string;
  nutritionPer100g: NutritionFoodNutritionValues;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export interface NutritionRecipeIngredient {
  foodId: NutritionFoodId;
  grams: number;
}

/**
 * `users/{uid}/nutritionRecipes/{recipeId}`. `calculatedNutrition` is always
 * derived from `ingredients` — the client/backend must never accept a
 * manually authored value here as authoritative (`04_food_catalog/food_catalog_model.md`
 * §6: "Não permitir que o usuário sobrescreva manualmente os macros
 * calculados da receita"). This type does not enforce that at the type
 * level. The write path excludes this field; on-demand calculation resolves
 * current ingredient records and ignores client-supplied derived values.
 */
export interface NutritionRecipe<TTimestamp = unknown> {
  id: string;
  name: string;
  description?: string;
  ingredients: NutritionRecipeIngredient[];
  /**
   * Weight of the finished, cooked recipe (grams) — may differ from the
   * sum of ingredient grams due to water loss/gain during preparation.
   * When absent, `per100g`/diary-logging math falls back to the ingredient
   * sum as an estimate (`nutrition/catalog/math.ts`'s `calculateRecipeBreakdown`).
   */
  finalWeightG?: number | null;
  /** How many servings the finished recipe yields; enables "per serving" macros and logging the recipe by portion instead of grams. */
  servings?: number | null;
  /** Backend-derived only; absent on a client-authored recipe until calculated. */
  calculatedNutrition?: NutritionFoodNutritionValues;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

// ---------------------------------------------------------------------------
// 11. Generation Job — status do job assíncrono
// ---------------------------------------------------------------------------

export const NUTRITION_GENERATION_STATUSES = ['queued', 'running', 'validating', 'completed', 'failed'] as const;
export type NutritionGenerationStatus = (typeof NUTRITION_GENERATION_STATUSES)[number];

/** Formalized in `canonical/nutrition_rules.json` `generation.operationTypes`. */
export const NUTRITION_GENERATION_OPERATION_TYPES = ['full_plan', 'meal_alternative'] as const;
export type NutritionGenerationOperationType = (typeof NUTRITION_GENERATION_OPERATION_TYPES)[number];

/** `06_ai/ai_observability.md` §4 — the only place any nutrition doc enumerates literal failure codes. */
/**
 * Diet-quality-v3 (2026-10-10): `AI_UNKNOWN_FOOD`/`AI_EXCLUDED_FOOD`
 * (catalog-ID lookup failures) and `CATALOG_INSUFFICIENT` (candidate-pool
 * preflight) are gone — generation no longer resolves against
 * `nutritionFoods` at all, so neither failure mode can occur anymore.
 */
export const NUTRITION_GENERATION_ERROR_CODES = [
  'AI_TIMEOUT',
  'AI_RATE_LIMIT',
  'AI_SCHEMA_INVALID',
  'AI_MACRO_VALIDATION_FAILED',
  'AI_SAFETY_VALIDATION_FAILED',
  'AI_RETRY_EXHAUSTED',
  'AI_COST_LIMIT_EXCEEDED',
  'FEATURE_DISABLED',
  'INVALID_NUTRITION_CONTEXT',
  'ACCOUNT_INACTIVE',
  'AI_PROVIDER_ERROR',
] as const;
export type NutritionGenerationErrorCode = (typeof NUTRITION_GENERATION_ERROR_CODES)[number];

/** `users/{uid}/nutritionGenerationJobs/{generationId}` (`07_backend/firestore_schema.md` §9). */
export interface NutritionGenerationJob<TTimestamp = unknown> {
  generationId: string;
  operationType: NutritionGenerationOperationType;
  status: NutritionGenerationStatus;
  requestedAt: TTimestamp;
  startedAt?: TTimestamp | null;
  completedAt?: TTimestamp | null;
  planId?: string | null;
  errorCode?: NutritionGenerationErrorCode | null;
  retryCount: number;
  aiAttemptCount?: number;
  lastFailureCode?: NutritionGenerationErrorCode | null;
  /** Due time for crash recovery; backend-only. */
  nextAttemptAt?: TTimestamp | null;
  leaseUntil?: TTimestamp | null;
  /** Optional audit copy — the plan itself is the authoritative source for versions once `status === 'completed'`. */
  versions?: NutritionPlanVersions;
}

// ---------------------------------------------------------------------------
// 12. Alternativas de refeição — substituem uma opção, nunca o plano
// ---------------------------------------------------------------------------

/**
 * Structured reasons for requesting a meal alternative — deliberately NOT
 * free text (round brief §13). Only `dislike_foods`, when the user also
 * names specific foods, is ever eligible to become a permanent exclusion
 * (§14) — `more_variety`/`simpler`/`missing_ingredients` never are, since
 * wanting variety today says nothing about disliking today's foods forever.
 */
export const NUTRITION_MEAL_FEEDBACK_REASONS = [
  'dislike_foods', 'simpler', 'more_variety', 'missing_ingredients',
] as const;
export type NutritionMealFeedbackReason = (typeof NUTRITION_MEAL_FEEDBACK_REASONS)[number];

/** `users/{uid}/nutritionMealAlternatives/{alternativeId}` — backend-authoritative, same validator/correction pipeline as a full plan, scoped to one meal. Never replaces the originating plan's option; the client decides separately whether to log it or keep it in the plan. */
export interface NutritionMealAlternative<TTimestamp = unknown> {
  alternativeId: string;
  planId: string;
  slot: NutritionMealSlot;
  options: NutritionMealOption[];
  recommendedOptionId: string;
  feedback?: { reason: NutritionMealFeedbackReason; dislikedFoodIds?: string[] } | null;
  catalogVersion: string;
  generationMetadata: { provider: string; model: string; attempts: number; corrected: boolean; fallbackUsed: boolean };
  createdAt: TTimestamp;
}

// ---------------------------------------------------------------------------
// 13. Preferências e favoritos — atalhos pessoais, nunca autoridade de geração
// ---------------------------------------------------------------------------

/**
 * A favorited meal option — either straight from a plan or from a generated
 * alternative. Keeps its own food snapshots so it stays useful even if the
 * originating plan/alternative is later archived/deleted (round brief §15).
 */
export interface NutritionFavoriteMealOption<TTimestamp = unknown> {
  id: string;
  source: 'plan' | 'alternative';
  planId?: string;
  alternativeId?: string;
  slot: NutritionMealSlot;
  foods: NutritionPlanFoodItem[];
  totals: NutritionTotals;
  createdAt: TTimestamp;
}

/**
 * UI projection composed from `nutritionPreferences/current` and the bounded
 * `nutritionFavoriteMealOptions` subcollection. `favoriteMealOptions` is not
 * persisted as a nested array in the preferences document.
 */
export interface NutritionPreferences<TTimestamp = unknown> {
  favoriteFoodIds: string[];
  /** Separate from `favoriteFoodIds` — a recipe is never a food, never mixed into the same list. */
  favoriteRecipeIds: string[];
  favoriteMealOptions?: NutritionFavoriteMealOption<TTimestamp>[];
  updatedAt: TTimestamp;
}
