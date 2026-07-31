/**
 * Body-composition math for the Avaliação Física feature.
 *
 * Pure domain calculations + validation predicates only — no Firestore, no
 * React. Formulas per docs/15_calculadora_de_dobras_subcutaneas.md (§6, §7,
 * §8, §14). Only the two protocols documented there (Jackson & Pollock 3 and
 * 7 dobras) are implemented; both require sex + age because the regression
 * coefficients differ by sex.
 *
 * BMI/lean mass/fat mass/sum of folds/body density are always derived here
 * at read time — they are never persisted (see src/services/assessments.ts).
 *
 * `age` is accepted here as a plain number rather than a birth date on
 * purpose, to keep this module free of calendar/timezone concerns — but
 * every caller must source it from `computeAge()` (src/lib/ageCalculator.ts),
 * never compute it inline. See AssessmentScreen.tsx's GuidedAssessmentModal
 * for the one legitimate exception (manual entry when no birth date is on
 * file at all).
 */

export type SiteKey =
  | 'chest'
  | 'axilla'
  | 'tricep'
  | 'subscap'
  | 'abdom'
  | 'supra'
  | 'thigh';

export type Sex = 'm' | 'f';

export type SkinfoldProtocolId = 'jp3' | 'jp7';

export const SITE_LABELS: Record<SiteKey, string> = {
  chest: 'Peitoral',
  axilla: 'Axilar Média',
  tricep: 'Tricipital',
  subscap: 'Subescapular',
  abdom: 'Abdominal',
  supra: 'Supra-ilíaca',
  thigh: 'Coxa',
};

export type SkinfoldProtocol = {
  id: SkinfoldProtocolId;
  label: string;
  /** Required fold sites — JP3 sites differ by sex per docs/15 §6. */
  sitesFor: (sex: Sex) => SiteKey[];
};

export const SKINFOLD_PROTOCOLS: SkinfoldProtocol[] = [
  {
    id: 'jp7',
    label: 'Jackson & Pollock · 7 Dobras',
    sitesFor: () => ['chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh'],
  },
  {
    id: 'jp3',
    label: 'Jackson & Pollock · 3 Dobras',
    sitesFor: (sex) => (sex === 'f' ? ['tricep', 'supra', 'thigh'] : ['chest', 'abdom', 'thigh']),
  },
];

/** Resolves a protocol id to its display label — the label itself is never persisted. */
export function protocolLabel(id: SkinfoldProtocolId): string {
  return SKINFOLD_PROTOCOLS.find((p) => p.id === id)?.label ?? id;
}

export function protocolById(id: SkinfoldProtocolId): SkinfoldProtocol {
  return SKINFOLD_PROTOCOLS.find((p) => p.id === id) ?? SKINFOLD_PROTOCOLS[0];
}

// ---------------------------------------------------------------------------
// Validation — docs/15 §13 ("não permitir valores negativos, campos vazios,
// idade inválida; aceitar apenas dobras > 0mm"). Body-fat plausibility isn't
// specified by docs/15 — it's an engineering safety net so a data-entry
// mistake in the folds can't silently produce a nonsensical percentage.
// ---------------------------------------------------------------------------

export function isValidWeight(w: number): boolean {
  return Number.isFinite(w) && w > 0;
}

export function isValidHeight(h: number): boolean {
  return Number.isFinite(h) && h > 0;
}

export function isValidAge(age: number): boolean {
  return Number.isFinite(age) && age > 0;
}

export function isValidFold(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

export const BODY_FAT_PLAUSIBLE_RANGE = { min: 3, max: 65 } as const;

export function isPlausibleBodyFat(bf: number): boolean {
  return (
    Number.isFinite(bf) && bf >= BODY_FAT_PLAUSIBLE_RANGE.min && bf <= BODY_FAT_PLAUSIBLE_RANGE.max
  );
}

/** docs/15 §14 — body fat is always displayed/stored rounded to 1 decimal place. */
export function roundTo1Decimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Whether every site required by the protocol/sex has a valid (> 0mm) fold. */
export function requiredFoldsPresent(
  folds: Partial<Record<SiteKey, number>>,
  sites: SiteKey[],
): boolean {
  return sites.every((s) => {
    const v = folds[s];
    return v != null && isValidFold(v);
  });
}

/** Sum of the given sites' folds (mm), or null when any required site is missing/invalid. */
export function sumFolds(
  folds: Partial<Record<SiteKey, number>>,
  sites: SiteKey[],
): number | null {
  if (!requiredFoldsPresent(folds, sites)) return null;
  return sites.reduce((acc, s) => acc + (folds[s] as number), 0);
}

/** Body density (JP3) — docs/15 §6. */
export function bodyDensityJP3(sumMm: number, age: number, sex: Sex): number {
  return sex === 'f'
    ? 1.0994921 - 0.0009929 * sumMm + 0.0000023 * sumMm ** 2 - 0.0001392 * age
    : 1.10938 - 0.0008267 * sumMm + 0.0000016 * sumMm ** 2 - 0.0002574 * age;
}

/** Body density (JP7) — docs/15 §7. */
export function bodyDensityJP7(sumMm: number, age: number, sex: Sex): number {
  return sex === 'f'
    ? 1.097 - 0.00046971 * sumMm + 0.00000056 * sumMm ** 2 - 0.00012828 * age
    : 1.112 - 0.00043499 * sumMm + 0.00000055 * sumMm ** 2 - 0.00028826 * age;
}

export function bodyDensity(
  protocol: SkinfoldProtocolId,
  sumMm: number,
  age: number,
  sex: Sex,
): number {
  return protocol === 'jp7' ? bodyDensityJP7(sumMm, age, sex) : bodyDensityJP3(sumMm, age, sex);
}

/** Siri equation — docs/15 §8. */
export function siriBodyFat(density: number): number {
  return 495 / density - 450;
}

/**
 * Body-fat % for a guided assessment, rounded per docs/15 §14. Returns null
 * when: age is invalid, not every required site is filled in yet (docs/15
 * §19 — a measurement is only valid once complete), or the result falls
 * outside a physiologically plausible range (likely a data-entry mistake).
 */
export function computeGuidedBodyFat(
  protocol: SkinfoldProtocolId,
  folds: Partial<Record<SiteKey, number>>,
  sites: SiteKey[],
  age: number,
  sex: Sex,
): number | null {
  if (!isValidAge(age)) return null;
  const sum = sumFolds(folds, sites);
  if (sum == null) return null;
  const bf = siriBodyFat(bodyDensity(protocol, sum, age, sex));
  if (!isPlausibleBodyFat(bf)) return null;
  return roundTo1Decimal(bf);
}

export function computeBmi(weightKg: number, heightCm: number): number | null {
  if (!isValidWeight(weightKg) || !isValidHeight(heightCm)) return null;
  const h = heightCm / 100;
  return weightKg / (h * h);
}

export function computeLeanMass(weightKg: number, bodyFatPct: number | null): number | null {
  if (!isValidWeight(weightKg) || bodyFatPct == null) return null;
  return weightKg * (1 - bodyFatPct / 100);
}

export function computeFatMass(weightKg: number, bodyFatPct: number | null): number | null {
  if (!isValidWeight(weightKg) || bodyFatPct == null) return null;
  return weightKg * (bodyFatPct / 100);
}
