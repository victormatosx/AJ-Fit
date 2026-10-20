import { describe, expect, it } from 'vitest';
import {
  canonicalUnit,
  formatDisplayValue,
  formatFeetInches,
  isCanonicalUnit,
  majorTickEvery,
  measurementKindOf,
  preferenceForUnit,
  supportsKeyboardEntry,
  toCanonicalValue,
  toDisplayRange,
  toDisplayValue,
  unitForPreference,
} from '../unitDisplay';

// The canonical ranges the questionnaire actually declares
// (`questionDefs.ts`). Mirrored here only so the expectations below read as
// real cases; nothing in the module hardcodes them.
const HEIGHT = { min: 140, max: 220, default: 178 };
const WEIGHT = { min: 40, max: 180, default: 78 };

describe('toDisplayValue', () => {
  it('leaves canonical units as whole numbers', () => {
    expect(toDisplayValue(178, 'cm')).toBe(178);
    expect(toDisplayValue(78, 'kg')).toBe(78);
  });

  it('converts cm to whole inches', () => {
    expect(toDisplayValue(178, 'ft')).toBe(70); // 70.08in
    expect(toDisplayValue(140, 'ft')).toBe(55);
    expect(toDisplayValue(220, 'ft')).toBe(87);
  });

  it('converts kg to whole pounds', () => {
    expect(toDisplayValue(78, 'lb')).toBe(172); // 171.96lb
    expect(toDisplayValue(40, 'lb')).toBe(88);
    expect(toDisplayValue(180, 'lb')).toBe(397);
  });
});

describe('toCanonicalValue', () => {
  it('rounds to a whole cm / whole kg, never a fractional tail', () => {
    expect(toCanonicalValue(70, 'ft')).toBe(178); // 177.8cm
    expect(toCanonicalValue(172, 'lb')).toBe(78); // 78.0176kg
    expect(Number.isInteger(toCanonicalValue(397, 'lb'))).toBe(true);
    expect(Number.isInteger(toCanonicalValue(87, 'ft'))).toBe(true);
  });

  it('is the identity on canonical units', () => {
    expect(toCanonicalValue(178, 'cm')).toBe(178);
    expect(toCanonicalValue(78, 'kg')).toBe(78);
  });
});

describe('round trip', () => {
  it('returns the same canonical height for the questionnaire default', () => {
    expect(toCanonicalValue(toDisplayValue(HEIGHT.default, 'ft'), 'ft')).toBe(178);
  });

  it('returns the same canonical weight for the questionnaire default', () => {
    expect(toCanonicalValue(toDisplayValue(WEIGHT.default, 'lb'), 'lb')).toBe(78);
  });

  it('pins both ends of the height range', () => {
    for (const cm of [HEIGHT.min, HEIGHT.max]) {
      expect(toCanonicalValue(toDisplayValue(cm, 'ft'), 'ft', HEIGHT)).toBe(cm);
    }
  });

  it('pins both ends of the weight range', () => {
    for (const kg of [WEIGHT.min, WEIGHT.max]) {
      expect(toCanonicalValue(toDisplayValue(kg, 'lb'), 'lb', WEIGHT)).toBe(kg);
    }
  });

  it('never stores past the canonical range, even where the imperial edge rounds outward', () => {
    // 87in is 220.98cm, one tick past the questionnaire's 220cm maximum.
    expect(toCanonicalValue(87, 'ft')).toBe(221);
    expect(toCanonicalValue(87, 'ft', HEIGHT)).toBe(220);
    expect(toCanonicalValue(55, 'ft', HEIGHT)).toBe(140);
  });

  it('every kg in range round-trips through lb unchanged', () => {
    for (let kg = WEIGHT.min; kg <= WEIGHT.max; kg++) {
      expect(toCanonicalValue(toDisplayValue(kg, 'lb'), 'lb')).toBe(kg);
    }
  });

  it('switching units repeatedly never moves the canonical value', () => {
    // The toggle itself never writes; this proves the arithmetic agrees, so
    // that even a value re-derived from the display stays put.
    let cm = 178;
    for (let i = 0; i < 10; i++) {
      cm = toCanonicalValue(toDisplayValue(cm, 'ft'), 'ft');
      cm = toCanonicalValue(toDisplayValue(cm, 'cm'), 'cm');
    }
    expect(cm).toBe(178);

    let kg = 78;
    for (let i = 0; i < 10; i++) {
      kg = toCanonicalValue(toDisplayValue(kg, 'lb'), 'lb');
      kg = toCanonicalValue(toDisplayValue(kg, 'kg'), 'kg');
    }
    expect(kg).toBe(78);
  });

  it('a cm with no exact inch lands on the nearest representable cm, then stays', () => {
    // Inches are coarser than centimetres, so 179 cm cannot survive a trip
    // through the feet ruler — but it must settle, not drift further.
    const once = toCanonicalValue(toDisplayValue(179, 'ft'), 'ft');
    expect(once).toBe(178);
    expect(toCanonicalValue(toDisplayValue(once, 'ft'), 'ft')).toBe(178);
  });
});

describe('formatFeetInches', () => {
  it('uses typographic prime and double prime', () => {
    expect(formatFeetInches(70)).toBe("5′10″");
    expect(formatFeetInches(55)).toBe('4′7″');
    expect(formatFeetInches(87)).toBe('7′3″');
  });

  it('renders a whole foot with zero inches', () => {
    expect(formatFeetInches(72)).toBe('6′0″');
  });
});

describe('formatDisplayValue', () => {
  it('formats feet as feet-and-inches and everything else as a plain number', () => {
    expect(formatDisplayValue(70, 'ft')).toBe("5′10″");
    expect(formatDisplayValue(178, 'cm')).toBe('178');
    expect(formatDisplayValue(172, 'lb')).toBe('172');
  });
});

describe('toDisplayRange', () => {
  it('derives the imperial height range from the metric one', () => {
    expect(toDisplayRange(HEIGHT.min, HEIGHT.max, 'ft')).toEqual({ min: 55, max: 87 });
  });

  it('derives the imperial weight range from the metric one', () => {
    expect(toDisplayRange(WEIGHT.min, WEIGHT.max, 'lb')).toEqual({ min: 88, max: 397 });
  });

  it('passes the metric range through untouched', () => {
    expect(toDisplayRange(HEIGHT.min, HEIGHT.max, 'cm')).toEqual({ min: 140, max: 220 });
    expect(toDisplayRange(WEIGHT.min, WEIGHT.max, 'kg')).toEqual({ min: 40, max: 180 });
  });

  it('keeps every tick of the imperial range inside the canonical one', () => {
    for (const [kind, range] of [['ft', HEIGHT], ['lb', WEIGHT]] as const) {
      const { min, max } = toDisplayRange(range.min, range.max, kind);
      for (let tick = min; tick <= max; tick++) {
        const canonical = toCanonicalValue(tick, kind, range);
        expect(canonical).toBeGreaterThanOrEqual(range.min);
        expect(canonical).toBeLessThanOrEqual(range.max);
      }
    }
  });
});

describe('ruler configuration per unit', () => {
  it('groups feet in twelves and everything else in fives', () => {
    expect(majorTickEvery('ft')).toBe(12);
    expect(majorTickEvery('cm')).toBe(5);
    expect(majorTickEvery('kg')).toBe(5);
    expect(majorTickEvery('lb')).toBe(5);
  });

  it('allows keyboard entry everywhere except feet', () => {
    expect(supportsKeyboardEntry('ft')).toBe(false);
    for (const unit of ['cm', 'kg', 'lb'] as const) {
      expect(supportsKeyboardEntry(unit)).toBe(true);
    }
  });
});

describe('unit identity helpers', () => {
  it('knows which unit each measurement stores', () => {
    expect(canonicalUnit('height')).toBe('cm');
    expect(canonicalUnit('weight')).toBe('kg');
  });

  it('maps a unit back to its measurement', () => {
    expect(measurementKindOf('cm')).toBe('height');
    expect(measurementKindOf('ft')).toBe('height');
    expect(measurementKindOf('kg')).toBe('weight');
    expect(measurementKindOf('lb')).toBe('weight');
  });

  it('treats only the metric unit of each pair as canonical', () => {
    expect(isCanonicalUnit('cm')).toBe(true);
    expect(isCanonicalUnit('kg')).toBe(true);
    expect(isCanonicalUnit('ft')).toBe(false);
    expect(isCanonicalUnit('lb')).toBe(false);
  });
});

describe('seeding from the app-wide preference', () => {
  it('maps resolved units onto the matching display unit', () => {
    expect(unitForPreference('height', 'metric')).toBe('cm');
    expect(unitForPreference('height', 'imperial')).toBe('ft');
    expect(unitForPreference('weight', 'metric')).toBe('kg');
    expect(unitForPreference('weight', 'imperial')).toBe('lb');
  });

  it('round-trips back to a resolved-units value', () => {
    for (const unit of ['cm', 'ft', 'kg', 'lb'] as const) {
      expect(unitForPreference(measurementKindOf(unit), preferenceForUnit(unit))).toBe(unit);
    }
  });
});
