import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_DENSE_GAPS,
  ANALYSIS_LAYOUT,
  ANALYSIS_RING,
  analysisComposition,
  analysisGaps,
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

describe('analysisGaps', () => {
  it('is the design spacing, value for value, when not dense', () => {
    const gaps = analysisGaps(false);
    for (const key of Object.keys(gaps) as (keyof typeof gaps)[]) {
      expect(gaps[key]).toBe(ANALYSIS_LAYOUT[key]);
    }
  });

  it('only tightens gaps — every object keeps its own size', () => {
    const dense = analysisGaps(true);
    for (const [key, value] of Object.entries(ANALYSIS_DENSE_GAPS)) {
      expect(dense[key as keyof typeof dense]).toBe(value);
      // A "tightened" value that grew would be a redesign, not a compaction.
      expect(value).toBeLessThan(ANALYSIS_LAYOUT[key as keyof typeof ANALYSIS_DENSE_GAPS]);
    }
    // The speech box and the bottom link are objects, not gaps.
    expect(dense.speechMinHeight).toBe(ANALYSIS_LAYOUT.speechMinHeight);
    expect(dense.reviewMinHeight).toBe(ANALYSIS_LAYOUT.reviewMinHeight);
  });
});

describe('the swap composition (single-line title, tightened rhythm)', () => {
  const STEPS = 5;
  const SWAP = { titleLines: 1, dense: true } as const;
  /** The common iPhone: an 844pt window minus a 47pt top inset. */
  const IPHONE = 844 - 47;

  it('leaves the onboarding composition untouched when given no options', () => {
    expect(analysisComposition(IPHONE, STEPS)).toEqual(
      analysisComposition(IPHONE, STEPS, { titleLines: 2, dense: false }),
    );
    expect(analysisRequiredHeight('compact', STEPS)).toBe(
      analysisRequiredHeight('compact', STEPS, { titleLines: 2, dense: false }),
    );
  });

  it('reclaims real height — the slack that used to sit under the checklist', () => {
    const before = analysisRequiredHeight('compact', STEPS);
    const after = analysisRequiredHeight('compact', STEPS, SWAP);
    expect(after).toBeLessThan(before);
    // One title line (~41pt at the compact size) plus the tightened gaps.
    expect(before - after).toBeGreaterThanOrEqual(60);
  });

  it('spends the reclaimed room on the design ring instead of empty space', () => {
    // Onboarding steps down to `compact` on this screen; the swap now fits the
    // full-size ring, which is the progress indicator the screen is about.
    expect(analysisComposition(IPHONE, STEPS).variant).toBe('compact');
    const swap = analysisComposition(IPHONE, STEPS, SWAP);
    expect(swap.variant).toBe('regular');
    expect(swap.ring).toEqual(ANALYSIS_RING.regular);
  });

  it('reports the gaps the fit math actually used, so the screen cannot disagree', () => {
    expect(analysisComposition(IPHONE, STEPS, SWAP).gaps).toEqual(analysisGaps(true));
    expect(analysisComposition(IPHONE, STEPS).gaps).toEqual(analysisGaps(false));
    expect(analysisComposition(IPHONE, STEPS, SWAP).titleLines).toBe(1);
    expect(analysisComposition(IPHONE, STEPS).titleLines).toBe(2);
  });

  it('still steps down on a short screen rather than overflowing it', () => {
    // iPhone SE class: 667pt window, 20pt inset.
    expect(analysisComposition(667 - 20, STEPS, SWAP).variant).toBe('compact');
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
