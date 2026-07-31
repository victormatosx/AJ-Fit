import { describe, expect, it } from 'vitest';
import {
  BODY_FAT_PLAUSIBLE_RANGE,
  bodyDensity,
  bodyDensityJP3,
  bodyDensityJP7,
  computeBmi,
  computeFatMass,
  computeGuidedBodyFat,
  computeLeanMass,
  isPlausibleBodyFat,
  isValidAge,
  isValidFold,
  isValidHeight,
  isValidWeight,
  protocolById,
  protocolLabel,
  requiredFoldsPresent,
  roundTo1Decimal,
  siriBodyFat,
  SITE_LABELS,
  SKINFOLD_PROTOCOLS,
  sumFolds,
  type SiteKey,
} from '../skinfoldCalculator';

/**
 * Expected values below are computed independently (not by importing the
 * module under test) from the exact formulas in
 * docs/15_calculadora_de_dobras_subcutaneas.md §6 (JP3), §7 (JP7) and §8
 * (Siri). See the comment above each fixture for the raw computation.
 * Float comparisons use `toBeCloseTo` (never `toBe`) to avoid brittle
 * failures from floating-point representation error.
 */

// Body-density formula coefficients, mirrored here ONLY to compute
// independent expected values for the tests below — never imported from the
// module under test.
function referenceDensityJP7(S: number, age: number, sex: 'm' | 'f') {
  return sex === 'f'
    ? 1.097 - 0.00046971 * S + 0.00000056 * S ** 2 - 0.00012828 * age
    : 1.112 - 0.00043499 * S + 0.00000055 * S ** 2 - 0.00028826 * age;
}
function referenceDensityJP3(S: number, age: number, sex: 'm' | 'f') {
  return sex === 'f'
    ? 1.0994921 - 0.0009929 * S + 0.0000023 * S ** 2 - 0.0001392 * age
    : 1.10938 - 0.0008267 * S + 0.0000016 * S ** 2 - 0.0002574 * age;
}
function referenceSiri(dc: number) {
  return 495 / dc - 450;
}

describe('sumFolds / requiredFoldsPresent', () => {
  const sites: SiteKey[] = ['chest', 'abdom', 'thigh'];

  it('sums every required site when all are present and valid', () => {
    expect(sumFolds({ chest: 15, abdom: 15, thigh: 15 }, sites)).toBe(45);
  });

  it('returns null when a required site is missing', () => {
    expect(sumFolds({ chest: 15, abdom: 15 }, sites)).toBeNull();
    expect(requiredFoldsPresent({ chest: 15, abdom: 15 }, sites)).toBe(false);
  });

  it('returns null when a required site is zero or negative (docs/15 §13)', () => {
    expect(sumFolds({ chest: 15, abdom: 0, thigh: 15 }, sites)).toBeNull();
    expect(sumFolds({ chest: 15, abdom: -5, thigh: 15 }, sites)).toBeNull();
  });

  it('ignores extra sites not required by the protocol', () => {
    expect(sumFolds({ chest: 15, abdom: 15, thigh: 15, supra: 999 }, sites)).toBe(45);
  });
});

describe('bodyDensityJP3 (docs/15 §6)', () => {
  it('matches the documented male formula', () => {
    // S=45 (chest 15 + abdom 15 + thigh 15), age 28
    const S = 45;
    const age = 28;
    expect(bodyDensityJP3(S, age, 'm')).toBeCloseTo(referenceDensityJP3(S, age, 'm'), 10);
    expect(bodyDensityJP3(S, age, 'm')).toBeCloseTo(1.0682113, 6);
  });

  it('matches the documented female formula', () => {
    // S=60 (tricep 20 + supra 20 + thigh 20), age 32
    const S = 60;
    const age = 32;
    expect(bodyDensityJP3(S, age, 'f')).toBeCloseTo(referenceDensityJP3(S, age, 'f'), 10);
    expect(bodyDensityJP3(S, age, 'f')).toBeCloseTo(1.0437437, 6);
  });
});

describe('bodyDensityJP7 (docs/15 §7)', () => {
  it('matches the documented male formula', () => {
    // S=87 (chest10+axilla12+tricep8+subscap14+abdom18+supra10+thigh15), age 25
    const S = 87;
    const age = 25;
    expect(bodyDensityJP7(S, age, 'm')).toBeCloseTo(referenceDensityJP7(S, age, 'm'), 10);
    expect(bodyDensityJP7(S, age, 'm')).toBeCloseTo(1.07111232, 6);
  });

  it('matches the documented female formula', () => {
    // S=100 (chest14+axilla15+tricep16+subscap12+abdom15+supra14+thigh14), age 30
    const S = 100;
    const age = 30;
    expect(bodyDensityJP7(S, age, 'f')).toBeCloseTo(referenceDensityJP7(S, age, 'f'), 10);
    expect(bodyDensityJP7(S, age, 'f')).toBeCloseTo(1.0517806, 6);
  });

  it('bodyDensity() dispatches to the right protocol formula', () => {
    expect(bodyDensity('jp7', 87, 25, 'm')).toBeCloseTo(bodyDensityJP7(87, 25, 'm'), 10);
    expect(bodyDensity('jp3', 45, 28, 'm')).toBeCloseTo(bodyDensityJP3(45, 28, 'm'), 10);
  });
});

describe('siriBodyFat (docs/15 §8 — Siri equation)', () => {
  it('BF% = 495/DC - 450', () => {
    expect(siriBodyFat(1.07)).toBeCloseTo(referenceSiri(1.07), 10);
    expect(siriBodyFat(1.0)).toBeCloseTo(45, 10);
  });
});

describe('roundTo1Decimal (docs/15 §14 — 1 casa decimal)', () => {
  it('rounds to exactly one decimal place', () => {
    expect(roundTo1Decimal(14.84)).toBe(14.8);
    expect(roundTo1Decimal(14.85)).toBe(14.9);
    expect(roundTo1Decimal(14.0)).toBe(14);
  });
});

describe('computeGuidedBodyFat — full pipeline per protocol', () => {
  it('JP7 male: sum → density → Siri → rounded to 1 decimal', () => {
    const folds = { chest: 10, axilla: 12, tricep: 8, subscap: 14, abdom: 18, supra: 10, thigh: 15 };
    const sites: SiteKey[] = ['chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh'];
    const result = computeGuidedBodyFat('jp7', folds, sites, 25, 'm');
    // reference: DC=1.07111232 → BF=12.136407879240835 → rounded 12.1
    expect(result).toBeCloseTo(12.1, 1);
  });

  it('JP7 female', () => {
    const folds = { chest: 14, axilla: 15, tricep: 16, subscap: 12, abdom: 15, supra: 14, thigh: 14 };
    const sites: SiteKey[] = ['chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh'];
    const result = computeGuidedBodyFat('jp7', folds, sites, 30, 'f');
    // reference: DC=1.0517806 → BF=20.63047179231114 → rounded 20.6
    expect(result).toBeCloseTo(20.6, 1);
  });

  it('JP3 male', () => {
    const folds = { chest: 15, abdom: 15, thigh: 15 };
    const sites: SiteKey[] = ['chest', 'abdom', 'thigh'];
    const result = computeGuidedBodyFat('jp3', folds, sites, 28, 'm');
    // reference: DC=1.0682113 → BF=13.391465714695244 → rounded 13.4
    expect(result).toBeCloseTo(13.4, 1);
  });

  it('JP3 female', () => {
    const folds = { tricep: 20, supra: 20, thigh: 20 };
    const sites: SiteKey[] = ['tricep', 'supra', 'thigh'];
    const result = computeGuidedBodyFat('jp3', folds, sites, 32, 'f');
    // reference: DC=1.0437437 → BF=24.2543595712242 → rounded 24.3
    expect(result).toBeCloseTo(24.3, 1);
  });
});

describe('computeBmi / computeLeanMass / computeFatMass', () => {
  it('BMI = weight / height(m)^2', () => {
    expect(computeBmi(80, 180)).toBeCloseTo(80 / 1.8 ** 2, 6);
    expect(computeBmi(70, 175)).toBeCloseTo(22.857142857, 6);
  });

  it('lean/fat mass split weight by body-fat percentage', () => {
    expect(computeLeanMass(80, 20)).toBeCloseTo(64, 6);
    expect(computeFatMass(80, 20)).toBeCloseTo(16, 6);
    // The two must always add back up to total weight.
    const weight = 91.3;
    const bf = 27.4;
    expect(computeLeanMass(weight, bf)! + computeFatMass(weight, bf)!).toBeCloseTo(weight, 6);
  });

  it('returns null (never 0/NaN) when body fat is unknown', () => {
    expect(computeLeanMass(80, null)).toBeNull();
    expect(computeFatMass(80, null)).toBeNull();
  });
});

describe('protocol helpers', () => {
  it('exposes exactly the two documented protocols (docs/15 §3)', () => {
    expect(SKINFOLD_PROTOCOLS.map((p) => p.id).sort()).toEqual(['jp3', 'jp7']);
  });

  it('JP7 uses the same 7 sites regardless of sex (docs/15 §7)', () => {
    const proto = protocolById('jp7');
    expect(proto.sitesFor('m').sort()).toEqual(proto.sitesFor('f').sort());
    expect(proto.sitesFor('m')).toHaveLength(7);
  });

  it('JP3 sites differ by sex (docs/15 §6)', () => {
    const proto = protocolById('jp3');
    expect(proto.sitesFor('m').sort()).toEqual(['abdom', 'chest', 'thigh']);
    expect(proto.sitesFor('f').sort()).toEqual(['supra', 'thigh', 'tricep']);
  });

  it('resolves a human-readable label for every site key', () => {
    for (const key of Object.keys(SITE_LABELS) as SiteKey[]) {
      expect(typeof SITE_LABELS[key]).toBe('string');
      expect(SITE_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it('protocolLabel resolves known ids and falls back safely for unknown ones', () => {
    expect(protocolLabel('jp7')).toMatch(/7 Dobras/);
    expect(protocolLabel('jp3')).toMatch(/3 Dobras/);
    // @ts-expect-error deliberately testing an invalid protocol id at runtime
    expect(protocolLabel('bogus')).toBe('bogus');
  });

  it('protocolById falls back to a safe default for an unknown id', () => {
    // @ts-expect-error deliberately testing an invalid protocol id at runtime
    expect(protocolById('bogus').id).toBe(SKINFOLD_PROTOCOLS[0].id);
  });
});

describe('input validation predicates', () => {
  it('weight must be finite and > 0', () => {
    expect(isValidWeight(80)).toBe(true);
    expect(isValidWeight(0)).toBe(false);
    expect(isValidWeight(-1)).toBe(false);
    expect(isValidWeight(NaN)).toBe(false);
  });

  it('height must be finite and > 0', () => {
    expect(isValidHeight(180)).toBe(true);
    expect(isValidHeight(0)).toBe(false);
    expect(isValidHeight(-180)).toBe(false);
  });

  it('age must be finite and > 0', () => {
    expect(isValidAge(30)).toBe(true);
    expect(isValidAge(0)).toBe(false);
    expect(isValidAge(-5)).toBe(false);
    expect(isValidAge(NaN)).toBe(false);
  });

  it('a fold must be finite and > 0 (docs/15 §13)', () => {
    expect(isValidFold(12.5)).toBe(true);
    expect(isValidFold(0)).toBe(false);
    expect(isValidFold(-3)).toBe(false);
  });

  it('body fat must fall inside the plausible range', () => {
    expect(isPlausibleBodyFat(BODY_FAT_PLAUSIBLE_RANGE.min)).toBe(true);
    expect(isPlausibleBodyFat(BODY_FAT_PLAUSIBLE_RANGE.max)).toBe(true);
    expect(isPlausibleBodyFat(BODY_FAT_PLAUSIBLE_RANGE.min - 0.1)).toBe(false);
    expect(isPlausibleBodyFat(BODY_FAT_PLAUSIBLE_RANGE.max + 0.1)).toBe(false);
  });
});

describe('computeGuidedBodyFat — invalid/edge cases', () => {
  const jp7Sites: SiteKey[] = ['chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh'];
  const completeFolds = { chest: 10, axilla: 12, tricep: 8, subscap: 14, abdom: 18, supra: 10, thigh: 15 };

  it('invalid age → null', () => {
    expect(computeGuidedBodyFat('jp7', completeFolds, jp7Sites, 0, 'm')).toBeNull();
    expect(computeGuidedBodyFat('jp7', completeFolds, jp7Sites, -10, 'm')).toBeNull();
    expect(computeGuidedBodyFat('jp7', completeFolds, jp7Sites, NaN, 'm')).toBeNull();
  });

  it('missing required folds → null', () => {
    const { thigh, ...incomplete } = completeFolds;
    expect(computeGuidedBodyFat('jp7', incomplete, jp7Sites, 25, 'm')).toBeNull();
  });

  it('negative fold values are treated as absent → null', () => {
    const withNegative = { ...completeFolds, thigh: -15 };
    expect(computeGuidedBodyFat('jp7', withNegative, jp7Sites, 25, 'm')).toBeNull();
  });

  it('a technically-complete but implausible combination is rejected, not silently returned', () => {
    // Every site is individually valid (> 0mm) but the sum (10mm across all
    // 7 sites) is physiologically nonsensical — the formula would return a
    // negative body-fat percentage. This is the plausibility safety net,
    // not a docs/15 requirement (docs/15 only validates raw inputs > 0mm).
    const tinyFolds = { chest: 2, axilla: 1, tricep: 2, subscap: 1, abdom: 2, supra: 1, thigh: 1 };
    const sum = Object.values(tinyFolds).reduce((a, b) => a + b, 0);
    expect(sum).toBe(10);
    expect(computeGuidedBodyFat('jp7', tinyFolds, jp7Sites, 25, 'm')).toBeNull();
  });
});
