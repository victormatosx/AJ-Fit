import type { OnboardingStepId } from '../../onboarding/steps';
import type { LooseT } from './QuestionRenderer';

/**
 * What AJ says back after a key answer.
 *
 * Presentation only, and strictly derivative: every line is assembled from
 * answers the funnel has ALREADY recorded. Nothing here computes a
 * prescription, a calorie target, a split or a projection — where a line needs
 * a number, that number is one the user typed (height, weight, a day count) or
 * a count of steps the sequence itself resolved. A reaction that cannot be
 * built from what is already known returns null and simply doesn't happen.
 *
 * Every string goes through i18n under `quiz:aj.reactions.*`; this module only
 * decides WHICH key and WHICH interpolations.
 */

export interface AjReactionInput {
  stepId: OnboardingStepId;
  /** Translator bound loosely, since the key is composed from the answer. */
  t: LooseT;
  /** Checks whether a composed key exists before using it. */
  exists: (key: string) => boolean;
  /** The user's first name, for the lines that address them. */
  name?: string | null;
  /** Answers already recorded by the funnel. */
  answers: {
    heightCm?: number | null;
    weightKg?: number | null;
    goal?: string | null;
    scheduleMode?: string | null;
    trainingDayCount?: number | null;
    /** Weekday labels, already localised and ordered by the caller. */
    trainingDayLabels?: string[] | null;
    specialConditions?: string[] | null;
    limits?: string[] | null;
    /** Localised region labels for the limitations worth protecting. */
    limitLabels?: string[] | null;
    allergens?: string[] | null;
    varietyPreference?: string | null;
    commitment?: string | null;
  };
  /**
   * How many of the conditional health steps (blocks A–H) the sequence
   * resolved as applicable. Supplied by the caller from `getStepSequence` —
   * never recounted here.
   */
  applicableHealthStepCount?: number;
}

/** Body-mass index, rounded to one decimal. Display only; nothing reads it back. */
function bodyMassIndex(heightCm: number, weightKg: number): number | null {
  if (heightCm <= 0 || weightKg <= 0) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

const KEY = 'quiz:aj.reactions';

/**
 * The reaction for a step, or null when there is nothing worth saying —
 * "no allergies", limitations that are only "other"/"none", a goal whose
 * value has no authored line.
 */
export function ajReactionLine(input: AjReactionInput): string | null {
  const { stepId, t, exists, answers, name } = input;

  switch (stepId) {
    case 'weight': {
      const { heightCm, weightKg } = answers;
      if (!heightCm || !weightKg) return null;
      const bmi = bodyMassIndex(heightCm, weightKg);
      if (bmi == null) return null;
      return t(`${KEY}.weight`, {
        height: Math.round(heightCm),
        weight: Math.round(weightKg),
        bmi: bmi.toFixed(1),
      });
    }

    case 'goal': {
      const goal = answers.goal;
      if (!goal) return null;
      // Goal values outside the authored set (legacy aliases still present in
      // the catalogue) get no line rather than a generic one.
      const key = `${KEY}.goal.${goal}`;
      return exists(key) ? t(key) : null;
    }

    case 'days': {
      const count = answers.trainingDayCount ?? 0;
      if (count <= 0) return null;
      if (answers.scheduleMode === 'free') {
        return t(`${KEY}.days.free`, { count });
      }
      if (count >= 7) return t(`${KEY}.days.everyDay`);
      const labels = answers.trainingDayLabels ?? [];
      if (labels.length === 0) return null;
      return t(`${KEY}.days.fixed`, { days: formatList(t, labels), count });
    }

    case 'specialConditions': {
      const conditions = (answers.specialConditions ?? []).filter((c) => c !== 'none');
      if (conditions.length === 0) return t(`${KEY}.specialConditions.none`);
      const count = input.applicableHealthStepCount ?? 0;
      if (count <= 0) return t(`${KEY}.specialConditions.none`);
      return t(`${KEY}.specialConditions.some`, { count });
    }

    case 'limits': {
      const labels = answers.limitLabels ?? [];
      // "None" and "other" name nothing AJ could promise to protect.
      if (labels.length === 0) return null;
      return t(`${KEY}.limits`, { regions: formatList(t, labels) });
    }

    case 'functionalSituations':
      // One line covers every combination here: whatever was marked, the
      // answer is the same — supported exercises and stable positions.
      return t(`${KEY}.functionalSituations`);

    case 'nutrition_excludedAllergens': {
      const allergens = answers.allergens ?? [];
      if (allergens.length === 0) return null;
      return t(`${KEY}.allergens`);
    }

    case 'nutrition_varietyPreference': {
      const preference = answers.varietyPreference;
      if (!preference) return null;
      const key = `${KEY}.variety.${preference}`;
      return exists(key) ? t(key) : null;
    }

    case 'commitment': {
      const commitment = answers.commitment;
      if (!commitment) return null;
      const key = `${KEY}.commitment.${commitment}`;
      if (!exists(key)) return null;
      return t(key, { name: name ?? '' });
    }

    default:
      return null;
  }
}

/**
 * "A, B e C" — the separator and the final conjunction are both i18n, because
 * the rule differs by language (Portuguese and Spanish drop the serial comma
 * English keeps).
 */
function formatList(t: LooseT, items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  const separator = t('quiz:aj.list.separator');
  const conjunction = t('quiz:aj.list.conjunction');
  return `${items.slice(0, -1).join(separator)}${conjunction}${items[items.length - 1]}`;
}
