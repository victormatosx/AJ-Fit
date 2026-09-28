import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression coverage for the "next set" card's layout.
//
// History:
//  1. Original bug: counter/reps/record shared one row with the reps column
//     capped at `maxWidth: 100`, so `adjustsFontSizeToFit` silently shrank
//     the reps value below legibility.
//  2. First fix moved reps to its own full-width row below a divider — this
//     solved legibility but made the card (and therefore the whole screen)
//     tall enough to hide most of the set list.
//  3. This version: back to ONE row, three PROPORTIONAL (`flex`, never a
//     fixed/max px) columns, with `minimumFontScale` kept high so
//     `adjustsFontSizeToFit` is only ever a small safety margin, not the
//     mechanism that makes text tiny.
const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

function nextSetCard(): string {
  const start = source.indexOf('{/* Next-set card');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('{/* set list */}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('WorkoutScreen next-set card layout', () => {
  it('never caps a column to a small fixed/max width again', () => {
    const card = nextSetCard();
    expect(card).not.toContain('maxWidth: 100');
    expect(card).not.toContain('flexBasis: 112');
    expect(card).not.toContain('width: 72');
  });

  it('keeps counter, reps and previous-load reference on a single row (no divider-separated second row)', () => {
    const card = nextSetCard();
    // Exactly one row-level flex container drives the three columns —
    // there is no second `flexDirection: 'row'` wrapping just the reps
    // value on its own line below a divider.
    const rowMatches = card.match(/flexDirection: 'row'/g) ?? [];
    // One for the outer card row, one each for the two baseline-aligned
    // inline groups (SÉRIE counter, previous-load value+unit) — never a
    // fourth "reps on its own row" wrapper.
    expect(rowMatches.length).toBeLessThanOrEqual(3);

    const counterIdx = card.indexOf("t('sets.next')");
    const repsIdx = card.indexOf('{curReps}');
    const previousIdx = card.indexOf("t('sets.previous')");
    expect(counterIdx).toBeGreaterThan(-1);
    expect(repsIdx).toBeGreaterThan(-1);
    expect(previousIdx).toBeGreaterThan(-1);
    // Declaration order along the single row: counter, then reps, then the previous-load reference.
    expect(counterIdx).toBeLessThan(repsIdx);
    expect(repsIdx).toBeLessThan(previousIdx);
  });

  it('sizes columns proportionally with flex + minWidth: 0, never a fixed width', () => {
    const card = nextSetCard();
    const flexMatches = card.match(/flex: 0\.\d+/g) ?? [];
    // Counter and record columns are both proportional.
    expect(flexMatches.length).toBeGreaterThanOrEqual(2);
    expect(card).toContain('flex: 1.3');
    expect((card.match(/minWidth: 0/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps adjustsFontSizeToFit as a small safety margin, never the mechanism that makes text tiny', () => {
    const card = nextSetCard();
    const scales = [...card.matchAll(/minimumFontScale=\{([\d.]+)\}/g)].map((m) => Number(m[1]));
    expect(scales.length).toBeGreaterThan(0);
    // The two primary values (reps, previous load) never shrink below 0.85;
    // small secondary captions (SÉRIE label, prescription kind, ANTERIOR
    // label) may shrink a bit further (down to 0.7) since they're not the
    // content a lifter reads mid-set — but never lower than that.
    scales.forEach((scale) => expect(scale).toBeGreaterThanOrEqual(0.7));
    expect(scales).toContain(0.85);
  });

  it('scales every card font from the actual window width, clamped, instead of a fixed device constant', () => {
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('const nextSetFont = (basePx: number)');
    // Clamped both ways — never shrinks below legibility on a tiny phone,
    // never balloons past the card's proportions on a huge one.
    expect(source).toMatch(/Math\.min\(1\.\d+,\s*Math\.max\(0\.\d+,\s*windowWidth \/ \d+\)\)/);

    const card = nextSetCard();
    // The counter, reps and record values all derive their size from the
    // shared scale function — none of them is a hardcoded literal anymore.
    expect(card).toContain('size={nextSetFont(');
    expect(card).toContain('fontSize: nextSetFont(');
    expect(card).not.toMatch(/fontSize:\s*\d+,/);
  });

  it('uses the raw prescription reps string directly (covers long unilateral formats like "8-12/perna")', () => {
    // Guards against a regression where curReps stops being the free-form
    // "r" field (which can be short numbers like "12" or long strings like
    // "8-12/perna" / "8–12/perna" with an en dash) and the layout fix above
    // silently stops being exercised by real data.
    expect(source).toContain('const curReps = ex.sets[setIdx].r;');
  });
});
