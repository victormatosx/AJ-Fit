import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_LAYOUT,
  ANALYSIS_RING,
  analysisComposition,
  analysisLookAt,
  analysisRequiredHeight,
} from '../analysisComposition';

/**
 * The analysis screen's vertical fit is arithmetic, not a device list, so it
 * is checked here rather than by eye: the full-size ring is kept wherever it
 * genuinely fits and steps down where it does not, and the checklist's
 * scroll stays a last resort instead of the normal case.
 */
describe('analysisComposition', () => {
  const STEPS = 5;

  it('keeps the design ring on a screen with room for the whole composition', () => {
    const composition = analysisComposition(2000, STEPS);
    expect(composition.variant).toBe('regular');
    expect(composition.ring).toEqual(ANALYSIS_RING.regular);
    expect(composition.titleSize).toBe(ANALYSIS_LAYOUT.titleSize.regular);
    expect(composition.rowPaddingVertical).toBe(ANALYSIS_LAYOUT.rowPaddingVertical.regular);
  });

  it('steps down every size together once the full composition stops fitting', () => {
    // 844pt window minus a 47pt top inset — the common iPhone.
    const composition = analysisComposition(844 - 47, STEPS);
    expect(composition.variant).toBe('compact');
    expect(composition.ring).toEqual(ANALYSIS_RING.compact);
    expect(composition.titleSize).toBe(ANALYSIS_LAYOUT.titleSize.compact);
    expect(composition.rowPaddingVertical).toBe(ANALYSIS_LAYOUT.rowPaddingVertical.compact);
  });

  it('never grows past the two sizes the design defines, however small the screen', () => {
    const composition = analysisComposition(320, STEPS);
    expect(composition.ring).toEqual(ANALYSIS_RING.compact);
  });

  it('fits the compact composition on the common iPhone without scrolling', () => {
    // 844pt window, 47pt top inset: the reduced composition still has room
    // for all five rows, so the ScrollView stays a safety net.
    expect(analysisRequiredHeight('compact', STEPS)).toBeLessThanOrEqual(844 - 47);
  });

  it('asks for less room as steps are removed, so the threshold tracks the real list', () => {
    const fiveSteps = analysisComposition(800, 5);
    const twoSteps = analysisComposition(800, 2);
    expect(fiveSteps.variant).toBe('compact');
    expect(twoSteps.variant).toBe('regular');
  });
});

describe('analysisLookAt', () => {
  it('leans AJ across the list and always glances down at it', () => {
    expect(analysisLookAt(0, 5)).toEqual([-0.8, 2.4]);
    expect(analysisLookAt(4, 5)).toEqual([0.8, 2.4]);
    expect(analysisLookAt(2, 5)).toEqual([0, 2.4]);
  });

  it('does not divide by zero on a single-step list', () => {
    expect(analysisLookAt(0, 1)).toEqual([0, 2.4]);
  });
});
