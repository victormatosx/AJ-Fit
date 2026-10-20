import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The selector is wiring, not arithmetic — the arithmetic is covered in
 * `unitDisplay.test.ts`. What matters here is that the wiring keeps its two
 * promises: the stored answer never leaves its canonical unit, and no new
 * preference is persisted anywhere.
 */
const read = (path: string) => readFileSync(path, 'utf8');

/** Block and line comments removed, so prose about the design is not mistaken for code. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const toggle = read('src/components/onboarding/UnitToggle.tsx');
const renderer = read('src/components/onboarding/QuestionRenderer.tsx');
const step = read('src/components/onboarding/QuestionStepScreen.tsx');
const funnel = read('src/screens/OnboardingFunnelScreen.tsx');
const display = read('src/components/onboarding/unitDisplay.ts');

describe('the selector is presentation state only', () => {
  it('never writes the app-wide units preference from the funnel', () => {
    for (const source of [toggle, renderer, step, funnel, display]) {
      expect(source).not.toContain('writeStoredUnitsPreference');
      expect(source).not.toContain('changeUnitsForUser');
    }
  });

  it('holds the choice in funnel component state, not in the draft or the quiz', () => {
    expect(funnel).toContain('const [heightUnit, setHeightUnit] = useState<DisplayUnit>');
    expect(funnel).toContain('const [weightDisplayUnit, setWeightDisplayUnit] = useState<DisplayUnit>');
    // The two setters are the only writers, and neither touches persistence.
    expect(funnel).not.toMatch(/setAnswer\((['"`])(height|weight)Unit/);
  });

  it('seeds from the already-resolved app preference rather than re-reading the locale', () => {
    expect(funnel).toContain("unitForPreference('height', resolvedUnits)");
    expect(funnel).toContain("unitForPreference('weight', resolvedUnits)");
    expect(funnel).not.toContain('expo-localization');
  });
});

describe('what reaches onChange stays canonical', () => {
  it('routes every emission through the canonical conversion', () => {
    expect(renderer).toContain('const raw = toCanonical(next);');
    expect(renderer).toContain('unit ? toCanonicalValue(next, unit, bounds) : Math.round(next)');
  });

  it('passes the question range as the clamp, so nothing is stored outside it', () => {
    expect(renderer).toContain('const bounds = { min: q.min, max: q.max };');
  });

  it('refuses to emit while the ruler is being repositioned by a unit switch', () => {
    expect(renderer).toContain('if (repositioningRef.current) return;');
    expect(renderer).toContain('repositioningRef.current = true;');
  });
});

describe('ranges are derived, never hardcoded', () => {
  it('builds the displayed range from the question definition', () => {
    expect(renderer).toContain('toDisplayRange(q.min, q.max, unit)');
  });

  it('states no range bound and no conversion constant in its own code', () => {
    // Comments quote the design's numbers on purpose; the executable code
    // must not, so the ranges stay derived from `questionDefs.ts` and the
    // factors stay owned by `src/units`.
    for (const literal of ['55', '87', '88', '397', '140', '220', '180', '2.54', '0.45359237']) {
      expect(stripComments(display)).not.toContain(literal);
    }
  });

  it('re-uses the app conversion constants instead of restating them', () => {
    expect(display).toContain("from '../../units/heightConversions'");
    expect(display).toContain("from '../../units/weightConversions'");
  });
});

describe('the three body measurement steps, and only those, get a selector', () => {
  it('maps exactly height, weight and the nutrition target weight', () => {
    expect(funnel).toContain("if (stepId === 'height') return heightUnit;");
    expect(funnel).toContain(
      "if (stepId === 'weight' || stepId === 'nutrition_targetWeightKg') return weightDisplayUnit;",
    );
    expect(funnel).toContain('return null;');
  });

  it('shares one selection between the two weight steps', () => {
    // Both weight ids resolve to the same piece of state, which is what makes
    // "chose LB on weight, target weight opens in LB" true.
    const weightLine = funnel
      .split('\n')
      .find((line) => line.includes("stepId === 'nutrition_targetWeightKg'"));
    expect(weightLine).toContain('weightDisplayUnit');
  });

  it('renders the selector only when the step supplies a unit and a handler', () => {
    expect(step).toContain('{measurementUnit && onMeasurementUnitChange ? (');
  });
});

describe('design contract', () => {
  it('uses the specified pill geometry and slide timing', () => {
    expect(toggle).toContain('const TOGGLE_WIDTH = 190');
    expect(toggle).toContain('const TRACK_PADDING = 4');
    expect(toggle).toContain('const INDICATOR_WIDTH = (TOGGLE_WIDTH - TRACK_PADDING * 2) / 2');
    expect(toggle).toContain('const SLIDE_MS = 300');
    expect(toggle).toContain('Easing.bezier(0.3, 1.2, 0.5, 1)');
  });

  it('skips the slide animation under Reduce Motion', () => {
    expect(toggle).toContain('reduceMotion\n      ? target');
  });

  it('exposes the group and its options to assistive tech', () => {
    expect(toggle).toContain('accessibilityRole="radiogroup"');
    expect(toggle).toContain('accessibilityRole="radio"');
    expect(toggle).toContain('accessibilityState={{ checked: selected }}');
  });

  it('keeps the ruler adjustable one displayed unit at a time', () => {
    expect(renderer).toContain('accessibilityRole="adjustable"');
    expect(renderer).toContain("{ name: 'increment' }");
    expect(renderer).toContain("{ name: 'decrement' }");
    expect(renderer).toContain('adjustBy(1)');
    expect(renderer).toContain('adjustBy(-1)');
  });

  it('takes every visible string from i18n', () => {
    expect(toggle).toContain("t(`units.${unit}`)");
    expect(toggle).toContain('t(`units.full.${unit}`)');
    expect(toggle).toContain('t(`units.groupLabel.${kind}`)');
    // No bare CM/FT/KG/LB literals rendered anywhere in the control.
    expect(toggle).not.toMatch(/>(\s*)(CM|FT|KG|LB)(\s*)</);
  });
});

describe('feet is ruler-only', () => {
  it('blocks the keypad and drops the unit label in feet', () => {
    expect(display).toContain("return unit !== 'ft';");
    expect(display).toContain("return unit === 'ft' ? null : `units.${unit}`;");
    expect(renderer).toContain('if (!keyboardEntry) return;');
  });

  it('discards a half-typed number when the unit changes', () => {
    expect(renderer).toContain('setEditing(false);\n  }, [unit]);');
  });
});
