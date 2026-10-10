/** Accepts either decimal separator; empty string means "not provided", not zero. */
export function parseNonNegativeNumber(value: string): number | null {
  if (value.trim().length === 0) return null;
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export interface CustomFoodFormInput {
  name: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
}

export interface CustomFoodFormErrors {
  name?: boolean;
  kcal?: boolean;
  protein?: boolean;
  carbs?: boolean;
  fat?: boolean;
  fiber?: boolean;
}

export interface CustomFoodFormResult {
  errors: CustomFoodFormErrors;
  valid: boolean;
  values?: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number };
}

/** `customFood` screen's single validation gate — required macros, optional fiber, name non-empty. */
export function validateCustomFoodForm(input: CustomFoodFormInput): CustomFoodFormResult {
  const kcal = parseNonNegativeNumber(input.kcal);
  const protein = parseNonNegativeNumber(input.protein);
  const carbs = parseNonNegativeNumber(input.carbs);
  const fat = parseNonNegativeNumber(input.fat);
  const fiberProvided = input.fiber.trim().length > 0;
  const fiber = fiberProvided ? parseNonNegativeNumber(input.fiber) : undefined;

  const errors: CustomFoodFormErrors = {
    name: input.name.trim().length === 0,
    kcal: kcal == null,
    protein: protein == null,
    carbs: carbs == null,
    fat: fat == null,
    fiber: fiberProvided && fiber == null,
  };
  const valid = !Object.values(errors).some(Boolean);
  if (!valid) return { errors, valid };
  return {
    errors, valid,
    values: { kcal: kcal!, proteinG: protein!, carbsG: carbs!, fatG: fat!, ...(fiber != null ? { fiberG: fiber } : {}) },
  };
}
