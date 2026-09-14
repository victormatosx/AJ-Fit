import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression coverage for a letter-by-letter text wrap bug on the
// "next set" card of the workout execution screen.
//
// Root cause: the reps/last-load value columns in the card row had no
// flexShrink/maxWidth cap, so a long reps string (e.g. "8-12/perna" for
// unilateral exercises like Agachamento Búlgaro) forced those columns to
// grow to fit their content at fontSize 40. Because RN's default
// flexShrink is 0 (unlike CSS's default of 1), the only flexible sibling
// — the "PRÓXIMA SÉRIE" / "SÉRIE N" label column (flex: 1) — was squeezed
// down to near-zero width, causing React Native's text layout to wrap the
// label character-by-character instead of word-by-word.
const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

function nextSetCard(): string {
  const start = source.indexOf('{/* Next-set card */}');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('{/* set list */}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('WorkoutScreen next-set card layout', () => {
  it('gives the label column flex + minWidth:0 so it can shrink instead of collapsing to zero', () => {
    const card = nextSetCard();
    // The label column must be able to shrink (flex: 1) AND must have
    // minWidth: 0 — without the latter, RN/Yoga will not let a flex child
    // shrink below its content's intrinsic width, which is exactly what
    // starves the sibling value columns of space and (in reverse) is also
    // the mechanism used here to protect the label column itself.
    expect(card).toContain('flex: 1, minWidth: 0');
  });

  it('caps the reps value column so a long reps string cannot grow unbounded', () => {
    const card = nextSetCard();
    const repsBlockStart = card.indexOf('{curReps}');
    expect(repsBlockStart).toBeGreaterThan(-1);
    const repsColumnStart = card.lastIndexOf('<View', repsBlockStart);
    const repsColumn = card.slice(repsColumnStart, repsBlockStart);

    expect(repsColumn).toContain('maxWidth');
    expect(repsColumn).toContain('flexShrink: 0');
  });

  it('constrains the reps text to a single line and shrinks font instead of expanding the box', () => {
    const card = nextSetCard();
    const repsTextStart = card.lastIndexOf('<Text', card.indexOf('{curReps}'));
    const repsTextEnd = card.indexOf('{curReps}');
    const repsTextProps = card.slice(repsTextStart, repsTextEnd);

    expect(repsTextProps).toContain('numberOfLines={1}');
    expect(repsTextProps).toContain('adjustsFontSizeToFit');
  });

  it('caps the last-load value column the same way as the reps column', () => {
    const card = nextSetCard();
    const lastTimeIdx = card.indexOf("t('sets.lastTime')");
    expect(lastTimeIdx).toBeGreaterThan(-1);
    const dividerIdx = card.indexOf('dividerStrong');
    expect(dividerIdx).toBeGreaterThan(-1);
    const lastColumnStart = card.indexOf('<View', dividerIdx);
    const lastColumn = card.slice(lastColumnStart, lastTimeIdx);

    expect(lastColumn).toContain('maxWidth');
    expect(lastColumn).toContain('flexShrink: 0');
  });

  it('uses the raw prescription reps string directly (covers long unilateral formats like "8-12/perna")', () => {
    // Guards against a regression where curReps stops being the free-form
    // "r" field (which can be short numbers like "12" or long strings like
    // "8-12/perna" / "8–12/perna" with an en dash) and the layout fix above
    // silently stops being exercised by real data.
    expect(source).toContain('const curReps = ex.sets[setIdx].r;');
  });
});
